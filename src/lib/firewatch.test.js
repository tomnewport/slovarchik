import { describe, it, expect } from 'vitest'

import {
  ALIVE,
  BURNED,
  BURNING,
  CLEARING_KINDS,
  DEFAULTS,
  DROP_AT,
  GLYPH_CHAINS,
  HOUSE_KIND,
  KERNEL,
  SIZE,
  TERRAIN,
  approachFrom,
  cellAt,
  cellGlyph,
  douse,
  generateForest,
  ignite,
  planePath,
  resolveGlyphs,
  spawnFire,
  stats,
  step,
} from './firewatch.js'
import { mulberry32 } from './seed.js'

/** A forest with no houses and no gaps: every cell burns, so spread is easy to reason about. */
function solidForest(seed = 1) {
  const world = generateForest({ houseRate: 0, gapRate: 0, seeds: 1 }, mulberry32(seed))
  world.kind.fill(0)
  world.burnable = world.kind.length
  return world
}

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
    douse(world, 43, 20, () => 0)
    step(world, world.opts.wetSeconds - 1, () => 0.99)
    expect(world.wet.size).toBe(25)
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
      const world = solidForest(seed)
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
  it('always puts out the cell under the middle of the kernel', () => {
    const world = solidForest()
    ignite(world, cellAt(43, 20))
    expect(douse(world, 43, 20, () => 0.999)).toBe(1)
    expect(world.state[cellAt(43, 20)]).toBe(ALIVE)
    expect(world.doused).toBe(1)
  })

  it('reaches the whole 5×5 when every roll lands', () => {
    const world = solidForest()
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ignite(world, cellAt(43 + dx, 20 + dy))
    expect(douse(world, 43, 20, () => 0)).toBe(25)
    expect(world.burning.size).toBe(0)
  })

  it('misses the corners when the roll is above their chance', () => {
    const world = solidForest()
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ignite(world, cellAt(43 + dx, 20 + dy))
    // 0.5 → 50: beats the 10s and the 30s, ties the 50s (which miss), loses to 80/100.
    const out = douse(world, 43, 20, () => 0.5)
    expect(out).toBe(KERNEL.flat().filter((p) => p > 50).length)
  })

  it('wets what it lands on, so the drop is a break and not just a rescue', () => {
    const world = solidForest()
    douse(world, 43, 20, () => 0)
    expect(world.wet.size).toBe(25)
    // Nothing can catch there while it is wet — that is what containing a
    // fire front means, and what a drop ahead of the fire buys.
    expect(ignite(world, cellAt(43, 20))).toBe(false)
    expect(ignite(world, cellAt(45, 22))).toBe(false)
    expect(ignite(world, cellAt(46, 20))).toBe(true)
  })

  it('does not water ground that has already burned', () => {
    const world = solidForest()
    world.state[cellAt(43, 20)] = BURNED
    douse(world, 43, 20, () => 0)
    expect(world.wet.has(cellAt(43, 20))).toBe(false)
    expect(world.wet.size).toBe(24)
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
    expect(s.wet).toBe(25)
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

describe('planePath', () => {
  const to = { x: 43, y: 20 }

  it('starts where the plane came in and ends back there', () => {
    const from = { x: -40, y: 20 }
    const at = planePath(from, to)
    expect(at(0).x).toBeCloseTo(from.x, 6)
    expect(at(0).y).toBeCloseTo(from.y, 6)
    expect(at(1).x).toBeCloseTo(from.x, 6)
    expect(at(1).y).toBeCloseTo(from.y, 6)
  })

  it('passes over the target at the moment it drops', () => {
    for (const from of [{ x: -40, y: 20 }, { x: 43, y: 120 }, { x: 130, y: -50 }]) {
      const p = planePath(from, to)(DROP_AT)
      expect(Math.hypot(p.x - to.x, p.y - to.y)).toBeLessThan(0.01)
    }
  })

  it('flies a continuous path with no jump at the seams', () => {
    const at = planePath({ x: -40, y: 20 }, to)
    let prev = at(0)
    for (let t = 0.01; t <= 1; t += 0.01) {
      const next = at(t)
      expect(Math.hypot(next.x - prev.x, next.y - prev.y)).toBeLessThan(6)
      prev = next
    }
  })

  it('turns smoothly: the heading never jumps, seams included', () => {
    const at = planePath({ x: -40, y: 20 }, to)
    // Smallest turn between two headings, so ±π does not read as a jump.
    const turn = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))
    let prev = at(0).angle
    for (let t = 0.005; t <= 1; t += 0.005) {
      const next = at(t).angle
      expect(turn(prev, next)).toBeLessThan(0.2)
      prev = next
    }
  })

  it('clamps a fraction outside the flight to its ends', () => {
    const at = planePath({ x: -40, y: 20 }, to)
    expect(at(-1)).toEqual(at(0))
    expect(at(2)).toEqual(at(1))
  })

  it('picks a direction rather than dividing by zero when there is no distance to fly', () => {
    const at = planePath({ x: 43, y: 20 }, to)
    expect(Number.isFinite(at(0.5).x)).toBe(true)
    expect(Number.isFinite(at(0.5).y)).toBe(true)
  })
})

describe('approachFrom', () => {
  const offMap = (p) => p.x < 0 || p.y < 0 || p.x > SIZE - 1 || p.y > SIZE - 1

  it('comes in from off the map, whichever corner the fire is in', () => {
    for (const to of [{ x: 50, y: 50 }, { x: 0, y: 0 }, { x: 99, y: 99 }, { x: 99, y: 3 }]) {
      for (let i = 1; i <= 40; i++) {
        expect(offMap(approachFrom(to, mulberry32(i)))).toBe(true)
      }
    }
  })

  it('starts just beyond the edge, not half a map away', () => {
    // The point of walking to the boundary: a plane heading for the middle
    // enters the picture straight away rather than spending its approach out
    // of sight.
    for (let i = 1; i <= 40; i++) {
      const from = approachFrom({ x: 50, y: 50 }, mulberry32(i))
      expect(Math.max(Math.abs(from.x - 49.5), Math.abs(from.y - 49.5))).toBeLessThan(SIZE)
      expect(Math.hypot(from.x - 50, from.y - 50)).toBeGreaterThan(SIZE / 2)
    }
  })

  it('takes a margin, so a plane can enter closer in or further out', () => {
    const near = approachFrom({ x: 50, y: 50 }, () => 0, 2)
    const far = approachFrom({ x: 50, y: 50 }, () => 0, 30)
    expect(far.x).toBeGreaterThan(near.x)
  })
})
