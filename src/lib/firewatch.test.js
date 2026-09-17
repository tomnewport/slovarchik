import { describe, it, expect } from 'vitest'

import {
  ALIVE,
  BURNED,
  BURNING,
  CLEARING_KINDS,
  DEFAULTS,
  HOUSE_KIND,
  KERNEL,
  KERNEL_REACH,
  PLANE,
  SIZE,
  TERRAIN,
  approachHeading,
  cellAt,
  cellGlyph,
  coordinateFrom,
  coordinateLabel,
  douse,
  generateForest,
  ignite,
  planePath,
  resolveGlyphs,
  spawnFire,
  stats,
  step,
  GLYPH_CHAINS,
} from './firewatch.js'
import { mulberry32 } from './seed.js'

/**
 * A forest with no houses and no gaps: every cell burns, so spread is easy to
 * reason about.
 *
 * Laid out once and cloned, rather than generated per call. Generating warps
 * three Perlin fields over ten thousand cells — nothing once, but the
 * statistical tests below want hundreds of rounds apiece, and it timed the
 * suite out on CI. None of that work survives the `kind.fill` on the next line
 * anyway, so every seed produced the same forest regardless.
 */
const BLANK = (() => {
  const world = generateForest({ houseRate: 0, gapRate: 0, seeds: 1 }, mulberry32(1))
  world.kind.fill(0)
  world.burnable = world.kind.length
  world.houses = 0
  return world
})()

/** A fresh copy of it. `structuredClone` copies the typed arrays and the sets,
 *  so there is no field list here to fall out of step with the world's shape. */
const solidForest = () => structuredClone(BLANK)

describe('the map', () => {
  it('is the 0–99 grid the drill needs', () => {
    expect(SIZE).toBe(100)
    expect(cellAt(0, 0)).toBe(0)
    expect(cellAt(99, 99)).toBe(SIZE * SIZE - 1)
    expect(cellAt(43, 20)).toBe(20 * SIZE + 43)
  })

  it('refuses coordinates that are not whole numbers on the map', () => {
    expect(cellAt(-1, 0)).toBe(-1)
    expect(cellAt(0, -1)).toBe(-1)
    expect(cellAt(100, 0)).toBe(-1)
    expect(cellAt(0, 100)).toBe(-1)
    expect(cellAt(1.5, 0)).toBe(-1)
  })
})

describe('generateForest', () => {
  it('fills every cell with a real terrain kind', () => {
    const world = generateForest({}, mulberry32(7))
    expect(world.kind).toHaveLength(SIZE * SIZE)
    for (const k of world.kind) expect(TERRAIN[k]).toBeDefined()
  })

  it('mixes species rather than laying down one, and leaves gaps', () => {
    const world = generateForest({}, mulberry32(7))
    const present = new Set(world.kind)
    expect(present.size).toBeGreaterThan(3)
    expect([...present].some((k) => !TERRAIN[k].burns)).toBe(true)
  })

  it('never lays a whole clearing of mushrooms, which would read as fire', () => {
    const mushroom = TERRAIN.findIndex((t) => t.id === 'mushroom')
    expect(CLEARING_KINDS).not.toContain(mushroom)
    for (let seed = 1; seed <= 30; seed++) {
      const world = generateForest({}, mulberry32(seed))
      const shrooms = [...world.kind].filter((k) => k === mushroom).length
      // Scattered by the gap roll, never seeded: well under a Voronoi region's
      // worth of the 10 000 cells.
      expect(shrooms).toBeLessThan(400)
    }
  })

  it('counts what can burn and how many houses stand', () => {
    const world = generateForest({}, mulberry32(3))
    const burnable = [...world.kind].filter((k) => TERRAIN[k].burns).length
    const houses = [...world.kind].filter((k) => k === HOUSE_KIND).length
    expect(world.burnable).toBe(burnable)
    expect(world.houses).toBe(houses)
    expect(houses).toBeGreaterThan(0)
  })

  it('bends its stand boundaries rather than drawing straight edges', () => {
    // A Voronoi cell is a convex polygon, so an unwarped diagram's boundaries
    // are line segments — the shortest a boundary can be. Warping the lookup
    // makes them wander, which is longer. Measured as the number of cells with
    // a differently-kinded neighbour, over a map with no gaps or houses on it
    // so this counts the stand boundaries alone.
    const edgeLength = (world) => {
      let edge = 0
      for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
          const k = world.kind[cellAt(x, y)]
          if (k !== world.kind[cellAt(x + 1, y)] || k !== world.kind[cellAt(x, y + 1)]) edge++
        }
      }
      return edge
    }
    const plain = { houseRate: 0, gapRate: 0 }
    let warped = 0
    let straight = 0
    for (let seed = 1; seed <= 8; seed++) {
      warped += edgeLength(generateForest(plain, mulberry32(seed)))
      straight += edgeLength(generateForest({ ...plain, warp: 0 }, mulberry32(seed)))
    }
    expect(warped).toBeGreaterThan(straight * 1.3)
  })

  it('gathers its gaps into glades without changing how much bare ground there is', () => {
    // Only the *sprinkled* gaps are in question here, not the bare stands the
    // Voronoi seeds lay down, so each forest is masked against the same layout
    // generated with no gaps at all — the same seed gives the same stands.
    const measure = (opts, seed) => {
      const full = generateForest(opts, mulberry32(seed))
      const stands = generateForest({ ...opts, gapRate: 0, houseRate: 0 }, mulberry32(seed))
      const sprinkled = (x, y) => {
        const i = cellAt(x, y)
        return !TERRAIN[full.kind[i]].burns && TERRAIN[stands.kind[i]].burns
      }
      let pairs = 0
      let gaps = 0
      for (let y = 0; y < SIZE - 1; y++) {
        for (let x = 0; x < SIZE - 1; x++) {
          if (!sprinkled(x, y)) continue
          gaps++
          if (sprinkled(x + 1, y)) pairs++
          if (sprinkled(x, y + 1)) pairs++
        }
      }
      return { clumping: pairs / gaps, gaps }
    }

    let glades = 0
    let freckles = 0
    let gladeGaps = 0
    let freckleGaps = 0
    for (let seed = 1; seed <= 8; seed++) {
      const a = measure({}, seed)
      // A canopy field sampled over a vast distance is flat: an even sprinkle.
      const b = measure({ gapScale: 1e9 }, seed)
      glades += a.clumping
      freckles += b.clumping
      gladeGaps += a.gaps
      freckleGaps += b.gaps
    }
    // A gap next to another gap, more often than chance alone would put it.
    expect(glades).toBeGreaterThan(freckles * 1.15)
    // …and the same amount of bare ground either way, because the fire tuning
    // depends on how much of the map can burn.
    expect(gladeGaps / freckleGaps).toBeGreaterThan(0.92)
    expect(gladeGaps / freckleGaps).toBeLessThan(1.08)
  })

  it('is reproducible from a seed', () => {
    const a = generateForest({}, mulberry32(42))
    const b = generateForest({}, mulberry32(42))
    expect([...a.kind]).toEqual([...b.kind])
  })

  it('starts with nothing alight', () => {
    const world = generateForest({}, mulberry32(1))
    expect(world.burning.size).toBe(0)
    expect([...world.state].every((s) => s === ALIVE)).toBe(true)
  })
})

describe('ignite', () => {
  it('lights a living tree and books its burn-out', () => {
    const world = solidForest()
    expect(ignite(world, cellAt(10, 10))).toBe(true)
    expect(world.state[cellAt(10, 10)]).toBe(BURNING)
    expect(world.burnUntil[cellAt(10, 10)]).toBe(DEFAULTS.burnSeconds)
    expect(world.burning.has(cellAt(10, 10))).toBe(true)
  })

  it('will not light bare ground, a cell already alight, or one off the map', () => {
    const world = solidForest()
    const bare = cellAt(5, 5)
    world.kind[bare] = TERRAIN.findIndex((t) => !t.burns)
    expect(ignite(world, bare)).toBe(false)
    const tree = cellAt(6, 6)
    ignite(world, tree)
    expect(ignite(world, tree)).toBe(false)
    expect(ignite(world, -1)).toBe(false)
    expect(ignite(world, SIZE * SIZE)).toBe(false)
  })
})

describe('spawnFire', () => {
  it('finds somewhere to burn', () => {
    const world = solidForest()
    const i = spawnFire(world, mulberry32(9))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(world.burning.size).toBe(1)
  })

  it('gives up rather than looping forever when nothing is left to burn', () => {
    const world = solidForest()
    world.kind.fill(TERRAIN.findIndex((t) => !t.burns))
    expect(spawnFire(world, mulberry32(9))).toBe(-1)
  })
})

describe('step', () => {
  it('dries the ground out again once its time is up', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    world.opts.spreadPerSecond = 0
    const reached = KERNEL.flat().filter((p) => p > 0).length
    douse(world, 43, 20, () => 0)
    step(world, world.opts.wetSeconds - 1, () => 0.99)
    expect(world.wet.size).toBe(reached)
    expect(ignite(world, cellAt(43, 20))).toBe(false)
    step(world, 2, () => 0.99)
    expect(world.wet.size).toBe(0)
    expect(ignite(world, cellAt(43, 20))).toBe(true)
  })

  it('burns a cell out after its time and counts it lost', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    world.opts.spreadPerSecond = 0
    const i = cellAt(50, 50)
    ignite(world, i)
    step(world, DEFAULTS.burnSeconds - 1, () => 0.99)
    expect(world.state[i]).toBe(BURNING)
    step(world, 2, () => 0.99)
    expect(world.state[i]).toBe(BURNED)
    expect(world.lost).toBe(1)
    expect(world.burning.size).toBe(0)
  })

  it('counts a lost house separately', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    world.opts.spreadPerSecond = 0
    const i = cellAt(20, 20)
    world.kind[i] = HOUSE_KIND
    ignite(world, i)
    step(world, DEFAULTS.burnSeconds + 1, () => 0.99)
    expect(world.housesLost).toBe(1)
  })

  it('spreads to the eight neighbours when the roll always succeeds', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    ignite(world, cellAt(50, 50))
    step(world, 0.1, () => 0)
    expect(world.burning.size).toBe(9)
    expect(world.state[cellAt(49, 49)]).toBe(BURNING)
    expect(world.state[cellAt(51, 51)]).toBe(BURNING)
  })

  it('does not let a cell lit this tick spread in the same tick', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    ignite(world, cellAt(50, 50))
    step(world, 0.1, () => 0)
    // A second ring would mean 25 cells; one tick may only reach the first.
    expect(world.burning.size).toBe(9)
  })

  it('never spreads off the edge of the map', () => {
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    ignite(world, cellAt(0, 0))
    step(world, 0.1, () => 0)
    expect(world.burning.size).toBe(4)
  })

  it('spreads at the same rate however finely it is ticked', () => {
    // One burning cell with exactly one burnable neighbour and nothing else
    // to catch, so a run measures the spread chance itself and not a cascade.
    // Over one second at 0.5/sec that neighbour should light about half the
    // time — whether the second arrives as one tick or as twenty.
    const caught = (dt, seed) => {
      const world = solidForest()
      world.opts.spawnPerSecond = 0
      world.opts.spawnRamp = 0
      world.opts.spreadPerSecond = 0.5
      world.opts.burnSeconds = 1e6
      const bare = TERRAIN.findIndex((t) => !t.burns)
      world.kind.fill(bare)
      const centre = cellAt(50, 50)
      const target = cellAt(51, 50)
      world.kind[centre] = 0
      world.kind[target] = 0
      const rng = mulberry32(seed)
      ignite(world, centre)
      for (let t = 0; t < 1 - 1e-9; t += dt) step(world, dt, rng)
      return world.state[target] === BURNING ? 1 : 0
    }
    const RUNS = 400
    const mean = (dt) => {
      let total = 0
      for (let seed = 1; seed <= RUNS; seed++) total += caught(dt, seed)
      return total / RUNS
    }
    const fine = mean(0.05)
    const coarse = mean(1)
    expect(fine).toBeGreaterThan(0.42)
    expect(fine).toBeLessThan(0.58)
    expect(coarse).toBeGreaterThan(0.42)
    expect(coarse).toBeLessThan(0.58)
  })

  it('spawns new fires at the stated rate, and more of them as a round wears on', () => {
    const world = solidForest()
    world.opts.spreadPerSecond = 0
    world.opts.burnSeconds = 1e6
    world.opts.spawnPerSecond = 1
    world.opts.spawnRamp = 0
    const rng = mulberry32(5)
    for (let t = 0; t < 20; t++) step(world, 1, rng)
    expect(world.burning.size).toBeGreaterThan(10)
    expect(world.burning.size).toBeLessThanOrEqual(20)
  })

  it('spawns more than one fire in a step that is due more than one', () => {
    const world = solidForest()
    world.opts.spreadPerSecond = 0
    world.opts.burnSeconds = 1e6
    world.opts.spawnPerSecond = 3
    world.opts.spawnRamp = 0
    step(world, 1, mulberry32(2))
    expect(world.burning.size).toBeGreaterThanOrEqual(3)
  })

  it('is tuned above the threshold where a fire dies out on its own', () => {
    // 8 neighbours × spread × burnSeconds must exceed 1 or every fire fizzles.
    expect(8 * DEFAULTS.spreadPerSecond * DEFAULTS.burnSeconds).toBeGreaterThan(1)
    const world = solidForest()
    world.opts.spawnPerSecond = 0
    world.opts.spawnRamp = 0
    const rng = mulberry32(4)
    ignite(world, cellAt(50, 50))
    for (let t = 0; t < 40; t += 0.1) step(world, 0.1, rng)
    expect(world.lost + world.burning.size).toBeGreaterThan(20)
  })
})

describe('douse', () => {
  it('puts out the cell it lands on', () => {
    const world = solidForest()
    ignite(world, cellAt(43, 20))
    expect(douse(world, 43, 20, () => 0)).toBeGreaterThanOrEqual(1)
    expect(world.state[cellAt(43, 20)]).toBe(ALIVE)
    expect(world.doused).toBeGreaterThanOrEqual(1)
  })

  it('is never certain, not even in the middle', () => {
    // One release out of the dozen the plane makes on its way round; a sure
    // thing here would make the whole circuit one.
    const world = solidForest()
    ignite(world, cellAt(43, 20))
    expect(douse(world, 43, 20, () => 0.999)).toBe(0)
    expect(world.state[cellAt(43, 20)]).toBe(BURNING)
  })

  it('reaches the whole 5×5 when every roll lands', () => {
    const world = solidForest()
    const reached = KERNEL.flat().filter((p) => p > 0).length
    for (let dy = -KERNEL_REACH; dy <= KERNEL_REACH; dy++) {
      for (let dx = -KERNEL_REACH; dx <= KERNEL_REACH; dx++) ignite(world, cellAt(43 + dx, 20 + dy))
    }
    expect(douse(world, 43, 20, () => 0)).toBe(reached)
  })

  it('misses the corners when the roll is above their chance', () => {
    const world = solidForest()
    for (let dy = -KERNEL_REACH; dy <= KERNEL_REACH; dy++) {
      for (let dx = -KERNEL_REACH; dx <= KERNEL_REACH; dx++) ignite(world, cellAt(43 + dx, 20 + dy))
    }
    // A roll of 0.5 is 50: it beats everything above 50 and nothing below it.
    expect(douse(world, 43, 20, () => 0.5)).toBe(KERNEL.flat().filter((p) => p > 50).length)
  })

  it('wets what it lands on, so the drop is a break and not just a rescue', () => {
    const world = solidForest()
    const reached = KERNEL.flat().filter((p) => p > 0).length
    douse(world, 43, 20, () => 0)
    expect(world.wet.size).toBe(reached)
    // Nothing can catch there while it is wet — that is what containing a
    // fire front means, and what a drop ahead of the fire buys.
    expect(ignite(world, cellAt(43, 20))).toBe(false)
    expect(ignite(world, cellAt(43 + KERNEL_REACH, 20))).toBe(false)
    expect(ignite(world, cellAt(43 + KERNEL_REACH + 1, 20))).toBe(true)
  })

  it('does not water ground that has already burned', () => {
    const world = solidForest()
    const reached = KERNEL.flat().filter((p) => p > 0).length
    world.state[cellAt(43, 20)] = BURNED
    douse(world, 43, 20, () => 0)
    expect(world.wet.has(cellAt(43, 20))).toBe(false)
    expect(world.wet.size).toBe(reached - 1)
  })

  it('wets only where the kernel says the water landed', () => {
    const world = solidForest()
    douse(world, 43, 20, () => 0.5)
    expect(world.wet.size).toBe(KERNEL.flat().filter((p) => p > 50).length)
  })

  it('leaves burned and living cells alone, and clips at the edge', () => {
    const world = solidForest()
    const burnedCell = cellAt(1, 1)
    world.state[burnedCell] = BURNED
    expect(douse(world, 0, 0, () => 0)).toBe(0)
    expect(world.state[burnedCell]).toBe(BURNED)
  })
})

describe('stats', () => {
  it('reports the share of the forest still standing', () => {
    const world = solidForest()
    expect(stats(world).saved).toBe(1)
    world.lost = world.burnable / 4
    expect(stats(world).saved).toBe(0.75)
  })

  it('calls a forest with nothing in it fully saved rather than dividing by zero', () => {
    const world = solidForest()
    world.burnable = 0
    expect(stats(world).saved).toBe(1)
  })

  it('carries the houses, the fires alight and the ground still wet', () => {
    const world = solidForest()
    ignite(world, cellAt(3, 3))
    douse(world, 50, 50, () => 0)
    const s = stats(world)
    expect(s.burning).toBe(1)
    expect(s.wet).toBe(KERNEL.flat().filter((p) => p > 0).length)
    expect(s.houses).toBe(world.houses)
    expect(s.housesLost).toBe(0)
  })
})

describe('glyphs', () => {
  it('takes the first link a device can draw', () => {
    const glyphs = resolveGlyphs(() => true)
    expect(glyphs.mushroom).toBe(GLYPH_CHAINS.mushroom[0])
    expect(glyphs.deadwood).toBe(GLYPH_CHAINS.deadwood[0])
  })

  it('falls back rather than leaving a tofu box', () => {
    const newest = new Set([GLYPH_CHAINS.mushroom[0], GLYPH_CHAINS.deadwood[0], GLYPH_CHAINS.rock[0]])
    const glyphs = resolveGlyphs((g) => !newest.has(g))
    expect(glyphs.mushroom).toBe(GLYPH_CHAINS.mushroom[1])
    expect(glyphs.deadwood).toBe(GLYPH_CHAINS.deadwood[1])
    expect(glyphs.rock).toBe(GLYPH_CHAINS.rock[1])
  })

  it('keeps the last link when a device can draw none of them', () => {
    const glyphs = resolveGlyphs(() => false)
    for (const [slot, chain] of Object.entries(GLYPH_CHAINS)) {
      expect(glyphs[slot]).toBe(chain[chain.length - 1])
    }
  })

  it('draws a cell as its terrain, as fire, or as what is left of it', () => {
    const glyphs = resolveGlyphs()
    const fir = TERRAIN.findIndex((t) => t.id === 'fir')
    expect(cellGlyph(fir, ALIVE, glyphs)).toBe(glyphs.fir)
    expect(cellGlyph(fir, BURNING, glyphs)).toBe(glyphs.fire)
    expect(cellGlyph(fir, BURNED, glyphs)).toBe(glyphs.deadwood)
    expect(cellGlyph(HOUSE_KIND, ALIVE, glyphs)).toBe(glyphs.house)
    expect(cellGlyph(HOUSE_KIND, BURNED, glyphs)).toBe(glyphs.houseBurned)
  })
})

describe('the drop', () => {
  it('is a disc around where the water was released', () => {
    expect(KERNEL.length).toBe(KERNEL_REACH * 2 + 1)
    const centre = KERNEL[KERNEL_REACH][KERNEL_REACH]
    for (const row of KERNEL) for (const v of row) expect(v).toBeLessThanOrEqual(centre)
    // Corners are out of reach; the edge midpoints are not.
    expect(KERNEL[0][0]).toBe(0)
    expect(KERNEL[0][KERNEL_REACH]).toBeGreaterThan(0)
  })

  it('is what #726 asks for and no more: never certain, even in the middle', () => {
    // The plane releases a dozen times on the way round, so one puff being a
    // sure thing would make the whole circuit one.
    expect(KERNEL[KERNEL_REACH][KERNEL_REACH]).toBeLessThan(100)
  })
})

describe('coordinates', () => {
  it('writes a square as the four digits the learner types', () => {
    expect(coordinateLabel(12, 3)).toBe('1203')
    expect(coordinateLabel(43, 20)).toBe('4320')
    expect(coordinateLabel(0, 0)).toBe('0000')
    expect(coordinateLabel(99, 99)).toBe('9999')
  })

  it('reads two spoken numbers as a square', () => {
    expect(coordinateFrom([43, 20])).toEqual({ x: 43, y: 20 })
    expect(coordinateFrom([0, 0])).toEqual({ x: 0, y: 0 })
    expect(coordinateFrom([99, 99])).toEqual({ x: 99, y: 99 })
  })

  it('accepts a half under ten said either way', () => {
    // 1203 read off the screen digit-pair by digit-pair is «двенадцать ноль
    // три»; said as a number it is «двенадцать три». Both mean the same square,
    // and rejecting the first would teach a reading the box does not take.
    expect(coordinateFrom([12, 3])).toEqual({ x: 12, y: 3 })
    expect(coordinateFrom([12, 0, 3])).toEqual({ x: 12, y: 3 })
    expect(coordinateFrom([0, 3, 12])).toEqual({ x: 3, y: 12 })
    expect(coordinateFrom([0, 3, 0, 5])).toEqual({ x: 3, y: 5 })
  })

  it('does not swallow a zero that is a half in its own right', () => {
    expect(coordinateFrom([43, 0])).toEqual({ x: 43, y: 0 })
    expect(coordinateFrom([0, 43])).toEqual({ x: 0, y: 43 })
    // The ambiguous case: «ноль оди́н» is 0001 — two halves — and not the start
    // of a half 01-something, because reading it that way leaves nothing for
    // the second half. The plain reading wins whenever it completes.
    expect(coordinateFrom([0, 1])).toEqual({ x: 0, y: 1 })
    expect(coordinateFrom([0, 9])).toEqual({ x: 0, y: 9 })
  })

  it('names no square for anything else', () => {
    expect(coordinateFrom(null)).toBe(null)
    expect(coordinateFrom([])).toBe(null)
    expect(coordinateFrom([43])).toBe(null)
    expect(coordinateFrom([43, 20, 7])).toBe(null)
  })

  it('round-trips every square on the map', () => {
    for (const x of [0, 1, 9, 10, 43, 99]) {
      for (const y of [0, 1, 9, 10, 20, 99]) {
        const label = coordinateLabel(x, y)
        expect(coordinateFrom([Number(label.slice(0, 2)), Number(label.slice(2))])).toEqual({ x, y })
      }
    }
  })
})

describe('planePath', () => {
  const to = { x: 50, y: 50 }
  const turn = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))

  it('starts and ends off the map, so the plane flies in and away', () => {
    const offMap = (p) => p.x < 0 || p.y < 0 || p.x > SIZE - 1 || p.y > SIZE - 1
    for (let i = 1; i <= 24; i++) {
      for (const target of [to, { x: 0, y: 0 }, { x: 99, y: 4 }]) {
        const flight = planePath(target, approachHeading(mulberry32(i)))
        expect(offMap(flight.at(0))).toBe(true)
        expect(offMap(flight.at(1))).toBe(true)
      }
    }
  })

  it('circles the fire rather than passing over it', () => {
    const flight = planePath(to, 0.7)
    let onTheLoop = 0
    for (let t = 0; t <= 1; t += 0.001) {
      const p = flight.at(t)
      if (Math.abs(Math.hypot(p.x - to.x, p.y - to.y) - PLANE.loopRadius) < 0.01) onTheLoop++
    }
    // A quarter of the flight or more is spent at exactly the loop's radius.
    expect(onTheLoop / 1000).toBeGreaterThan(0.25)
  })

  it('goes all the way round, and comes out on a different tangent', () => {
    const flight = planePath(to, 0.7)
    // Every direction from the fire is flown over at some point in the circuit.
    const seen = new Set()
    for (let t = 0; t <= 1; t += 0.001) {
      const p = flight.at(t)
      if (Math.abs(Math.hypot(p.x - to.x, p.y - to.y) - PLANE.loopRadius) > 0.01) continue
      seen.add(Math.floor((Math.atan2(p.y - to.y, p.x - to.x) + Math.PI) / (Math.PI / 8)))
    }
    expect(seen.size).toBe(16)
    // …and it leaves on a heading a quarter turn off the one it arrived on,
    // rather than back out along the line it came in on.
    expect(turn(flight.at(0).angle, flight.at(1).angle)).toBeCloseTo(Math.PI / 2, 6)
  })

  it('flies a smooth path at one speed, with no kink where the legs meet the arc', () => {
    const flight = planePath(to, 0.7)
    const steps = []
    let prev = flight.at(0)
    for (let t = 0.002; t <= 1; t += 0.002) {
      const next = flight.at(t)
      steps.push(Math.hypot(next.x - prev.x, next.y - prev.y))
      // A kink would show as the heading jumping between two samples.
      expect(turn(prev.angle, next.angle)).toBeLessThan(0.1)
      prev = next
    }
    // Constant speed: every step covers the same ground.
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.15)
  })

  it('reports how far it is, so a caller can fly it at a fixed speed', () => {
    const flight = planePath(to, 0.7)
    let walked = 0
    let prev = flight.at(0)
    for (let t = 0.001; t <= 1; t += 0.001) {
      const next = flight.at(t)
      walked += Math.hypot(next.x - prev.x, next.y - prev.y)
      prev = next
    }
    expect(walked).toBeCloseTo(flight.length, 0)
  })

  it('releases water all the way round, inside the circle it is flying', () => {
    const flight = planePath(to, 0.7)
    expect(flight.releases).toHaveLength(PLANE.releases)
    const angles = new Set()
    for (const drop of flight.releases) {
      expect(Math.hypot(drop.x - to.x, drop.y - to.y)).toBeCloseTo(PLANE.dropRadius, 6)
      angles.add(Math.floor((Math.atan2(drop.y - to.y, drop.x - to.x) + Math.PI) / (Math.PI / 4)))
    }
    // Spread right round the fire, not bunched on one side.
    expect(angles.size).toBe(8)
  })

  it('releases only while it is on the loop, and in order', () => {
    const flight = planePath(to, 0.7)
    let last = 0
    for (const drop of flight.releases) {
      expect(drop.t).toBeGreaterThan(last)
      last = drop.t
      const p = flight.at(drop.t)
      expect(Math.hypot(p.x - to.x, p.y - to.y)).toBeCloseTo(PLANE.loopRadius, 6)
    }
    expect(last).toBeLessThan(1)
  })

  it('lays a wet ring that soaks the middle and reaches well past it', () => {
    const world = solidForest()
    const flight = planePath({ x: 50, y: 50 }, 0.7)
    const rng = mulberry32(2)
    for (const drop of flight.releases) douse(world, Math.round(drop.x), Math.round(drop.y), rng)
    // Bigger than the single 5×5 blot #726 describes — the point of circling.
    expect(world.wet.size).toBeGreaterThan(60)
    let reach = 0
    for (const i of world.wet) {
      const x = i % SIZE
      reach = Math.max(reach, Math.hypot(x - 50, (i - x) / SIZE - 50))
    }
    expect(reach).toBeGreaterThan(PLANE.dropRadius + 2)
    // The fire the learner actually typed is in the middle of it, not in a hole.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) expect(world.wet.has(cellAt(50 + dx, 50 + dy))).toBe(true)
    }
  })

  it('takes a heading, so repeated drops ring a fire from different sides', () => {
    const a = planePath(to, 0)
    const b = planePath(to, Math.PI)
    expect(a.at(0).x).not.toBeCloseTo(b.at(0).x, 1)
  })

  it('clamps a fraction outside the flight to its ends', () => {
    const flight = planePath(to, 0.7)
    expect(flight.at(-1)).toEqual(flight.at(0))
    expect(flight.at(2)).toEqual(flight.at(1))
  })
})

describe('approachHeading', () => {
  it('is a direction, and not always the same one', () => {
    const seen = new Set()
    for (let i = 1; i <= 30; i++) {
      const heading = approachHeading(mulberry32(i))
      expect(heading).toBeGreaterThanOrEqual(0)
      expect(heading).toBeLessThan(2 * Math.PI)
      seen.add(Math.floor(heading))
    }
    expect(seen.size).toBeGreaterThan(3)
  })
})
