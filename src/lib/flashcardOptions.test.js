import { describe, it, expect } from 'vitest'
import { stripBrackets, buildOptions, OPTION_LIMIT } from './flashcardOptions.js'

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

describe('buildOptions', () => {
  const pool = [
    { key: 'a', en: 'hat', label: 'hat (winter)' },
    { key: 'b', en: 'hat', label: 'hat (brimmed)' },
    { key: 'c', en: 'house', label: 'house' },
    { key: 'd', en: 'horse', label: 'horse' },
    { key: 'e', en: 'spring', label: 'spring' },
  ]

  it('returns nothing before anything is typed', () => {
    expect(buildOptions({ typed: '', pool })).toEqual([])
  })

  it('substring-matches the typed text against the gloss', () => {
    // "ho" is a substring of house and horse only.
    const out = buildOptions({ typed: 'ho', pool })
    expect(out.map((o) => o.key).sort()).toEqual(['c', 'd'])
  })

  it('surfaces both bracketed forms of the same base word', () => {
    // "hat" substring-matches both hats and nothing else — the whole point:
    // telling a winter hat from a brimmed one.
    const out = buildOptions({ typed: 'hat', pool })
    expect(out.map((o) => o.key).sort()).toEqual(['a', 'b'])
  })

  it('matches on an interior substring, ignoring brackets and case', () => {
    // "OR" appears inside "horse"; the bracketed label is ignored, only `en`.
    const out = buildOptions({ typed: 'OR', pool })
    expect(out.map((o) => o.key)).toEqual(['d'])
  })

  it('hides the list until fewer than the limit match', () => {
    // Every word contains "o"? No — but build a wide field to test the cutoff.
    const wide = Array.from({ length: OPTION_LIMIT }, (_, i) => ({
      key: `k${i}`,
      en: `word${i}`,
      label: `word${i}`,
    }))
    // "word" matches all OPTION_LIMIT of them → too wide, list hidden.
    expect(buildOptions({ typed: 'word', pool: wide })).toEqual([])
    // Dropping one below the limit reveals the shortlist.
    expect(buildOptions({ typed: 'word', pool: wide.slice(1) })).toHaveLength(OPTION_LIMIT - 1)
  })

  it('respects a custom limit', () => {
    const out = buildOptions({ typed: 'h', pool, limit: 3 })
    // "h" matches hat/hat/house/horse (4) → 4 >= 3, hidden.
    expect(out).toEqual([])
    // With a higher limit the same guess surfaces all four.
    expect(buildOptions({ typed: 'h', pool, limit: 5 })).toHaveLength(4)
  })

  it('de-duplicates by key', () => {
    const dupPool = [
      { key: 'a', en: 'hat', label: 'hat' },
      { key: 'a', en: 'hat', label: 'hat' },
    ]
    expect(buildOptions({ typed: 'ha', pool: dupPool })).toHaveLength(1)
  })

  it('returns nothing when nothing matches', () => {
    expect(buildOptions({ typed: 'zzz', pool })).toEqual([])
  })
})
