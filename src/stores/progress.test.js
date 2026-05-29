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
  skills,
  examReadiness,
  composePractice,
  currentCollection,
  setCurrentCollection,
  _resetForTests,
} from './progress.js'

// A small, deterministic vocab (exactly two animals) built fresh for each test,
// so assertions don't depend on the bundled fixture counts or on any state
// another test file might leave in the shared, module-level vocab store.
function controlledVocab() {
  return [
    { key: 'собака=dog', pos: 'noun', gender: 'f', animacy: 'a', collections: ['animals'], headword: 'соба́ка', ru: 'собака', forms: { sg: { nom: 'соба́ка', gen: 'соба́ки' } } },
    { key: 'кошка=cat', pos: 'noun', gender: 'f', animacy: 'a', collections: ['animals'], headword: 'ко́шка', ru: 'кошка', forms: { sg: { nom: 'ко́шка', gen: 'ко́шки' } } },
    { key: 'море=sea', pos: 'noun', gender: 'n', animacy: 'i', collections: ['nature'], headword: 'мо́ре', ru: 'море', forms: { sg: { nom: 'мо́ре', gen: 'мо́ря' } } },
  ]
}

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
  vocabState.words = controlledVocab()
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

describe('progress store — skills, exam readiness & practice', () => {
  it('builds skills from the live history and vocab', () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.CORRECT, { level: 'advanced' })
    const dog = skills.value.find((s) => s.id === 'word:собака=dog')
    expect(dog.breadth).toBe(1)
    expect(dog.mastery).toBeCloseTo(1) // one unaided correct = mastered
    // The 'animals' collection skill covers both animals.
    const animals = skills.value.find((s) => s.id === 'collection:animals')
    expect(animals.breadth).toBe(2)
  })

  it('tracks exam readiness for the chosen collection', () => {
    setCurrentCollection('animals')
    const readiness = examReadiness.value
    expect(readiness.collection).toBe('animals')
    expect(readiness.words).toBe(2) // dog + cat
    expect(readiness.mastered).toBe(0) // nothing recorded yet
    expect(readiness.eligible).toBe(false)
  })

  it('marks a collection exam-ready once every word is mastered', () => {
    setCurrentCollection('animals')
    record({ kind: 'word', key: 'собака=dog' }, GRADES.CORRECT, { level: 'advanced' })
    record({ kind: 'word', key: 'кошка=cat' }, GRADES.CORRECT, { level: 'advanced' })
    const readiness = examReadiness.value
    expect(readiness.mastered).toBe(2)
    expect(readiness.readiness).toBeCloseTo(1)
    expect(readiness.eligible).toBe(true)
  })

  it('composes a sized practice session from the live data', () => {
    setCurrentCollection('animals')
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT, { level: 'easy' })
    const session = composePractice('small')
    expect(session.size).toBe(3)
    expect(Array.isArray(session.sections)).toBe(true)
    expect(session.exam.collection).toBe('animals')
  })

  it('persists the current collection across a reload', async () => {
    setCurrentCollection('animals')
    await flush()
    _resetForTests()
    expect(currentCollection.value).toBe(null)
    await initProgress()
    expect(currentCollection.value).toBe('animals')
  })
})
