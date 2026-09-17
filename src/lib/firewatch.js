// Firewatch minigame (#731).
//
// The learner watches a forest burn and puts the fires out by *saying where*:
// two numbers, 0–99, typed as Russian words. Building a two-digit number and
// producing it at speed is the habit; the fire is the clock.
//
// Everything here is pure and seedable — the forest, the spread, the kernel a
// water drop lands with, and the curve the plane flies. The view owns the
// canvas, the timers and the typing, and nothing else. That split is what lets
// the difficulty be tuned from a test rather than by playing (open question 4
// on #731): `step` takes its own `dt` and `rng`, so a whole two-minute round
// can be simulated in a millisecond.

// ── The world ────────────────────────────────────────────────────────────
// 100 × 100, because the pedagogy picked the axes: a coordinate is exactly the
// two-digit range the learner is drilling. Nothing about the *display* follows
// from that — the view decides how many pixels a cell gets.
export const SIZE = 100

/** Cell states. Bare ground never leaves ALIVE. */
export const ALIVE = 0
export const BURNING = 1
export const BURNED = 2

/**
 * The plane's 5×5 drop, as percentage chances of putting a burning cell out.
 * Straight from #726: certain in the middle, a coin-flip at the corners of the
 * inner ring, mostly a miss at the edges. Being *unreliable* is the design —
 * it means a fire front needs several numbers, not one.
 */
export const KERNEL = [
  [10, 30, 50, 30, 10],
  [30, 50, 80, 50, 30],
  [50, 80, 100, 80, 50],
  [30, 50, 80, 50, 30],
  [10, 30, 50, 30, 10],
]

// ── Terrain ──────────────────────────────────────────────────────────────
// `glyph` and `burnedGlyph` are *names*, not emoji: which character actually
// renders is decided per device by `resolveGlyphs` below.
/** @type {{id: string, glyph: string, burnedGlyph?: string, burns: boolean}[]} */
export const TERRAIN = [
  { id: 'fir', glyph: 'fir', burns: true },
  { id: 'palm', glyph: 'palm', burns: true },
  { id: 'broadleaf', glyph: 'broadleaf', burns: true },
  { id: 'cactus', glyph: 'cactus', burns: true },
  { id: 'bamboo', glyph: 'bamboo', burns: true },
  { id: 'spruce', glyph: 'spruce', burns: true },
  { id: 'house', glyph: 'house', burnedGlyph: 'houseBurned', burns: true },
  { id: 'rock', glyph: 'rock', burns: false },
  { id: 'dirt', glyph: 'dirt', burns: false },
  { id: 'mushroom', glyph: 'mushroom', burns: false },
]

const kindOf = (id) => TERRAIN.findIndex((t) => t.id === id)
/** The six tree species a Voronoi cell can be seeded with. */
export const TREE_KINDS = TERRAIN.map((t, i) => (t.burns && t.id !== 'house' ? i : -1)).filter(
  (i) => i >= 0,
)
/** The three kinds that never burn — the gaps scattered inside a stand. */
export const BARE_KINDS = TERRAIN.map((t, i) => (t.burns ? -1 : i)).filter((i) => i >= 0)
/**
 * What a whole *clearing* can be made of, which is not the same list: a
 * hundred mushrooms together is a red blotch, and a red blotch on this map
 * means fire. Rock and dirt read as ground at any size; mushrooms only ever
 * appear scattered, a few cells at a time.
 */
export const CLEARING_KINDS = [kindOf('rock'), kindOf('dirt')]
export const HOUSE_KIND = kindOf('house')

// ── Glyphs ───────────────────────────────────────────────────────────────
// Open question 3 on #731: 🪾 (Unicode 15.1) and 🍄‍🟫 (a ZWJ sequence) are tofu
// on older devices, and a ZWJ sequence that fails renders as *two* emoji
// rather than as tofu, so neither is safe to hard-code. Each slot is a chain,
// most-wanted first, and the view hands `resolveGlyphs` a predicate that can
// actually look at what the device drew.
/** @type {Record<string, string[]>} */
export const GLYPH_CHAINS = {
  fir: ['\u{1F332}'], // 🌲
  palm: ['\u{1F334}'], // 🌴
  broadleaf: ['\u{1F333}'], // 🌳
  cactus: ['\u{1F335}'], // 🌵
  bamboo: ['\u{1F38B}'], // 🎋
  spruce: ['\u{1F384}'], // 🎄
  house: ['\u{1F3E0}'], // 🏠
  houseBurned: ['\u{1F3DA}️', '\u{1F3DA}'], // 🏚️
  rock: ['\u{1FAA8}', '⛰️'], // 🪨 → ⛰️
  dirt: ['\u{1F7EB}', '\u{1F7E4}'], // 🟫 → 🟤
  mushroom: ['\u{1F344}‍\u{1F7EB}', '\u{1F344}'], // 🍄‍🟫 → 🍄
  deadwood: ['\u{1FABE}', '\u{1FAB5}'], // 🪾 → 🪵
  fire: ['\u{1F525}'], // 🔥
  water: ['\u{1F4A6}'], // 💦
  plane: ['✈️', '✈'], // ✈️
}

/**
 * Pick the first glyph in each chain the device can actually draw. Falls back
 * to the last link rather than to nothing: a tofu box is a worse forest than a
 * wrong-but-legible tree, and every chain's last link predates 2019.
 * @param {(glyph: string) => boolean} [supports]
 * @returns {Record<string, string>}
 */
export function resolveGlyphs(supports = () => true) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [slot, chain] of Object.entries(GLYPH_CHAINS)) {
    out[slot] = chain.find((g) => supports(g)) ?? chain[chain.length - 1]
  }
  return out
}

/**
 * What a cell looks like right now. Bare ground has no burned form because it
 * never burns, so BURNED always means a tree or a house.
 * @param {number} kind
 * @param {number} state
 * @param {Record<string, string>} glyphs
 * @returns {string}
 */
export function cellGlyph(kind, state, glyphs) {
  const terrain = TERRAIN[kind]
  if (state === BURNING) return glyphs.fire
  if (state === BURNED) return glyphs[terrain.burnedGlyph ?? 'deadwood']
  return glyphs[terrain.glyph]
}

// ── Tuning ───────────────────────────────────────────────────────────────
// Open question 4 on #731 asked for a tuning pass. These numbers are the
// answer, and they were found by simulating whole rounds rather than by
// playing: a model player who drops on the biggest blaze every N seconds,
// swept against spread and spawn rates, twelve seeded forests apiece.
//
// Two things the sweep settled:
//
//  - #726's 0.01/sec per neighbouring fire is *sub-critical*. A cell burns for
//    `burnSeconds` with eight neighbours, so a fire only grows when
//    8 × spread × burnSeconds > 1 — above ~0.018 at a seven-second burn. At
//    0.01 every fire quietly goes out by itself and there is nothing to do.
//
//  - Fires must be few and fierce, not many and mild. A learner types perhaps
//    twenty coordinates in two minutes, so a round that starts forty fires is
//    lost however well it is played, and the score stops measuring anything.
//    A dozen starts, each of which becomes a disaster if ignored, is what
//    makes the difference between playing and not playing visible.
//
// Where they land, as the share of the forest lost over a two-minute round:
//   left alone      ~24%     a drop every 8s   ~16%
//   a drop every 6s  ~8%     a drop every 4s    ~3%
export const DEFAULTS = {
  /** Chance per second that one burning cell lights one given neighbour. */
  spreadPerSecond: 0.052,
  /** How long a cell burns before it is lost for good. */
  burnSeconds: 7,
  /** New fires per second at the start of a round. */
  spawnPerSecond: 0.04,
  /** …and how much that grows per second elapsed, so a round has a curve. */
  spawnRamp: 0.0008,
  /**
   * How long ground the plane has wetted stays too wet to catch.
   *
   * This is what makes the game a game. Water that only puts fires out cannot
   * beat a mature blaze: the kernel reaches 25 cells and a front's perimeter
   * is longer than that, so every doused cell is relit by its neighbours the
   * same second and skilled play scores barely better than doing nothing (a
   * whole parameter sweep of spread and spawn rates says so). Wetted ground
   * turns the same drop into a break, which is both how aerial firefighting
   * actually works and the thing that rewards putting the plane *ahead* of
   * the fire rather than on top of it.
   */
  wetSeconds: 12,
  /** Roughly one cell in this many is a house. */
  houseRate: 0.012,
  /** …and one in this many is a gap in the canopy. */
  gapRate: 0.05,
  /** Voronoi seeds. Few enough that stands are large and obviously mixed. */
  seeds: 28,
}

/** @typedef {ReturnType<typeof generateForest>} World */

const idx = (x, y) => y * SIZE + x
/** Cell index for a coordinate pair, or -1 when it is off the map. */
export function cellAt(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1
  return idx(x, y)
}

const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

/**
 * Lay out a forest with Voronoi noise: a handful of seeds, each a species, and
 * every cell takes its nearest seed. That gives stands rather than static —
 * which matters because a fire spreading through one species reads as a front,
 * where a per-cell shuffle reads as noise. Houses and canopy gaps are then
 * scattered on top at random, as #726 asks.
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @param {() => number} [rng]
 */
export function generateForest(opts = {}, rng = Math.random) {
  const settings = { ...DEFAULTS, ...opts }
  const seeds = []
  for (let s = 0; s < settings.seeds; s++) {
    // One seed in six is a clearing, so the bare ground clumps like the trees
    // do instead of freckling the whole map.
    const bare = rng() < 1 / 6
    const pool = bare ? CLEARING_KINDS : TREE_KINDS
    seeds.push({
      x: rng() * SIZE,
      y: rng() * SIZE,
      kind: pool[Math.floor(rng() * pool.length)],
    })
  }

  const kind = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let best = 0
      let bestD = Infinity
      for (const seed of seeds) {
        const dx = seed.x - x
        const dy = seed.y - y
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = seed.kind
        }
      }
      kind[idx(x, y)] = best
    }
  }

  let houses = 0
  let burnable = 0
  for (let i = 0; i < kind.length; i++) {
    const roll = rng()
    if (TERRAIN[kind[i]].burns) {
      if (roll < settings.houseRate) kind[i] = HOUSE_KIND
      else if (roll < settings.houseRate + settings.gapRate) {
        kind[i] = BARE_KINDS[Math.floor(rng() * BARE_KINDS.length)]
      }
    }
    if (kind[i] === HOUSE_KIND) houses++
    if (TERRAIN[kind[i]].burns) burnable++
  }

  return {
    opts: settings,
    kind,
    state: new Uint8Array(SIZE * SIZE),
    /** When each burning cell is lost, in world seconds. */
    burnUntil: new Float32Array(SIZE * SIZE),
    /** …and when each wetted cell dries out again. */
    wetUntil: new Float32Array(SIZE * SIZE),
    /** @type {Set<number>} indices currently on fire. */
    burning: new Set(),
    /** @type {Set<number>} indices too wet to catch. */
    wet: new Set(),
    /** @type {Set<number>} indices whose look changed since the view last drew. */
    changed: new Set(),
    time: 0,
    burnable,
    houses,
    lost: 0,
    housesLost: 0,
    doused: 0,
  }
}

/**
 * Set one cell alight. Returns false when there was nothing there to burn.
 * @param {World} world
 * @param {number} i
 */
export function ignite(world, i) {
  if (i < 0 || i >= world.state.length) return false
  if (world.state[i] !== ALIVE || !TERRAIN[world.kind[i]].burns) return false
  if (world.wetUntil[i] > world.time) return false
  world.state[i] = BURNING
  world.burnUntil[i] = world.time + world.opts.burnSeconds
  world.burning.add(i)
  world.changed.add(i)
  return true
}

/**
 * Start a fire somewhere at random. Rejection-sampled rather than built from a
 * list of every living cell: the list would be 10 000 entries rebuilt every
 * spawn, and after a few tries a random cell is almost always alive.
 * @param {World} world
 * @param {() => number} [rng]
 */
export function spawnFire(world, rng = Math.random) {
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(rng() * world.state.length)
    if (ignite(world, i)) return i
  }
  return -1
}

/**
 * Advance the simulation by `dt` seconds.
 *
 * Order matters: cells burn out first, then the fires that are still alight
 * spread, then new fires spawn. Ignitions are collected before any of them is
 * applied, so a cell lit this tick cannot also spread this tick — otherwise
 * the front's speed would depend on the order `burning` happens to iterate in.
 * @param {World} world
 * @param {number} dt seconds
 * @param {() => number} [rng]
 */
export function step(world, dt, rng = Math.random) {
  world.time += dt

  for (const i of [...world.wet]) {
    if (world.wetUntil[i] > world.time) continue
    world.wet.delete(i)
    world.changed.add(i)
  }

  for (const i of [...world.burning]) {
    if (world.time < world.burnUntil[i]) continue
    world.state[i] = BURNED
    world.burning.delete(i)
    world.changed.add(i)
    world.lost++
    if (world.kind[i] === HOUSE_KIND) world.housesLost++
  }

  // Per-neighbour chance compounded over dt, so the spread rate is the same
  // whether the view ticks at 10Hz or the tuner runs a round in one step.
  const p = 1 - Math.pow(1 - world.opts.spreadPerSecond, dt)
  const lighting = new Set()
  for (const i of world.burning) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    for (const [dx, dy] of NEIGHBOURS) {
      const j = cellAt(x + dx, y + dy)
      if (j < 0 || lighting.has(j)) continue
      if (world.state[j] !== ALIVE || !TERRAIN[world.kind[j]].burns) continue
      if (rng() < p) lighting.add(j)
    }
  }
  for (const j of lighting) ignite(world, j)

  let due = (world.opts.spawnPerSecond + world.opts.spawnRamp * world.time) * dt
  while (due > 0) {
    if (due >= 1 || rng() < due) spawnFire(world, rng)
    due -= 1
  }
}

/**
 * Drop water centred on (x, y). Every cell under the kernel gets its stated
 * percentage chance of being hit; a hit puts a fire out — back to ALIVE,
 * because the point of the game is saving trees and a save has to look like
 * one — and leaves the ground too wet to catch for `wetSeconds`.
 * @param {World} world
 * @param {number} x
 * @param {number} y
 * @param {() => number} [rng]
 * @returns {number} how many cells were put out
 */
export function douse(world, x, y, rng = Math.random) {
  let out = 0
  for (let ky = 0; ky < KERNEL.length; ky++) {
    for (let kx = 0; kx < KERNEL[ky].length; kx++) {
      const i = cellAt(x + kx - 2, y + ky - 2)
      if (i < 0) continue
      // One roll per cell decides everything about it: the kernel's number is
      // the chance the water lands there at all. Where it lands, a fire goes
      // out and the ground stays wet; where it misses, nothing happens.
      if (rng() * 100 >= KERNEL[ky][kx]) continue
      if (world.state[i] === BURNING) {
        world.state[i] = ALIVE
        world.burning.delete(i)
        out++
      }
      if (world.state[i] === BURNED) continue // nothing left to protect
      world.wetUntil[i] = world.time + world.opts.wetSeconds
      world.wet.add(i)
      world.changed.add(i)
    }
  }
  world.doused += out
  return out
}

/**
 * The scoreboard. `saved` is the share of burnable cells still standing —
 * cells currently alight are not counted as lost, because they need not be.
 * @param {World} world
 */
export function stats(world) {
  return {
    burnable: world.burnable,
    lost: world.lost,
    burning: world.burning.size,
    wet: world.wet.size,
    houses: world.houses,
    housesLost: world.housesLost,
    doused: world.doused,
    saved: world.burnable ? (world.burnable - world.lost) / world.burnable : 1,
  }
}

// ── The plane's path ─────────────────────────────────────────────────────
// #726 asks for an ice-cream cone: straight out, a smooth curve passing over
// the spot, straight back. That is exactly a circle through the target with
// the two tangents from where the plane came in — so it is built as one,
// rather than eyeballed with a Bézier, and the drop lands on the point of the
// arc that is the target rather than near it.

/** Fractions of the flight spent flying in, looping, and flying out. */
export const LEG_IN = 0.38
export const LEG_ARC = 0.34
/** When in the flight the water leaves the plane: the top of the loop. */
export const DROP_AT = LEG_IN + LEG_ARC / 2

/**
 * @param {{x: number, y: number}} from where the plane enters, in cell coords
 * @param {{x: number, y: number}} to   the target cell
 * @returns {(t: number) => {x: number, y: number, angle: number}} position and
 *   heading (radians, 0 = east) at a fraction `t` of the flight
 */
export function planePath(from, to) {
  let vx = from.x - to.x
  let vy = from.y - to.y
  let dist = Math.hypot(vx, vy)
  if (dist < 1e-6) {
    // A flight of no length has no direction to fly it in; pick one, at the
    // usual approach distance, rather than dividing by zero.
    vx = 0
    vy = -SIZE * 0.85
    dist = SIZE * 0.85
  }
  const nx = vx / dist
  const ny = vy / dist
  // The loop is a circle through the target, sitting between it and the
  // plane's approach, so the arc's far point *is* the target. Its radius is a
  // share of the approach, floored so a near-target drop still reads as a
  // loop and capped below dist/2 so the tangents below stay real.
  const r = Math.max(dist * 0.16, Math.min(2, dist * 0.4))
  const cx = to.x + r * nx
  const cy = to.y + r * ny
  const d = dist - r
  // Tangent points from `from` onto that circle. d > r always holds because r
  // is capped at 0.4·dist, which leaves d ≥ 0.6·dist.
  const alpha = Math.acos(Math.min(1, r / d))
  const phi = Math.atan2(from.y - cy, from.x - cx)
  const onCircle = (angle) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  const a = onCircle(phi + alpha)
  const b = onCircle(phi - alpha)
  const sweep = 2 * Math.PI - 2 * alpha // the long way round, over the target
  const straight = (p0, p1, u) => ({
    x: p0.x + (p1.x - p0.x) * u,
    y: p0.y + (p1.y - p0.y) * u,
    angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
  })

  return (t) => {
    const u = Math.min(1, Math.max(0, t))
    if (u < LEG_IN) return straight(from, a, u / LEG_IN)
    if (u < LEG_IN + LEG_ARC) {
      const theta = phi + alpha + ((u - LEG_IN) / LEG_ARC) * sweep
      const p = onCircle(theta)
      return { x: p.x, y: p.y, angle: theta + Math.PI / 2 }
    }
    return straight(b, from, (u - LEG_IN - LEG_ARC) / (1 - LEG_IN - LEG_ARC))
  }
}

/**
 * Where a plane comes in from: just off the edge of the map, in a random
 * direction. Found by walking a ray out from the target to the map's boundary
 * rather than by stepping a fixed distance, because a fixed distance puts a
 * plane heading for the middle of the map far off screen — and a plane nobody
 * sees until it is already looping is not the plane #726 describes.
 * @param {{x: number, y: number}} to
 * @param {() => number} [rng]
 * @param {number} [margin] how far beyond the edge it starts, in cells
 */
export function approachFrom(to, rng = Math.random, margin = 6) {
  const angle = rng() * 2 * Math.PI
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const lo = -margin
  const hi = SIZE - 1 + margin
  // How far along the ray each wall is; the nearest one is the way out.
  const wall = (d, from) => (Math.abs(d) < 1e-9 ? Infinity : Math.max((lo - from) / d, (hi - from) / d))
  const reach = Math.min(wall(dx, to.x), wall(dy, to.y))
  return { x: to.x + reach * dx, y: to.y + reach * dy }
}
