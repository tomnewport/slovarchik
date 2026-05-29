import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import { GRADES } from '../lib/progress.js'
import { state as vocabState } from './vocab.js'
import {
  initProgress,
  record,
  describedStats,
  progressQueries,
  _resetForTests,
} from './progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Let the fire-and-forget persistence (microtask + IndexedDB transaction) settle.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(
    () => new Promise((resolve) => setTimeout(resolve, 0)),
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  _resetForTests()
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

describe('progress store', () => {
  it('records attempts in memory and resolves them against the vocab', () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT)
    record({ kind: 'word', key: 'собака=dog' }, GRADES.CORRECT)
    record({ kind: 'form', key: 'море=sea', slot: 'sg.gen' }, GRADES.INCORRECT)

    const byId = new Map(describedStats.value.map((s) => [s.id, s]))
    const dog = byId.get('word:собака=dog')
    expect(dog.attempts).toBe(2)
    expect(dog.incorrect).toBe(1)
    expect(dog.errorRate).toBeCloseTo(0.5)
    expect(dog.facets.gender).toBe('f') // joined from the live vocab

    const form = byId.get('form:море=sea#sg.gen')
    expect(form.facets).toMatchObject({ kind: 'form', gender: 'n', case: 'gen', number: 'sg' })
  })

  it('appends to one record per subject rather than duplicating', () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT)
    record({ kind: 'word', key: 'собака=dog' }, GRADES.CORRECT)
    const dogStats = describedStats.value.filter((s) => s.key === 'собака=dog' && s.kind === 'word')
    expect(dogStats).toHaveLength(1)
    expect(dogStats[0].attempts).toBe(2)
  })

  it('exposes the headline queries bound to the live data', () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT)
    record({ kind: 'word', key: 'море=sea' }, GRADES.CORRECT)

    const words = progressQueries.words()
    expect(words[0].key).toBe('собака=dog') // only wrong answer → worst

    // 'dog' is animate, 'sea' is inanimate — aggregating by a facet works live.
    const byAnimacy = progressQueries.byFacet('animacy', { kind: 'word' })
    expect(byAnimacy.find((b) => b.key === 'a').errorRate).toBeCloseTo(1)
    expect(byAnimacy.find((b) => b.key === 'i').errorRate).toBeCloseTo(0)
  })

  it('persists attempts and reloads them from IndexedDB', async () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT)
    record({ kind: 'form', key: 'море=sea', slot: 'sg.gen' }, GRADES.CORRECT)
    await flush()

    const cached = await idb.getAllProgress()
    expect(cached.map((r) => r.id).sort()).toEqual(['form:море=sea#sg.gen', 'word:собака=dog'])

    // Wipe memory and reload only from storage.
    _resetForTests()
    expect(describedStats.value).toHaveLength(0)
    await initProgress()

    const byId = new Map(describedStats.value.map((s) => [s.id, s]))
    expect(byId.get('word:собака=dog').incorrect).toBe(1)
    expect(byId.get('form:море=sea#sg.gen').correct).toBe(1)
  })
})
