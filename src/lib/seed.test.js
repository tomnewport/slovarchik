// Guards the dev-only gate on the URL seed paths (#663).
//
// The gate is `import.meta.env.DEV`, which Vite replaces statically at build
// time — in a real production bundle the URL branch is not merely skipped, it
// is eliminated. `vi.stubEnv('DEV', false)` cannot reproduce dead-code removal,
// but it does reproduce the observable contract these tests care about: what
// `readSeed()` returns when the build is not a development one.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { mulberry32, readSeed, installSeededRandom } from './seed.js'

const realRandom = Math.random

/** Point jsdom's location at `url` without navigating. */
const at = (url) => window.history.replaceState({}, '', url)

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__SLOVARCHIK_SEED__
  at('/')
  Math.random = realRandom
})

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('gives different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('readSeed in a development build', () => {
  it('reads a top-level query param', () => {
    at('/?seed=5')
    expect(readSeed()).toBe(5)
  })

  it('reads a seed from inside the hash route', () => {
    at('/#/session?seed=9')
    expect(readSeed()).toBe(9)
  })

  it('returns null when no seed is present', () => {
    at('/#/session')
    expect(readSeed()).toBeNull()
  })

  it('lets the global win over the URL', () => {
    at('/?seed=5')
    window.__SLOVARCHIK_SEED__ = 11
    expect(readSeed()).toBe(11)
  })
})

describe('readSeed in a production build', () => {
  it('ignores a top-level query param', () => {
    vi.stubEnv('DEV', false)
    at('/?seed=5')
    expect(readSeed()).toBeNull()
  })

  it('ignores a seed inside the hash route', () => {
    vi.stubEnv('DEV', false)
    at('/#/session?seed=9')
    expect(readSeed()).toBeNull()
  })

  it('still honours the __SLOVARCHIK_SEED__ global, so e2e keeps working', () => {
    vi.stubEnv('DEV', false)
    window.__SLOVARCHIK_SEED__ = 123
    expect(readSeed()).toBe(123)
  })

  it('does not install a seeded Math.random from a shared ?seed= link', () => {
    vi.stubEnv('DEV', false)
    at('/?seed=5')
    expect(installSeededRandom()).toBe(false)
    expect(Math.random).toBe(realRandom)
  })
})

describe('installSeededRandom', () => {
  it('installs a seeded generator when a seed is given', () => {
    expect(installSeededRandom(42)).toBe(true)
    expect(Math.random).not.toBe(realRandom)
    const first = [Math.random(), Math.random()]

    Math.random = realRandom
    installSeededRandom(42)
    expect([Math.random(), Math.random()]).toEqual(first)
  })

  it('is a no-op with no seed anywhere', () => {
    at('/')
    expect(installSeededRandom()).toBe(false)
    expect(Math.random).toBe(realRandom)
  })

  it('is a no-op for a non-numeric seed', () => {
    at('/?seed=banana')
    expect(installSeededRandom()).toBe(false)
    expect(Math.random).toBe(realRandom)
  })
})
