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
  batchExerciseProgress,
  batchComplete,
  advanceBatch,
  dimensionWeakness,
  encounterCount,
  autoCommitMasteryBatch,
  ensureMasteryBatch,
  startSession,
  loadProgress,
  resetProgress,
  history,
  learnedWords,
  masteredWords,
  weakestSkills,
  focusKeysFor,
  exportData,
  validateImport,
  importData,
  cefrStats,
  earnedAchievements,
  pendingAchievements,
  acknowledgeAchievements,
  currentStreak,
  longestStreak,
  dailyRecord,
  totalExercises,
  activityCalendar,
} from './progress.js'
import { dayKey } from '../lib/streak.js'

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

  it('records an attempt `times` over in a single write (unhinted answers count double)', async () => {
    setVocab(makeWords(1, { hasInflections: true }))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, times: 2 })
    expect(state.records.w0.events).toHaveLength(2)
    expect(state.records.w0.events.every((e) => e.correct)).toBe(true)
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

  it('skips an attempt with a missing word key without throwing or persisting', async () => {
    // Regression for #185 / #190: a falsy key must not reach the IndexedDB
    // `put` (which would throw an opaque DataError that resurfaces as a global
    // error toast). It is swallowed, nothing is recorded, and the call resolves.
    for (const bad of [undefined, null, '']) {
      await expect(
        recordAttempt({ word: bad, dimension: 'usage', level: 'learning', correct: true }),
      ).resolves.toBe('unknown')
    }
    expect(Object.keys(state.records)).toHaveLength(0)
    expect(await idb.getAllProgress()).toHaveLength(0)
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

  it('does not flag a word at-risk for a wrong speaking attempt', async () => {
    // Speaking is an attempts-based criterion: correctness never affects it, so
    // a wrong speaking answer cannot put the word one slip from dropping.
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    await recordAttempt({ word: 'w0', dimension: 'speaking', level: 'learning', correct: false })
    expect(stateOf('w0')).toBe('mastered')
    expect(atRisk.value).not.toContain('w0')
  })

  it('drops a mastered inflected word back to learned on a wrong mastery attempt', async () => {
    // Mastery identification and usage have window=1, so one wrong answer
    // immediately un-meets the criterion — there is no borderline/at-risk state.
    setVocab(makeWords(1, { hasInflections: true }))
    await master('w0')
    expect(stateOf('w0')).toBe('mastered')
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'mastery', correct: false })
    expect(stateOf('w0')).toBe('learned')
    expect(lost.value).toContain('w0')
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

  it('measures exercise progress from fresh (0) to complete (1)', async () => {
    setVocab(makeWords(20, { hasInflections: false }))
    const batch = { name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 }
    await commitBatch(batch)
    // Fresh: two words × 12 minimum exercises each, none done yet.
    const fresh = batchExerciseProgress('learning')
    expect(fresh).toMatchObject({ remaining: 24, fresh: 24, done: 0, fraction: 0 })
    // Learning one word chips the bar half-way (12 of 24 exercises done).
    await learn('w0')
    const half = batchExerciseProgress('learning')
    expect(half).toMatchObject({ remaining: 12, fresh: 24, done: 12, fraction: 0.5 })
    // Finishing the batch fills it.
    await learn('w1')
    expect(batchExerciseProgress('learning').fraction).toBe(1)
  })

  it('reports a full bar when no batch is committed', () => {
    expect(batchExerciseProgress('learning')).toMatchObject({ remaining: 0, fraction: 1 })
  })

  it('advances by clearing the current batch', async () => {
    setVocab(makeWords(5, { hasInflections: false }))
    await commitBatch({ name: 'a', collection: 'a', level: 'learning', color: 'green', words: ['w0'], size: 1 })
    await advanceBatch('learning')
    expect(state.learning).toBe(null)
  })

  it('offers no mastery options until a full batch of learned words exists', async () => {
    const words = makeWords(15, { hasInflections: true })
    setVocab(words)
    // Nine learned-but-unmastered words is not yet a full mastery batch.
    for (const w of words.slice(0, 9)) await learn(w.key)
    expect(getBatchOptions('mastery', seededRng(2))).toEqual([])
  })

  it('offers mastery options once a full batch of words is learned', async () => {
    const words = makeWords(15, { hasInflections: true })
    setVocab(words)
    for (const w of words.slice(0, 10)) await learn(w.key)
    const options = getBatchOptions('mastery', seededRng(2))
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].level).toBe('mastery')
  })

  it('autoCommitMasteryBatch returns null when too few words are learned', async () => {
    setVocab(makeWords(5, { hasInflections: true }))
    const result = await autoCommitMasteryBatch(seededRng(3))
    expect(result).toBeNull()
    expect(state.mastery).toBeNull()
  })

  it('autoCommitMasteryBatch picks and commits a random mastery batch', async () => {
    const words = makeWords(20, { hasInflections: true })
    setVocab(words)
    // Learning a full batch's worth of words is enough to start mastering.
    for (const w of words.slice(0, 10)) await learn(w.key)
    const result = await autoCommitMasteryBatch(seededRng(4))
    expect(result).not.toBeNull()
    expect(result.level).toBe('mastery')
    expect(state.mastery).toEqual(result)
  })

  it('ensureMasteryBatch assembles one as soon as enough words are learned', async () => {
    const words = makeWords(20, { hasInflections: true })
    setVocab(words)
    // Too few learned yet → nothing committed.
    for (const w of words.slice(0, 9)) await learn(w.key)
    expect(await ensureMasteryBatch(seededRng(5))).toBeNull()
    expect(state.mastery).toBeNull()
    // The tenth learned word tips it over: a batch is assembled immediately,
    // without waiting for any learning batch to complete.
    await learn(words[9].key)
    const batch = await ensureMasteryBatch(seededRng(5))
    expect(batch).not.toBeNull()
    expect(state.mastery).toEqual(batch)
  })

  it('ensureMasteryBatch leaves an in-progress mastery batch untouched', async () => {
    const words = makeWords(20, { hasInflections: true })
    setVocab(words)
    for (const w of words.slice(0, 10)) await learn(w.key)
    const first = await ensureMasteryBatch(seededRng(5))
    expect(first).not.toBeNull()
    // It still has unmastered words, so a second call is a no-op.
    expect(await ensureMasteryBatch(seededRng(6))).toBeNull()
    expect(state.mastery).toEqual(first)
  })

  it('ensureMasteryBatch refreshes a completed batch without waiting for celebration', async () => {
    const words = makeWords(30, { hasInflections: true })
    setVocab(words)
    for (const w of words.slice(0, 20)) await learn(w.key)
    const first = await ensureMasteryBatch(seededRng(5))
    expect(first).not.toBeNull()
    // Master every word in the active batch so it is complete.
    for (const key of first.words) await master(key)
    expect(batchComplete('mastery')).toBe(true)
    // A fresh batch is assembled from the remaining learned-but-unmastered words.
    const next = await ensureMasteryBatch(seededRng(7))
    expect(next).not.toBeNull()
    expect(next.words.some((k) => first.words.includes(k))).toBe(false)
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

  it('excludes mastery practices when no mastery batch is active', async () => {
    setVocab(makeWords(20, { hasInflections: true }))
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0'], size: 1 })
    // No mastery batch committed.
    const session = startSession({ type: 'standard', size: 'super' }, seededRng(4))
    expect(session.practices.every((p) => p.level === 'learning')).toBe(true)
  })

  it('includes mastery practices when mastery batch has unmastered words', async () => {
    setVocab(makeWords(20, { hasInflections: true }))
    // Commit a mastery batch with a word that has not yet been mastered.
    await commitBatch({ name: 'animals', collection: 'animals', level: 'mastery', color: 'gold', words: ['w0'], size: 1 })
    const session = startSession({ type: 'standard', size: 'super' }, seededRng(5))
    expect(session.practices.some((p) => p.level === 'mastery')).toBe(true)
  })

  it('restricts mastery-level practice pools to mastery-batch words', async () => {
    setVocab(makeWords(20, { hasInflections: true }))
    // Learning batch: w0, w1 (not yet learned).
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 })
    // Mastery batch: w2 (not yet mastered).
    await commitBatch({ name: 'animals', collection: 'animals', level: 'mastery', color: 'gold', words: ['w2'], size: 1 })
    const session = startSession({ type: 'grammar', size: 'super' }, seededRng(6))
    const masteryPractices = session.practices.filter((p) => p.level === 'mastery')
    expect(masteryPractices.length).toBeGreaterThan(0)
    for (const p of masteryPractices) {
      // No learning-batch word should appear in a mastery-level practice pool.
      expect(p.pool).not.toContain('w0')
      expect(p.pool).not.toContain('w1')
      expect(p.pool).toContain('w2')
    }
  })

  it('boosts dimension weights for unmet criteria in the current pool', async () => {
    setVocab(makeWords(20, { hasInflections: false }))
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0'], size: 1 })
    // Meet identification, usage, hearing — leave speaking one attempt short (need 3).
    for (const d of ['identification', 'usage', 'hearing']) {
      for (let i = 0; i < 3; i++) {
        await recordAttempt({ word: 'w0', dimension: d, level: 'learning', correct: true })
      }
    }
    await recordAttempt({ word: 'w0', dimension: 'speaking', level: 'learning', correct: true })
    // Over several super sessions, speaking should dominate because it's the only
    // unmet dimension and its weakness weight gets boosted above the others.
    const practices = Array.from({ length: 5 }, (_, i) =>
      startSession({ type: 'standard', size: 'super' }, seededRng(i + 100)).practices,
    ).flat()
    const speakingFraction = practices.filter((p) => p.dimension === 'speaking').length / practices.length
    expect(speakingFraction).toBeGreaterThan(0.5)
  })

  it('counts identification events for encounterCount', async () => {
    setVocab(makeWords(2, { hasInflections: false }))
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: false })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    expect(encounterCount('w0')).toBe(2) // only identification events
    expect(encounterCount('w1')).toBe(0) // never attempted
  })

  it('folds a word that slipped below learned into the current pool', async () => {
    setVocab(makeWords(20, { hasInflections: false }))
    // A committed learning batch keeps the current pool non-empty, so the
    // "nothing committed" fallback can't be what surfaces the slipped word.
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 })
    // w5 reaches learned (== mastered for an uninflected word) then slips below
    // it: two wrong identification answers drop the 3/4 window under threshold.
    await learn('w5')
    expect(stateOf('w5')).toBe('mastered')
    await recordAttempt({ word: 'w5', dimension: 'identification', level: 'learning', correct: false })
    await recordAttempt({ word: 'w5', dimension: 'identification', level: 'learning', correct: false })
    expect(stateOf('w5')).toBe('learning')
    expect(lost.value).toContain('w5')
    // w5 is in no committed batch and is below `learned`, so the reinforce pools
    // exclude it — only the current-pool fold gets it tested again.
    const session = startSession({ type: 'standard', size: 'normal' }, seededRng(11))
    expect(session.pools.current).toContain('w5')
  })

  it('boosts the unmet mastery dimension for a near-complete mastery batch', async () => {
    setVocab(makeWords(20, { hasInflections: true }))
    // A mastery batch whose only word is learned but still needs its mastery
    // identification (the inflection word-bank) to be mastered.
    await commitBatch({ name: 'animals', collection: 'animals', level: 'mastery', color: 'gold', words: ['w0'], size: 1 })
    await learn('w0')
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'mastery', correct: true })
    expect(stateOf('w0')).toBe('learned') // mastery usage met, identification not
    // Grammar sessions draw only inflection practices (mastery identification vs
    // usage). With everything answered correctly, both dimensions' global
    // weakness is ~0; only the unmet-mastery boost tips selection toward the
    // identification practice that would finish the word.
    const practices = Array.from({ length: 5 }, (_, i) =>
      startSession({ type: 'grammar', size: 'super' }, seededRng(i + 200)).practices,
    ).flat()
    const idFraction =
      practices.filter((p) => p.dimension === 'identification').length / practices.length
    expect(idFraction).toBeGreaterThan(0.5)
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

describe('analytics', () => {
  it('reports learned and mastered word lists', async () => {
    setVocab(makeWords(2, { hasInflections: false }))
    await learn('w0')
    expect(learnedWords()).toContain('w0')
    expect(masteredWords()).toContain('w0') // uninflected → mastered
    expect(learnedWords()).not.toContain('w1')
  })

  it('backfills missing learnedAt on load so history matches the live counts', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    // A learned record persisted without a learnedAt (pre-dating stamping).
    const events = []
    for (const d of ['identification', 'usage', 'hearing']) {
      for (let i = 0; i < 3; i++) events.push({ dimension: d, level: 'learning', correct: true, ts: 7000 })
    }
    for (let i = 0; i < 3; i++) events.push({ dimension: 'speaking', level: 'learning', correct: true, ts: 7000 })
    await idb.putProgress({ word: 'w0', events, learnedAt: null, masteredAt: null, peak: 0 })

    state.records = {}
    await loadProgress()

    expect(state.records.w0.learnedAt).toBe(7000) // last attempt timestamp
    expect(history().length).toBeGreaterThan(0)
    expect(learnedWords()).toContain('w0')
  })

  it('builds a cumulative words-known-by-day history', async () => {
    setVocab(makeWords(3, { hasInflections: false }))
    await learn('w0', Date.parse('2026-06-01T10:00:00Z'))
    await learn('w1', Date.parse('2026-06-01T12:00:00Z'))
    await learn('w2', Date.parse('2026-06-03T09:00:00Z'))
    const h = history()
    expect(h).toHaveLength(2) // two distinct days
    expect(h[0]).toMatchObject({ day: '2026-06-01', learned: 2 })
    expect(h[1]).toMatchObject({ day: '2026-06-03', learned: 3 }) // cumulative
  })

  it('ranks weakest skills and resolves their focus keys', async () => {
    const nouns = ['n0', 'n1', 'n2'].map((key) => ({ key, pos: 'noun', gender: 'm', hasInflections: false }))
    setVocab(nouns)
    for (const n of nouns) {
      await recordAttempt({ word: n.key, dimension: 'usage', level: 'learning', correct: true })
    }
    const skills = weakestSkills()
    expect(skills.some((s) => s.id === 'noun:m')).toBe(true)
    const keys = focusKeysFor('noun:m')
    expect(keys).toEqual(expect.arrayContaining(['n0', 'n1', 'n2']))
  })

  it('restricts a focused session to the filtered words', () => {
    setVocab(makeWords(5, { hasInflections: false }))
    const session = startSession({ type: 'words', focusKeys: ['w0', 'w1'] }, seededRng(9))
    expect(session.focusKeys).toEqual(['w0', 'w1'])
    expect(session.pools.current).toEqual(['w0', 'w1'])
  })
})

describe('export / import', () => {
  it('validates import payloads', () => {
    expect(validateImport(null).ok).toBe(false)
    expect(validateImport({ app: 'other', version: 1, records: [] }).ok).toBe(false)
    expect(validateImport({ app: 'slovarchik', version: 1, records: [{ word: 1 }] }).ok).toBe(false)
    expect(validateImport({ app: 'slovarchik', version: 1, records: [] }).ok).toBe(true)
  })

  it('round-trips all progress through export → reset → import', async () => {
    setVocab(makeWords(2, { hasInflections: false }))
    await learn('w0', 1234)
    await commitBatch({ name: 'animals', collection: 'animals', level: 'learning', color: 'green', words: ['w0', 'w1'], size: 2 })

    const snapshot = exportData()
    expect(snapshot.app).toBe('slovarchik')
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot) // serialisable

    await resetProgress()
    expect(learnedWords()).toHaveLength(0)

    await importData(snapshot)
    expect(stateOf('w0')).toBe('mastered')
    expect(state.records.w0.learnedAt).toBe(1234)
    expect(state.learning.name).toBe('animals')
  })

  it('rejects a malformed import without touching existing data', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    await expect(importData({ app: 'nope' })).rejects.toThrow()
    expect(stateOf('w0')).toBe('mastered') // unchanged
  })
})

describe('achievements', () => {
  it('cefrStats tallies total and learned words per CEFR level', async () => {
    const a1Words = makeWords(3, { cefr: 'A1', hasInflections: false })
    // Give the A2 words distinct keys by offsetting the index manually.
    const a2Words = [
      { key: 'a2_0', cefr: 'A2', collections: [], hasInflections: false },
      { key: 'a2_1', cefr: 'A2', collections: [], hasInflections: false },
    ]
    setVocab([...a1Words, ...a2Words])
    // Learn 2 of the 3 A1 words; leave A2 untouched.
    await learn('w0')
    await learn('w1')
    const stats = cefrStats.value
    expect(stats.A1.total).toBe(3)
    expect(stats.A1.learned).toBe(2)
    expect(stats.A2.total).toBe(2)
    expect(stats.A2.learned).toBe(0)
  })

  it('earnedAchievements grants learn-1 after learning the first word', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    expect(earnedAchievements.value.has('learn-1')).toBe(false)
    await learn('w0')
    expect(earnedAchievements.value.has('learn-1')).toBe(true)
  })

  it('earnedAchievements grants master-1 only when a word is mastered', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    expect(earnedAchievements.value.has('master-1')).toBe(false)
    await learn('w0') // uninflected → mastered immediately
    expect(earnedAchievements.value.has('master-1')).toBe(true)
  })

  it('earnedAchievements grants cefr-A1 when all A1 words are learned', async () => {
    setVocab(makeWords(2, { cefr: 'A1', hasInflections: false }))
    await learn('w0')
    expect(earnedAchievements.value.has('cefr-A1')).toBe(false)
    await learn('w1')
    expect(earnedAchievements.value.has('cefr-A1')).toBe(true)
  })

  it('pendingAchievements excludes already-seen achievements', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    // Before acknowledge: pending should include learn-1.
    expect(pendingAchievements.value.some((a) => a.id === 'learn-1')).toBe(true)
    await acknowledgeAchievements()
    // After acknowledge: pending should be empty.
    expect(pendingAchievements.value).toHaveLength(0)
  })

  it('acknowledgeAchievements persists seen IDs through a reload', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    await acknowledgeAchievements()

    // Simulate reload.
    state.seenAchievements = new Set()
    await loadProgress()

    expect(state.seenAchievements.has('learn-1')).toBe(true)
    expect(pendingAchievements.value).toHaveLength(0)
  })

  it('importData silently acknowledges achievements so they do not re-fire', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    const snapshot = exportData()

    await resetProgress()
    await importData(snapshot)

    // After import, learn-1 should already be acknowledged.
    expect(pendingAchievements.value.some((a) => a.id === 'learn-1')).toBe(false)
  })

  it('resetProgress clears seen achievements', async () => {
    setVocab(makeWords(1, { hasInflections: false }))
    await learn('w0')
    await acknowledgeAchievements()
    expect(state.seenAchievements.size).toBeGreaterThan(0)
    await resetProgress()
    expect(state.seenAchievements.size).toBe(0)
  })
})

describe('streak & activity calendar', () => {
  // A fixed local-noon timestamp so day keys are timezone-stable.
  const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime()

  it('logs an exercise into today\'s activity', async () => {
    setVocab(makeWords(1))
    const today = dayKey(Date.now())
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    expect(state.activity[today]).toMatchObject({ count: 1, correct: 1 })
    expect(state.activity[today].hue).toBeTypeOf('number')
    expect(totalExercises.value).toBe(1)
  })

  it('counts an unhinted double answer (times) once per attempt', async () => {
    setVocab(makeWords(1))
    const today = dayKey(Date.now())
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, times: 2 })
    expect(state.activity[today]).toMatchObject({ count: 2, correct: 2 })
  })

  it('tracks correct vs incorrect separately', async () => {
    setVocab(makeWords(1))
    const today = dayKey(Date.now())
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: false })
    expect(state.activity[today]).toMatchObject({ count: 2, correct: 1 })
  })

  it('computes the current streak across consecutive days', async () => {
    setVocab(makeWords(1))
    const today = dayKey(Date.now())
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: now - 2 * day })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: now - day })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: now })
    expect(state.activity[today].count).toBeGreaterThan(0)
    expect(currentStreak.value).toBe(3)
    expect(longestStreak.value).toBe(3)
  })

  it('tracks the busiest-day record', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 1) })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 2) })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 2) })
    expect(dailyRecord.value).toBe(2)
  })

  it('rerolls the hue when the active batch changes', async () => {
    setVocab(makeWords(4))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    const sigA = state.batchSig
    await commitBatch({ name: 'A', collection: 'animals', level: 'learning', words: ['w0', 'w1'], size: 2 })
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    expect(state.batchSig).not.toBe(sigA)
  })

  it('back-populates activity from existing events on load', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 1) })
    // Wipe the persisted activity log but keep the per-word events, simulating a
    // learner whose data predates the streak system.
    await idb.setMeta('streak:activity', {})
    state.activity = {}
    await loadProgress()
    expect(state.activity['2026-01-01']).toMatchObject({ count: 1, correct: 1 })
  })

  it('does not double-count days already in the persisted log on load', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 1) })
    await loadProgress()
    expect(state.activity['2026-01-01'].count).toBe(1)
  })

  it('exposes a contribution calendar grid', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    const cal = activityCalendar(4)
    expect(cal.weeks).toHaveLength(4)
    const today = cal.weeks.flat().find((c) => c.day === dayKey(Date.now()))
    expect(today.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('round-trips activity through export/import', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true, ts: at(2026, 1, 1) })
    const snapshot = exportData()
    expect(snapshot.activity['2026-01-01']).toMatchObject({ count: 1, correct: 1 })
    await resetProgress()
    expect(state.activity).toEqual({})
    await importData(snapshot)
    expect(state.activity['2026-01-01']).toMatchObject({ count: 1, correct: 1 })
  })

  it('resetProgress clears the activity log', async () => {
    setVocab(makeWords(1))
    await recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    expect(totalExercises.value).toBe(1)
    await resetProgress()
    expect(state.activity).toEqual({})
    expect(currentStreak.value).toBe(0)
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
