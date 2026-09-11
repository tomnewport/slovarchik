import { describe, it, expect } from 'vitest'

import { auditParts } from './check-parts.mjs'
import { PART_MIN, PART_MAX, MIN_FRAGMENT } from '../src/lib/curriculum.js'

const words = (n, cefr, collection, prefix = collection) =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}-${String(i).padStart(4, '0')}`,
    cefr,
    collections: [collection],
  }))

/** A level packed into one legal part. */
const legal = {
  words: words(PART_MIN + 10, 'A1', 'home'),
  definition: { parts: [{ id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'] }] },
}

describe('auditParts', () => {
  it('passes a packing that describes the corpus', () => {
    expect(auditParts(legal.words, legal.definition)).toEqual([])
  })

  it('rejects an empty definition', () => {
    expect(auditParts(legal.words, { parts: [] })[0]).toMatch(/defines no parts/)
  })

  it('catches a word no part claims', () => {
    const extra = [...legal.words, ...words(3, 'A1', 'forgotten')]
    const problems = auditParts(extra, legal.definition)
    expect(problems.some((p) => /3 learnable word\(s\) belong to no part/.test(p))).toBe(true)
  })

  it('catches a part over the ceiling', () => {
    const big = words(PART_MAX + 1, 'A1', 'home')
    const problems = auditParts(big, legal.definition)
    expect(problems.some((p) => p.includes(`over the ${PART_MAX} ceiling`))).toBe(true)
  })

  it('catches a part under the floor', () => {
    // The level is big enough that the floor applies, but this part is not.
    const corpus = [...words(PART_MIN - 1, 'A1', 'home'), ...words(PART_MIN + 5, 'A1', 'work')]
    const definition = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'] },
        { id: 'A1-2', level: 'A1', ordinal: 2, collections: ['work'] },
      ],
    }
    const problems = auditParts(corpus, definition)
    expect(problems.some((p) => p.includes(`under the ${PART_MIN} floor`))).toBe(true)
  })

  it('waives the floor for a level smaller than it', () => {
    const tiny = words(25, 'C1', 'nature')
    const definition = { parts: [{ id: 'C1-1', level: 'C1', ordinal: 1, collections: ['nature'] }] }
    expect(auditParts(tiny, definition)).toEqual([])
  })

  it('catches a collection fragmented below the floor', () => {
    // 10 words split 5/5 — the exact "10 in one part and 10 in another" case the
    // fragment floor exists to prevent.
    const corpus = [...words(10, 'A1', 'home'), ...words(PART_MIN * 2, 'A1', 'bulk')]
    const definition = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home', 'bulk'], take: { home: 5, bulk: PART_MIN } },
        { id: 'A1-2', level: 'A1', ordinal: 2, collections: ['home', 'bulk'] },
      ],
    }
    const problems = auditParts(corpus, definition)
    expect(problems.some((p) => p.includes(`${MIN_FRAGMENT}-word fragment floor`))).toBe(true)
  })

  it('accepts a big collection split into substantial pieces', () => {
    const corpus = words(PART_MIN * 2 + 20, 'A1', 'home')
    const definition = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'], take: { home: PART_MIN + 10 } },
        { id: 'A1-2', level: 'A1', ordinal: 2, collections: ['home'] },
      ],
    }
    expect(auditParts(corpus, definition)).toEqual([])
  })

  it('catches a duplicate part id, which would confuse a persisted milestone', () => {
    const definition = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'] },
        { id: 'A1-1', level: 'A1', ordinal: 2, collections: [] },
      ],
    }
    const problems = auditParts(legal.words, definition)
    expect(problems.some((p) => p.includes('Duplicate part id'))).toBe(true)
  })

  it('catches a gap in a level’s ordinals', () => {
    const definition = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'] },
        { id: 'A1-3', level: 'A1', ordinal: 3, collections: [] },
      ],
    }
    const problems = auditParts(legal.words, definition)
    expect(problems.some((p) => p.includes('ordinals are 1, 3'))).toBe(true)
  })
})
