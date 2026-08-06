import { describe, it, expect } from 'vitest'

import {
  COLLECTIONS,
  MIN_COLLECTION_WORDS,
  isCollection,
  unknownCollections,
} from './collections.js'
import { LEARNING_BATCH_SIZE, SAME_COLLECTION_RATIO } from './batches.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('the collection registry', () => {
  it('is sorted and free of duplicates', () => {
    expect(COLLECTIONS).toEqual([...COLLECTIONS].sort())
    expect(new Set(COLLECTIONS).size).toBe(COLLECTIONS.length)
  })

  it('sets the minimum size from the batch engine’s naming rule', () => {
    expect(MIN_COLLECTION_WORDS).toBe(Math.ceil(SAME_COLLECTION_RATIO * LEARNING_BATCH_SIZE))
  })

  it('recognises registered names and rejects others', () => {
    expect(isCollection('nature')).toBe(true)
    expect(isCollection('not a collection')).toBe(false)
  })

  it('reports unknown names, de-duplicated', () => {
    expect(unknownCollections(['nature', 'bogus', 'bogus'])).toEqual(['bogus'])
    expect(unknownCollections(['nature', 'school'])).toEqual([])
    expect(unknownCollections([])).toEqual([])
  })
})

describe('the bundled vocabulary', () => {
  const words = loadFixtureWords()

  it('only references registered collections', () => {
    const used = words.flatMap((w) => w.collections)
    const unknown = unknownCollections(used)
    expect(unknown, `unregistered collection(s): ${unknown.join(', ')}`).toEqual([])
  })

  // The converse of the check above: a registered name nobody uses — or that
  // too few words use — can never anchor a named batch, so the batch falls back
  // to "Random" and the tag just fragments the taxonomy. See #528.
  it('gives every registered collection enough words to name a batch', () => {
    const counts = new Map(COLLECTIONS.map((c) => [c, 0]))
    for (const w of words) {
      for (const c of w.collections) {
        if (counts.has(c)) counts.set(c, counts.get(c) + 1)
      }
    }
    const thin = [...counts]
      .filter(([, n]) => n < MIN_COLLECTION_WORDS)
      .map(([c, n]) => `${c} (${n})`)
    expect(
      thin,
      `collection(s) with fewer than ${MIN_COLLECTION_WORDS} words — grow them or ` +
        `fold them into a larger collection: ${thin.join(', ')}`,
    ).toEqual([])
  })
})
