import { describe, it, expect } from 'vitest'

import {
  PART_TARGET,
  PART_MIN,
  PART_MAX,
  GLUE_COLLECTION,
  collectionOf,
  partName,
  partId,
  assignParts,
  lowestUnfilledPart,
  partBreach,
  buildPartStats,
  levelsWithParts,
} from './curriculum.js'

/** `n` words at one level and collection, keyed predictably. */
const words = (n, cefr, collection, prefix = collection) =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}-${String(i).padStart(3, '0')}`,
    cefr,
    collections: collection === GLUE_COLLECTION ? [] : [collection],
  }))

describe('collectionOf', () => {
  it('takes the first listed collection', () => {
    expect(collectionOf({ collections: ['home', 'family'] })).toBe('home')
  })

  it('files a word with no collection under the glue pseudo-collection', () => {
    expect(collectionOf({ collections: [] })).toBe(GLUE_COLLECTION)
    expect(collectionOf({})).toBe(GLUE_COLLECTION)
  })
})

describe('partName / partId', () => {
  it('names a part for its level and a roman ordinal', () => {
    expect(partName('A2', 2)).toBe('A2 Part II')
    expect(partName('B1', 4)).toBe('B1 Part IV')
  })

  it('ids a part stably, since achievements persist the id', () => {
    expect(partId('B1', 3)).toBe('B1-3')
  })
})

describe('assignParts', () => {
  const corpus = [...words(4, 'A1', 'home'), ...words(3, 'A1', 'food'), ...words(2, 'A2', 'work')]
  const definition = {
    parts: [
      { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home', 'food'] },
      { id: 'A2-1', level: 'A2', ordinal: 1, collections: ['work'] },
    ],
  }

  it('gives each part the words of the collections it names', () => {
    const { parts } = assignParts(corpus, definition)
    expect(parts.map((p) => [p.id, p.size])).toEqual([
      ['A1-1', 7],
      ['A2-1', 2],
    ])
  })

  it('maps every word to its part', () => {
    const { keyToPart } = assignParts(corpus, definition)
    expect(keyToPart.get('home-000')).toBe('A1-1')
    expect(keyToPart.get('work-001')).toBe('A2-1')
  })

  it('keeps a collection to its own level', () => {
    // "home" exists at both levels; the A1 part must not swallow the A2 words.
    const both = [...words(2, 'A1', 'home'), ...words(3, 'A2', 'home', 'a2home')]
    const defs = {
      parts: [
        { id: 'A1-1', level: 'A1', ordinal: 1, collections: ['home'] },
        { id: 'A2-1', level: 'A2', ordinal: 1, collections: ['home'] },
      ],
    }
    const { parts } = assignParts(both, defs)
    expect(parts.map((p) => p.size)).toEqual([2, 3])
  })

  it('reports words no part claims rather than losing them', () => {
    const { unassigned } = assignParts([...corpus, ...words(2, 'A1', 'orphan')], definition)
    expect(unassigned.map((w) => w.key)).toEqual(['orphan-000', 'orphan-001'])
  })

  it('orders parts by level then ordinal, whatever order they are defined in', () => {
    const shuffled = { parts: [definition.parts[1], definition.parts[0]] }
    expect(assignParts(corpus, shuffled).parts.map((p) => p.id)).toEqual(['A1-1', 'A2-1'])
  })

  describe('a collection split across parts', () => {
    const big = words(10, 'B1', 'daily life')
    const split = {
      parts: [
        { id: 'B1-1', level: 'B1', ordinal: 1, collections: ['daily life'], take: { 'daily life': 4 } },
        { id: 'B1-2', level: 'B1', ordinal: 2, collections: ['daily life'] },
      ],
    }

    it('gives the first part its take and the second the remainder', () => {
      const { parts } = assignParts(big, split)
      expect(parts.map((p) => p.size)).toEqual([4, 6])
    })

    it('splits on word key, so the cut does not move when the YAML is reordered', () => {
      const { parts } = assignParts([...big].reverse(), split)
      expect(parts[0].words.map((w) => w.key)).toEqual([
        'daily life-000',
        'daily life-001',
        'daily life-002',
        'daily life-003',
      ])
    })

    it('lets new words fall into the part that takes the remainder', () => {
      const grown = [...big, ...words(3, 'B1', 'daily life', 'zzz')]
      const { parts, unassigned } = assignParts(grown, split)
      expect(unassigned).toEqual([])
      expect(parts.map((p) => p.size)).toEqual([4, 9])
    })
  })
})

describe('lowestUnfilledPart', () => {
  it('names the earliest part under target', () => {
    const parts = [
      { id: 'A1-1', size: PART_TARGET },
      { id: 'A2-1', size: 480 },
      { id: 'A2-2', size: 300 },
    ]
    expect(lowestUnfilledPart(parts).id).toBe('A2-1')
  })

  it('is null when every part is at or over target', () => {
    expect(lowestUnfilledPart([{ id: 'A1-1', size: PART_TARGET + 50 }])).toBe(null)
  })
})

describe('partBreach', () => {
  it('flags a part over the ceiling', () => {
    expect(partBreach({ size: PART_MAX + 1 }, 5000)).toBe('over')
  })

  it('flags a part under the floor', () => {
    expect(partBreach({ size: PART_MIN - 1 }, 5000)).toBe('under')
  })

  it('waives the floor when the whole level is smaller than it', () => {
    // C1 has 25 words in the corpus and cannot reach 250 however it is cut.
    expect(partBreach({ size: 25 }, 25)).toBe(null)
  })

  it('passes a part inside both bounds', () => {
    expect(partBreach({ size: PART_TARGET }, 5000)).toBe(null)
  })
})

describe('buildPartStats', () => {
  const parts = [
    { id: 'A1-1', words: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }] },
  ]

  it('counts the four nested totals per part', () => {
    const states = { a: 'mastered', b: 'learned', c: 'learning', d: 'unknown' }
    const stats = buildPartStats(parts, (k) => states[k] ?? 'unknown')
    expect(stats['A1-1']).toEqual({ total: 4, met: 3, learned: 2, mastered: 1 })
  })

  it('counts a met-but-undrilled word toward met alone', () => {
    const stats = buildPartStats(parts, () => 'unknown', (k) => k === 'd')
    expect(stats['A1-1']).toEqual({ total: 4, met: 1, learned: 0, mastered: 0 })
  })
})

describe('levelsWithParts', () => {
  it('lists the levels that have parts, in CEFR order', () => {
    const parts = [{ level: 'B1' }, { level: 'A1' }, { level: 'B1' }]
    expect(levelsWithParts(parts)).toEqual(['A1', 'B1'])
  })
})
