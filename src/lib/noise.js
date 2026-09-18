// Perlin noise, and the fractal sum of it.
//
// Here for one reason: a Voronoi diagram's cells are convex polygons, and a
// forest laid out on one has perfectly straight edges between its stands. The
// fix is not to abandon Voronoi — distinct stands are what make a fire front
// read as a front rather than as static — but to *warp the coordinates* before
// looking a cell up, so the same diagram comes out with wandering boundaries.
// That is what these are for (see `generateForest`).
//
// Seeded through an injected `rng`, like everything else in `src/lib/`, so a
// forest is reproducible from a seed and a test can name the one that failed.

/** Perlin's 6t⁵−15t⁴+10t³: the interpolation curve with a zero 1st and 2nd derivative at both ends. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + t * (b - a)

// The eight unit-ish gradients of 2D Perlin: four diagonals and four axes.
// A gradient set rather than random vectors per corner is the whole trick —
// it is what makes the field continuous across a lattice cell's edges.
const GRADIENTS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const dot = (hash, x, y) => {
  const g = GRADIENTS[hash & 7]
  return g[0] * x + g[1] * y
}

/**
 * Build a 2D Perlin field. The returned function is pure and cheap; the cost
 * (shuffling a 256-entry permutation table) is paid once, here.
 *
 * The field is zero at every integer lattice point and smooth in between, and
 * lands within about ±1 — not exactly, because Perlin's theoretical bound is
 * not attained, so callers that need a strict range should clamp.
 * @param {() => number} [rng]
 * @returns {(x: number, y: number) => number}
 */
export function perlin2(rng = Math.random) {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) table[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = table[i]
    table[i] = table[j]
    table[j] = swap
  }
  // Doubled, so the two lookups below can add without wrapping by hand.
  const p = new Uint8Array(512)
  for (let i = 0; i < 512; i++) p[i] = table[i & 255]

  return function noise(x, y) {
    // `& 255` rather than `% 256` so the lattice tiles correctly for negative
    // coordinates too — the warp fields below are sampled either side of zero.
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = p[p[xi] + yi]
    const ab = p[p[xi] + yi + 1]
    const ba = p[p[xi + 1] + yi]
    const bb = p[p[xi + 1] + yi + 1]
    return lerp(
      lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u),
      lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u),
      v,
    )
  }
}

/**
 * Fractional Brownian motion: the same field sampled at doubling frequencies
 * and halving amplitudes, summed. One octave of Perlin is a smooth blur; three
 * gives a coastline the big shape of the first and the crinkle of the last.
 *
 * Normalised by the total amplitude, so the result keeps roughly the ±1 range
 * of a single octave however many are asked for.
 * @param {(x: number, y: number) => number} noise
 * @param {number} [octaves]
 * @param {number} [gain]        how much quieter each octave is than the last
 * @param {number} [lacunarity]  how much finer each octave is than the last
 * @returns {(x: number, y: number) => number}
 */
export function fbm2(noise, octaves = 3, gain = 0.5, lacunarity = 2) {
  const rounds = Math.max(1, Math.floor(octaves))
  let total = 0
  let amp = 1
  for (let i = 0; i < rounds; i++) {
    total += amp
    amp *= gain
  }
  return (x, y) => {
    let sum = 0
    let amplitude = 1
    let frequency = 1
    for (let i = 0; i < rounds; i++) {
      sum += amplitude * noise(x * frequency, y * frequency)
      amplitude *= gain
      frequency *= lacunarity
    }
    return sum / total
  }
}
