import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import { state as vocabState } from './vocab.js'
import {
  state,
  stateOf,
  learnedCount,
  masteredCount,
  lost,
  atRisk,
  recentlyLearned,
  recordAttempt,
  getBatchOptions,
  commitBatch,
  batchProgress,
  batchComplete,
  advanceBatch,
  dimensionWeakness,
  startSession,
  loadProgress,
  resetProgress,
} from './progress.js'

// A small synthetic vocabulary; `hasInflections` short-circuits the paradigm
// lookup so we can control mastery eligibility precisely.
function setVocab(words) {
  vocabState.words = words
}

function makeWords(n, { cefr = 'A1', collection = 'animals', hasInflections = false } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    key: `w${i}`,
    cefr,
    collections: [collection],
    hasInflections,
  }))
}

// Record the attempts needed to satisfy every learning criterion.
async function learn(word, ts = 1) {
  for (const d of ['identification', 'usage', 'hearing']) {
    for (let i = 0; i < 3; i++) {
      await recordAttempt({ word, dimension: d, level: 'learning', correct: true, ts })
    }
  }
  for (let i = 0; i < 3; i++) {
    await recordAttempt({ word, dimension: 'speaking', level: 'learning', correct: true, ts })
  }
}

async function master(word, ts = 1) {
  await learn(word, ts)
  await recordAttempt({ word, dimension: 'identification', level: 'mastery', correct: true, ts })
  await recordAttempt({ word, dimension: 'usage', level: 'mastery', correct: true, ts })
  for (let i = 0; i < 3; i++) {
    await recordAttempt({ word, dimension: 'hearing', level: 'mastery', correct: true, ts })
  }
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  await resetProgress()
  setVocab([])
})

describe('recording attempts & states', () => {
  it('a word is unknown until attempted, then learning', async () => {
    setVocab(makeWords(1, { hasInflections: true }))
    expect(stateOf('w0')).toBe('unknown')
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    expect(stateOf('w0')).toBe('learning')
  })

  it('reaches learned once every learning dimension is satisfied', async () => {
    setVocab(makeWords(1, { hasInflections: true }))
    await learn('w0')
    expect(stateOf('w0')).toBe('learned')
    expect(learnedCount.value).toBe(1)
    expect(masteredCount.value).toBe(0)
  })

  it('an uninflected word is mastered as soon as it is learned', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    expect(stateOf('w0')).toBe('mastered')
    expect(masteredCount.value).toBe(1)
  })

  it('an inflected word needs the mastery criteria to be mastered', async () => {
    setVocab(makeWords(1, { hasInflections: true }))
    await master('w0')
    expect(stateOf('w0')).toBe('mastered')
    expect(masteredCount.value).toBe(1)
  })

  it('caps stored attempts per dimension to keep records bounded', async () => {
    setVocab(makeWords(1, { hasInflections: true }))
    for (let i = 0; i < 25; i++) {
      await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    }
    const usage = state.records.w0.events.filter(
      (e) => e.dimension === 'usage' && e.level === 'learning',
    )
    expect(usage.length).toBeLessThanOrEqual(10)
  })
})

describe('demotion, at-risk and recently-learned', () => {
  it('demotes a learned word that slips, and reports it as lost', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    expect(stateOf('w0')).toBe('mastered')
    // Two wrong identification attempts push the 3/4 window below threshold.
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: false })
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: false })
    expect(stateOf('w0')).toBe('learning')
    expect(lost.value).toContain('w0')
    expect(recentlyLearned.value).not.toContain('w0')
  })

  it('flags a still-passing word whose last attempt was wrong as at-risk', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    // identification window: ...,T,T,T then one F → 3/4 still met, but last is wrong.
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: false })
    expect(stateOf('w0')).toBe('mastered')
    expect(atRisk.value).toContain('w0')
  })

  it('lists recently-learned words newest first', async () => {
    setVocab(makeWords(3, { hasInflections: false }))
    await learn('w0', 100)
    await learn('w1', 300)
    await learn('w2', 200)
    expect(recentlyLearned.value.slice(0, 3)).toEqual(['w1', 'w2', 'w0'])
  })
})

describe('batches', () => {
  it('offers learning options and commits the chosen one', async () => {
    setVocab(makeWords(20, { hasInflections: true }))
    const options = getBatchOptions('learning', seededRng(1))
    expect(options.length).toBeGreaterThan(0)
    await commitBatch(options[0])
    expect(state.learning).toEqual(options[0])
  })

  it('tracks batch completion as its words are learned', async () => {
    setVocab(makeWords(20, { hasInflections: false }))
    const batch = { name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 }
    await commitBatch(batch)
    expect(batchComplete('learning')).toBe(false)
    await learn('w0')
    await learn('w1')
    expect(batchProgress('learning').every((p) => p.done)).toBe(true)
    expect(batchComplete('learning')).toBe(true)
  })

  it('advances by clearing the current batch', async () => {
    setVocab(makeWords(5, { hasInflections: false }))
    await commitBatch({ name: 'a', collection: 'a', level: 'learning', color: 'green', words: ['w0'], size: 1 })
    await advanceBatch('learning')
    expect(state.learning).toBe(null)
  })

  it('gates mastery batch options behind 100 learned words', async () => {
    setVocab(makeWords(5, { hasInflections: true }))
    // No words learned yet → no mastery options regardless.
    expect(getBatchOptions('mastery', seededRng(2))).toEqual([])
  })
})

describe('sessions', () => {
  it('weights weakness towards dimensions answered wrong', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: false })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: false })
    const w = dimensionWeakness()
    expect(w.usage).toBeGreaterThan(w.identification)
  })

  it('builds a session sized to its type with a word pool per practice', async () => {
    setVocab(makeWords(20, { hasInflections: false }))
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1', 'w2'], size: 3 })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    const session = startSession({ type: 'standard', size: 'normal' }, seededRng(3))
    expect(session.practices).toHaveLength(12)
    expect(session.pools).toHaveProperty('current')
    for (const p of session.practices) {
      expect(Array.isArray(p.pool)).toBe(true)
      expect(['atRisk', 'untested', 'current']).toContain(p.bucket)
    }
    // The committed-but-unlearned batch words are the current pool.
    expect(session.pools.current).toContain('w1')
  })
})

describe('persistence', () => {
  it('survives a reload via IndexedDB', async () => {
    setVocab(makeWords(2, { hasInflections: false }))
    await learn('w0', 50)
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 })

    // Simulate a reload: drop the in-memory state, then load from IndexedDB.
    state.records = {}
    state.learning = null
    await loadProgress()

    expect(stateOf('w0')).toBe('mastered')
    expect(state.records.w0.learnedAt).toBe(50)
    expect(state.learning.name).toBe('animals')
    expect(learnedCount.value).toBe(1)
  })

  it('uses a v4 schema with a fresh progress store', async () => {
    await idb.putProgress({ word: 'x', events: [], learnedAt: null, masteredAt: null, peak: 0 })
    const all = await idb.getAllProgress()
    expect(all.map((r) => r.word)).toContain('x')
  })
})

// Deterministic rng for batch/session assembly.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}
