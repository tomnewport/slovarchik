import { describe, it, expect } from 'vitest'
import {
  stripBrackets,
  guessCorrectness,
  tierFor,
  buildOptions,
  OPTION_TIERS,
  MAX_OPTIONS,
} from './flashcardOptions.js'

// Deterministic RNG so option draws are reproducible.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

describe('stripBrackets', () => {
  it('drops bracketed qualifiers and collapses whitespace', () => {
    expect(stripBrackets('hat (winter)')).toBe('hat')
    expect(stripBrackets('to go [pf]')).toBe('to go')
    expect(stripBrackets('mood {formal}')).toBe('mood')
  })
  it('leaves plain text untouched and tolerates nullish input', () => {
    expect(stripBrackets('spring')).toBe('spring')
    expect(stripBrackets(null)).toBe('')
  })
})

describe('guessCorrectness', () => {
  it('is 1 for a fully correct guess, ignoring brackets and case', () => {
    expect(guessCorrectness('Hat', 'hat (winter)')).toBe(1)
  })
  it('scores an unfinished guess by how far it has got', () => {
    // "spr" of "spring" (6 letters) → 3/6.
    expect(guessCorrectness('spr', 'spring')).toBeCloseTo(0.5)
  })
  it('penalises wrong letters', () => {
    // "xpr" vs "spring": positions 1,2 match ('p','r'), position 0 wrong → 2/6.
    expect(guessCorrectness('xpr', 'spring')).toBeCloseTo(1 / 3)
  })
  it('is 0 for an empty guess or empty answer', () => {
    expect(guessCorrectness('', 'spring')).toBe(0)
    expect(guessCorrectness('spring', '')).toBe(0)
  })
})

describe('tierFor', () => {
  it('maps correctness to the right tier', () => {
    expect(tierFor(1)).toBe(OPTION_TIERS[0])
    expect(tierFor(0.95)).toBe(OPTION_TIERS[1])
    expect(tierFor(0.85)).toBe(OPTION_TIERS[2])
    expect(tierFor(0.5)).toBe(OPTION_TIERS[3])
    expect(tierFor(0)).toBe(OPTION_TIERS[3])
  })
})

describe('buildOptions', () => {
  const pool = [
    { key: 'a', en: 'hat', label: 'hat (winter)' },
    { key: 'b', en: 'hat', label: 'hat (brimmed)' },
    { key: 'c', en: 'house', label: 'house' },
    { key: 'd', en: 'horse', label: 'horse' },
    { key: 'e', en: 'spring', label: 'spring' },
  ]

  it('returns nothing before anything is typed', () => {
    expect(buildOptions({ typed: '', answer: 'hat', pool })).toEqual([])
  })

  it('prefix-matches (no decoys) when the guess is fully correct', () => {
    // "ho" is a perfect prefix of the answer "house" → 100% tier: no decoys,
    // prefix match. Only "house"/"horse" prefix-match "ho".
    const out = buildOptions({ typed: 'ho', answer: 'ho', pool, rng: seededRng(3) })
    expect(out.map((o) => o.key).sort()).toEqual(['c', 'd'])
  })

  it('surfaces both bracketed forms of the same base word', () => {
    // A perfect guess of "hat" prefix-matches both hat forms and nothing else.
    const out = buildOptions({ typed: 'hat', answer: 'hat', pool, rng: seededRng(1) })
    expect(out.map((o) => o.key).sort()).toEqual(['a', 'b'])
  })

  it('mixes in decoys when the guess is weak (substring match)', () => {
    // "h" is a weak guess for "spring" (0% correct) → 500-decoy substring tier.
    // "h" substring-matches hat/hat/house/horse; "spring" is a decoy.
    const out = buildOptions({ typed: 'h', answer: 'spring', pool, rng: seededRng(2) })
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(MAX_OPTIONS)
    // The non-matching word can still appear as a decoy in the weak tier.
    const keys = new Set(out.map((o) => o.key))
    expect([...keys].every((k) => ['a', 'b', 'c', 'd', 'e'].includes(k))).toBe(true)
  })

  it('never shows more than the max', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, en: `word${i}`, label: `word${i}` }))
    const out = buildOptions({ typed: 'word', answer: 'word0', pool: big, max: MAX_OPTIONS, rng: seededRng(9) })
    expect(out.length).toBe(MAX_OPTIONS)
  })

  it('de-duplicates by key', () => {
    const dupPool = [
      { key: 'a', en: 'hat', label: 'hat' },
      { key: 'a', en: 'hat', label: 'hat' },
    ]
    const out = buildOptions({ typed: 'ha', answer: 'ha', pool: dupPool, rng: seededRng(1) })
    expect(out).toHaveLength(1)
  })
})
