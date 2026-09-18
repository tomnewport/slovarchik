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

import { fbm2, perlin2 } from './noise.js'

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
 * What ONE release of water covers, as percentage chances of wetting a cell,
 * by its distance in cells from where the release happened.
 *
 * #726 gives a 5×5 table with 100 in the middle, for a plane that drops once.
 * This plane circles the fire and releases a dozen times on the way round
 * (see `planePath`), so the numbers here are what a single puff does and the
 * footprint is what they add up to: a wet ring a little wider than the circle
 * the plane flies, soaked in the middle where every release reaches. Each puff
 * stays unreliable, which is the part of #726's design that matters — a fire
 * front needs several numbers, not one.
 */
const DROP_PROFILE = [70, 60, 42, 22]

/** Square table of the profile above, by rounded Euclidean distance. */
function radialKernel(profile) {
  const reach = profile.length - 1
  const size = reach * 2 + 1
  return Array.from({ length: size }, (_, ky) =>
    Array.from({ length: size }, (_, kx) => {
      const d = Math.round(Math.hypot(kx - reach, ky - reach))
      return d < profile.length ? profile[d] : 0
    }),
  )
}

export const KERNEL = radialKernel(DROP_PROFILE)
/** How far the kernel reaches from its centre, in cells. */
export const KERNEL_REACH = (KERNEL.length - 1) / 2

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
// playing: a model player who reads the biggest blaze off the map every N
// seconds and types it, with the same fleet and queue the view gives them,
// swept against spread and spawn rates over ten seeded forests apiece.
//
// Three things the sweep settled:
//
//  - #726's 0.01/sec per neighbouring fire is *sub-critical*. A cell burns for
//    `burnSeconds` with eight neighbours, so a fire only grows when
//    8 × spread × burnSeconds > 1 — above ~0.018 at a seven-second burn. At
//    0.01 every fire quietly goes out by itself and there is nothing to do.
//
//  - Fires must be few and fierce, not many and mild. A learner types perhaps
//    twenty coordinates in two minutes, so a round that starts forty fires is
//    lost however well it is played, and the score stops measuring anything.
//
//  - The spread rate is a *sharp* knob. A fixed rate flips the round from "a
//    slow player saves the lot" to "a fast player loses most of it" over a
//    range of about 0.02 — percolation is like that near its threshold, which
//    is why this is swept rather than reasoned about, and why it has to be
//    re-swept whenever the plane or the typing changes. It has been, three
//    times.
//
//  - Both rates climb through the round rather than sitting flat (#762). A
//    flat rate made the first minute as fierce as the last, which is no way to
//    meet a learner still working out how to say 4098 — and a four-digit
//    cardinal takes a good deal longer to say than two short ones, so the
//    whole curve is gentler than it was when a square was drilled as a pair.
//
// Where they land, as the share of the forest lost over a two-minute shift.
// The halfway column is what makes the ramp worth having: next to nothing is
// lost in the first minute whatever you do, and the shift is won or lost once
// the sun is up.
//
//                             by the end   at halfway
//   left alone                    ~39%         ~2%
//   a coordinate every 12s        ~26%         ~1%
//   one every 9s                  ~10%        <~1%
//   one every 6s                   ~3%        <~1%
export const DEFAULTS = {
  /**
   * Chance per second that one burning cell lights one given neighbour, at the
   * start of a shift — and how much that grows per second as the sun comes up
   * (#762). A fixed rate made the first minute as fierce as the last, which
   * left no room to find your feet: a learner who is still working out how to
   * say 4098 is behind from the first fire. Now the forest starts damp and
   * dries out, which is both kinder and truer.
   */
  spreadPerSecond: 0.030,
  spreadRamp: 0.0003,
  /** How long a cell burns before it is lost for good. */
  burnSeconds: 7,
  /** New fires per second at the start of a round. */
  spawnPerSecond: 0.07,
  /** …and how much that grows per second elapsed, for the same reason. */
  spawnRamp: 0.002,
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
  /** How far, in cells, the Perlin warp drags a stand's boundary about. */
  warp: 22,
  /**
   * …over what distance, in cells, that warp turns. Shorter than the stands
   * are wide, so a boundary wanders within itself rather than the whole
   * diagram sliding; much shorter than this and the stands fray into islands.
   */
  warpScale: 18,
  /** …and over what distance the canopy thins and thickens into glades. */
  gapScale: 14,
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
 * where a per-cell shuffle reads as noise.
 *
 * A Voronoi cell is a convex polygon, though, so a forest built on one alone
 * has dead-straight edges between its stands and looks drawn rather than
 * grown. So the *coordinates* are warped by a pair of Perlin fields before the
 * nearest seed is looked up: the same diagram, the same stands, with
 * boundaries that wander. A third field thins and thickens the canopy, so the
 * gaps gather into glades instead of freckling the map evenly — without
 * changing how much bare ground there is overall, because the weighting
 * averages to one and the fire tuning above depends on how much of the map
 * can burn.
 *
 * Houses stay uniformly random, as #726 asks.
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

  // Two fields to drag the lookup about, and one for how open the canopy is.
  // Each gets its own draw from `rng`, so they are independent.
  const warpX = fbm2(perlin2(rng), 3)
  const warpY = fbm2(perlin2(rng), 3)
  const canopy = fbm2(perlin2(rng), 3)
  const { warp, warpScale, gapScale } = settings

  const kind = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const wx = x + warp * warpX(x / warpScale, y / warpScale)
      const wy = y + warp * warpY(x / warpScale, y / warpScale)
      let best = 0
      let bestD = Infinity
      for (const seed of seeds) {
        const dx = seed.x - wx
        const dy = seed.y - wy
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = seed.kind
        }
      }
      kind[idx(x, y)] = best
    }
  }

  // How open the canopy is, cell by cell. Cubed, because the linear field
  // gives a gentle wash where what reads as a forest is glades: mostly closed
  // canopy with clearings in it. Then divided through by its own mean, so
  // however the curve is shaped the map still ends up with exactly the bare
  // ground `gapRate` asks for — the fire tuning above depends on how much of
  // the map can burn, and it must not move when the look is adjusted.
  const openness = new Float32Array(SIZE * SIZE)
  let opennessTotal = 0
  for (let i = 0; i < openness.length; i++) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    const open = Math.max(0, 0.5 + 0.5 * canopy(x / gapScale, y / gapScale))
    openness[i] = open * open * open
    opennessTotal += openness[i]
  }
  const opennessMean = opennessTotal / openness.length

  let houses = 0
  let burnable = 0
  for (let i = 0; i < kind.length; i++) {
    const roll = rng()
    if (TERRAIN[kind[i]].burns) {
      if (roll < settings.houseRate) kind[i] = HOUSE_KIND
      else if (roll < settings.houseRate + (settings.gapRate * openness[i]) / opennessMean) {
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
  const spread = world.opts.spreadPerSecond + world.opts.spreadRamp * world.time
  const p = 1 - Math.pow(1 - spread, dt)
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
      const i = cellAt(x + kx - KERNEL_REACH, y + ky - KERNEL_REACH)
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
// The plane joins a circle around the fire, flies a turn and a quarter of it
// releasing water as it goes, and leaves on a different tangent from the one
// it arrived on — so the water lands as a ring around the fire rather than a
// blot on top of it, which is both what putting a fire out looks like and, with
// wetted ground, what actually contains one.
//
// Built by construction rather than by finding tangents from where the plane
// happens to be: the approach *is* the tangent at the joining point, so the
// entry point is found by walking backwards from it. That makes both joins
// exactly smooth — no kink where a straight leg meets the arc — and leaves the
// sweep a free parameter, which is what lets the circuit be more than the half
// turn a tangent-from-a-distant-point construction can give.

export const PLANE = {
  /** The circle the plane flies around the target, in cells. */
  loopRadius: 7,
  /** …and the circle the water lands on, inside it. */
  dropRadius: 3,
  /** How many times water is released during the circuit. */
  releases: 12,
  /**
   * Turns of that circuit. The quarter past a full turn is what puts the exit
   * on a different tangent from the entry; a whole number of turns would send
   * the plane back out along the line it came in on.
   */
  turns: 1.25,
  /** How far beyond the map's edge the plane enters and leaves, in cells. */
  margin: 5,
}

/** How far along a ray from `p` the map's edge (plus a margin) is. */
function rayToEdge(p, dx, dy, margin) {
  const lo = -margin
  const hi = SIZE - 1 + margin
  const wall = (d, from) =>
    Math.abs(d) < 1e-9 ? Infinity : Math.max((lo - from) / d, (hi - from) / d)
  // Floored: a target near a corner can put the joining point outside the box
  // already, where the walls are behind the plane and the answer comes out
  // negative. A leg of a fixed minimum length is the sane reading of that.
  return Math.max(SIZE * 0.35, Math.min(wall(dx, p.x), wall(dy, p.y)))
}

/**
 * @typedef {object} Flight
 * @property {(t: number) => {x: number, y: number, angle: number}} at  position
 *   and heading (radians, 0 = east) at a fraction `t` of the flight
 * @property {{t: number, x: number, y: number}[]} releases  when water leaves
 *   the plane, and where it lands — inside the circle the plane is flying,
 *   because that is where water dropped from a banking aircraft goes, and
 *   because it lets the circuit be big enough to see while the ring it lays
 *   stays tight enough to be worth aiming
 * @property {number} length  in cells, so a caller can fly it at a fixed speed
 */

/**
 * Build a flight around `to`, arriving on `heading` (radians, 0 = east).
 * @param {{x: number, y: number}} to
 * @param {number} heading
 * @param {Partial<typeof PLANE>} [opts]
 * @returns {Flight}
 */
export function planePath(to, heading, opts = {}) {
  const { loopRadius, dropRadius, releases, turns, margin } = { ...PLANE, ...opts }
  const ux = Math.cos(heading)
  const uy = Math.sin(heading)
  // The left-hand normal: which side of the fire the plane passes on, and so
  // the point at which its approach is tangent to the circle.
  const join = { x: to.x - loopRadius * uy, y: to.y + loopRadius * ux }
  const onCircle = (theta, r = loopRadius) => ({
    x: to.x + r * Math.cos(theta),
    y: to.y + r * Math.sin(theta),
  })
  // Travelling along `heading` at `join` means going round by DECREASING angle.
  const thetaIn = heading + Math.PI / 2
  const sweep = 2 * Math.PI * turns
  const thetaOut = thetaIn - sweep
  const leave = onCircle(thetaOut)
  // On a circle swept this way the heading is always a quarter turn behind the
  // angle, which is exactly why both joins come out smooth.
  const headingAt = (theta) => theta - Math.PI / 2
  const outHeading = headingAt(thetaOut)
  const vx = Math.cos(outHeading)
  const vy = Math.sin(outHeading)

  const lenIn = rayToEdge(join, -ux, -uy, margin)
  const lenOut = rayToEdge(leave, vx, vy, margin)
  const lenArc = loopRadius * sweep
  const length = lenIn + lenArc + lenOut
  const entry = { x: join.x - lenIn * ux, y: join.y - lenIn * uy }
  const exit = { x: leave.x + lenOut * vx, y: leave.y + lenOut * vy }
  // Time is shared out by distance, so the plane flies at one speed throughout
  // rather than dawdling through the loop and sprinting down the straights.
  const tIn = lenIn / length
  const tArc = lenArc / length

  const at = (t) => {
    const u = Math.min(1, Math.max(0, t))
    if (u < tIn) {
      const s = u / tIn
      return { x: entry.x + (join.x - entry.x) * s, y: entry.y + (join.y - entry.y) * s, angle: heading }
    }
    if (u < tIn + tArc) {
      const theta = thetaIn - sweep * ((u - tIn) / tArc)
      const p = onCircle(theta)
      return { x: p.x, y: p.y, angle: headingAt(theta) }
    }
    const s = (u - tIn - tArc) / (1 - tIn - tArc)
    return { x: leave.x + (exit.x - leave.x) * s, y: leave.y + (exit.y - leave.y) * s, angle: outHeading }
  }

  const drops = []
  for (let k = 0; k < releases; k++) {
    // Half-steps, so the first and last releases are a half-gap from the ends
    // of the arc and the ring closes evenly rather than doubling up at a seam.
    const s = (k + 0.5) / releases
    const p = onCircle(thetaIn - sweep * s, dropRadius)
    drops.push({ t: tIn + tArc * s, x: p.x, y: p.y })
  }

  return { at, releases: drops, length }
}

/**
 * The direction a plane arrives from, in radians. Random, so successive drops
 * on the same fire ring it from different sides.
 * @param {() => number} [rng]
 */
export function approachHeading(rng = Math.random) {
  return rng() * 2 * Math.PI
}

// ── Coordinates ──────────────────────────────────────────────────────────
// A square on the map IS a number, 0000–9999: the first two digits across, the
// last two down. Not a pair, and not two numbers said one after the other —
// #762 is explicit that the drill is the whole four-digit cardinal, said out
// in full («четы́ре ты́сячи девяно́сто во́семь» for 4098), which is exactly the
// range and the shape a learner needs and never practises otherwise.
//
// So the learner never does arithmetic: the number on screen is the number to
// say. The two halves are only ever *tinted* apart, to match the two axes.

/** The square a four-digit coordinate names. */
export function coordinateNumber(x, y) {
  return x * 100 + y
}

/**
 * A coordinate written the way it is shown: four digits, across then down.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function coordinateLabel(x, y) {
  return String(coordinateNumber(x, y)).padStart(4, '0')
}

/**
 * The square a run of spoken numbers names, or null if they do not name one.
 *
 * Exactly one number, and it is the whole coordinate. Two numbers is the
 * learner reading the halves off separately, which is the thing this drill
 * exists to replace, so it is refused rather than quietly accepted.
 * @param {number[]|null} numbers
 * @returns {{x: number, y: number}|null}
 */
export function coordinateFrom(numbers) {
  if (!numbers || numbers.length !== 1) return null
  const value = numbers[0]
  if (!Number.isInteger(value) || value < 0 || value > 9999) return null
  const x = Math.floor(value / 100)
  const y = value % 100
  return cellAt(x, y) >= 0 ? { x, y } : null
}
