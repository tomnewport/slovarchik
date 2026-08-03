// Deterministic RNG seam for end-to-end tests (#322).
//
// The learning engine already takes an injectable `rng` throughout, defaulting
// to `Math.random` at every call site. Rather than thread a seed through every
// one of those (startSession, ensureMasteryBatch, buildExercises, getBatchOptions,
// commitBatch …), we install a seeded generator over `Math.random` itself when —
// and only when — a seed is supplied. That keeps a full Playwright session run
// reproducible without touching the pure modules. In normal use no seed is
// present and this is a complete no-op, so production randomness is untouched.

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Deterministic for a
 * given integer seed.
 * @param {number} seed
 * @returns {() => number} a Math.random-compatible function in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Read a seed from the environment: a `window.__SLOVARCHIK_SEED__` global (set by
 * a test via addInitScript) takes precedence, then a `seed` query param — checked
 * both on the top-level URL (`?seed=1`) and inside the hash route
 * (`#/session?seed=1`), since the app uses hash history.
 * @returns {number|null} the seed, or null when none is supplied
 */
export function readSeed() {
  if (typeof window === 'undefined') return null
  if (window.__SLOVARCHIK_SEED__ != null) return Number(window.__SLOVARCHIK_SEED__)
  try {
    const search = new URLSearchParams(window.location.search)
    if (search.has('seed')) return Number(search.get('seed'))
    const hash = window.location.hash ?? ''
    const qi = hash.indexOf('?')
    if (qi !== -1) {
      const hp = new URLSearchParams(hash.slice(qi + 1))
      if (hp.has('seed')) return Number(hp.get('seed'))
    }
  } catch {
    // Malformed URL — treat as no seed.
  }
  return null
}

/**
 * Replace `Math.random` with a seeded generator when a seed is present. Returns
 * true when a seed was installed, false (a no-op) otherwise.
 * @param {number|null} [seed] defaults to {@link readSeed}
 * @returns {boolean}
 */
export function installSeededRandom(seed = readSeed()) {
  if (seed == null || Number.isNaN(seed)) return false
  Math.random = mulberry32(seed)
  return true
}
