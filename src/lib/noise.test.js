import { describe, it, expect } from 'vitest'

import { fbm2, perlin2 } from './noise.js'
import { mulberry32 } from './seed.js'

/** Every point on a coarse grid across, and either side of, the lattice. */
function grid(step = 0.13, from = -6, to = 6) {
  const points = []
  for (let x = from; x <= to; x += step) {
    for (let y = from; y <= to; y += step) points.push([x, y])
  }
  return points
}

describe('perlin2', () => {
  const noise = perlin2(mulberry32(1))

  it('is reproducible from a seed, and different from another one', () => {
    const a = perlin2(mulberry32(7))
    const b = perlin2(mulberry32(7))
    const c = perlin2(mulberry32(8))
    expect(a(1.3, 2.7)).toBe(b(1.3, 2.7))
    expect(a(1.3, 2.7)).not.toBe(c(1.3, 2.7))
  })

  it('is zero at every lattice point — the defining property of Perlin noise', () => {
    for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) expect(noise(x, y)).toBeCloseTo(0, 12)
    }
  })

  it('stays within about ±1', () => {
    for (const [x, y] of grid()) {
      expect(Math.abs(noise(x, y))).toBeLessThanOrEqual(1)
    }
  })

  it('actually varies — it is not a constant field', () => {
    const values = grid().map(([x, y]) => noise(x, y))
    expect(Math.max(...values)).toBeGreaterThan(0.3)
    expect(Math.min(...values)).toBeLessThan(-0.3)
  })

  it('is smooth: a small step in x or y is a small step in value', () => {
    const step = 0.002
    for (const [x, y] of grid(0.37)) {
      expect(Math.abs(noise(x + step, y) - noise(x, y))).toBeLessThan(0.02)
      expect(Math.abs(noise(x, y + step) - noise(x, y))).toBeLessThan(0.02)
    }
  })

  it('works either side of zero, where a naive modulo would fold the lattice', () => {
    // Continuous across x = 0 rather than mirrored: a warp field is sampled on
    // both sides, and a seam there would show as a crease down the map.
    expect(noise(-0.5, 0.25)).not.toBeCloseTo(noise(0.5, 0.25), 3)
    expect(Math.abs(noise(-0.002, 0.25) - noise(0.002, 0.25))).toBeLessThan(0.02)
  })
})

describe('fbm2', () => {
  const noise = perlin2(mulberry32(3))

  it('one octave is the field itself', () => {
    const one = fbm2(noise, 1)
    for (const [x, y] of grid(1.1)) expect(one(x, y)).toBeCloseTo(noise(x, y), 12)
  })

  it('keeps the ±1 range however many octaves are summed', () => {
    for (const octaves of [1, 2, 3, 5]) {
      const f = fbm2(noise, octaves)
      for (const [x, y] of grid(0.29)) expect(Math.abs(f(x, y))).toBeLessThanOrEqual(1)
    }
  })

  it('adds detail: more octaves cross zero more often along a line', () => {
    const crossings = (f) => {
      let n = 0
      let prev = f(0, 0.5)
      for (let x = 0; x < 20; x += 0.05) {
        const next = f(x, 0.5)
        if (Math.sign(next) !== Math.sign(prev)) n++
        prev = next
      }
      return n
    }
    expect(crossings(fbm2(noise, 4))).toBeGreaterThan(crossings(fbm2(noise, 1)))
  })

  it('treats a nonsense octave count as one', () => {
    const one = fbm2(noise, 1)
    for (const octaves of [0, -3, 0.4]) {
      expect(fbm2(noise, octaves)(1.3, 2.7)).toBeCloseTo(one(1.3, 2.7), 12)
    }
  })

  it('takes a gain and a lacunarity', () => {
    const quiet = fbm2(noise, 3, 0.2)
    const loud = fbm2(noise, 3, 0.8)
    const spread = (f) => {
      const values = grid(0.29).map(([x, y]) => f(x, y))
      return Math.max(...values) - Math.min(...values)
    }
    // A louder gain gives the fine octaves more say, so the field is rougher.
    expect(spread(loud)).not.toBeCloseTo(spread(quiet), 2)
    expect(fbm2(noise, 2, 0.5, 4)(1.3, 2.7)).not.toBeCloseTo(fbm2(noise, 2, 0.5, 2)(1.3, 2.7), 6)
  })
})
