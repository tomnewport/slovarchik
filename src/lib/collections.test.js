import { describe, it, expect } from 'vitest'

import { COLLECTIONS, isCollection, unknownCollections } from './collections.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('the collection registry', () => {
  it('is sorted and free of duplicates', () => {
    expect(COLLECTIONS).toEqual([...COLLECTIONS].sort())
    expect(new Set(COLLECTIONS).size).toBe(COLLECTIONS.length)
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
})
