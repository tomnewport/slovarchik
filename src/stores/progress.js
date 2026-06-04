// Reactive progress store — Phase 2 of #79.
//
// Wires the pure Phase-1 engine (progression / batches / session) into Vue's
// reactivity and IndexedDB. It records every attempt per word per dimension and
// derives all higher-level facts (states, counts, at-risk/lost, current-batch
// completion) from those attempts via the pure model — no progression logic is
// duplicated here.
//
// Persistence: one record per word in the `progress` IndexedDB store, plus the
// two current batches in `meta`. Everything survives reload and works offline.

import { computed, reactive } from 'vue'

import * as idb from '../lib/idb.js'
import { state as vocabState } from './vocab.js'
import {
  DIMENSIONS,
  STATES,
  wordState,
  wordHasInflections,
  dimensionProgress,
  lastAttemptAt,
} from '../lib/progression.js'
import { buildBatchOptions } from '../lib/batches.js'
import { buildSession } from '../lib/session.js'

// Keep storage bounded: only the most recent attempts per (level, dimension)
// matter to the model (windows of four; speaking needs three). Ten is plenty.
const MAX_EVENTS_PER_DIM = 10
// How many of the most recent attempts feed the dimension-weakness weighting.
const WEAKNESS_WINDOW = 40
// How many freshly-learned words `recentlyLearned` surfaces.
const RECENT_LIMIT = 12

const BATCH_META_KEY = (level) => `batch:${level}`

export const state = reactive({
  loaded: false,
  /** word key → { word, events, learnedAt, masteredAt, peak } */
  records: {},
  /** the committed current batches, or null */
  learning: null,
  mastery: null,
})

// ---------------------------------------------------------------------------
// Word lookup (for inflection awareness) — sourced from the vocab store.
// ---------------------------------------------------------------------------

const wordIndex = computed(() => {
  const map = new Map()
  for (const w of vocabState.words) map.set(w.key, w)
  return map
})

function wordRecord(key) {
  return wordIndex.value.get(key) ?? { key, hasInflections: false }
}

// ---------------------------------------------------------------------------
// Core state derivation — all delegated to the pure progression model.
// ---------------------------------------------------------------------------

function rank(stateName) {
  return STATES.indexOf(stateName)
}

function events(key) {
  return state.records[key]?.events ?? []
}

/** Current state of a word, computed from its attempts + the pure model. */
export function stateOf(key) {
  return wordState(events(key), wordRecord(key))
}

export const learnedCount = computed(
  () => Object.keys(state.records).filter((k) => rank(stateOf(k)) >= rank('learned')).length,
)

export const masteredCount = computed(
  () => Object.keys(state.records).filter((k) => stateOf(k) === 'mastered').length,
)

/**
 * Words that have slipped below the highest state they ever reached — these are
 * the priorities for re-learning / re-mastering.
 */
export const lost = computed(() =>
  Object.keys(state.records).filter((k) => {
    const rec = state.records[k]
    return rank(stateOf(k)) < (rec.peak ?? 0)
  }),
)

/**
 * Words currently meeting their criteria but one slip away from dropping — the
 * most recent attempt in some graded dimension was wrong.
 */
export const atRisk = computed(() =>
  Object.keys(state.records).filter((k) => {
    if (rank(stateOf(k)) < rank('learned')) return false
    return isBorderline(k)
  }),
)

function isBorderline(key) {
  const evs = events(key)
  for (const dim of DIMENSIONS) {
    const p = dimensionProgress(evs, 'learning', dim)
    if (!p.met) continue
    const recent = evs.filter((e) => e.level === 'learning' && e.dimension === dim)
    if (recent.length && recent[recent.length - 1].correct === false) return true
  }
  return false
}

/** Recently-learned words, most recent first. */
export const recentlyLearned = computed(() =>
  Object.values(state.records)
    .filter((r) => r.learnedAt != null && rank(stateOf(r.word)) >= rank('learned'))
    .sort((a, b) => b.learnedAt - a.learnedAt)
    .slice(0, RECENT_LIMIT)
    .map((r) => r.word),
)

// ---------------------------------------------------------------------------
// Recording attempts.
// ---------------------------------------------------------------------------

function ensureRecord(key) {
  if (!state.records[key]) {
    state.records[key] = { word: key, events: [], learnedAt: null, masteredAt: null, peak: 0 }
  }
  return state.records[key]
}

/** Drop all but the most recent attempts within each (level, dimension). */
function capEvents(rec) {
  const counts = new Map()
  const kept = []
  // Walk newest-first so we keep the most recent N per bucket.
  for (let i = rec.events.length - 1; i >= 0; i--) {
    const e = rec.events[i]
    const bucket = `${e.level}:${e.dimension}`
    const n = counts.get(bucket) ?? 0
    if (n < MAX_EVENTS_PER_DIM) {
      counts.set(bucket, n + 1)
      kept.push(e)
    }
  }
  kept.reverse()
  rec.events = kept
}

/**
 * Record one attempt and update derived bookkeeping (first-learned / first-
 * mastered timestamps, peak state for slip detection), then persist the word.
 * @returns {string} the word's new state
 */
export async function recordAttempt({ word, dimension, level, correct, ts = Date.now() }) {
  const rec = ensureRecord(word)
  rec.events.push({ dimension, level, correct: !!correct, ts })
  capEvents(rec)

  const next = stateOf(word)
  if (rec.learnedAt == null && rank(next) >= rank('learned')) rec.learnedAt = ts
  if (rec.masteredAt == null && next === 'mastered') rec.masteredAt = ts
  rec.peak = Math.max(rec.peak ?? 0, rank(next))

  await persist(rec)
  return next
}

function plain(rec) {
  return {
    word: rec.word,
    events: rec.events.map((e) => ({ ...e })),
    learnedAt: rec.learnedAt,
    masteredAt: rec.masteredAt,
    peak: rec.peak ?? 0,
  }
}

function persist(rec) {
  return idb.putProgress(plain(rec))
}

// ---------------------------------------------------------------------------
// Batches.
// ---------------------------------------------------------------------------

/** All vocab words as the batch engine expects them. */
function vocabWords() {
  return vocabState.words
}

/** Offer up to five batch options for the next learning or mastery journey. */
export function getBatchOptions(level = 'learning', rng = Math.random) {
  return buildBatchOptions({
    words: vocabWords(),
    stateOf: (w) => stateOf(w.key),
    level,
    learnedCount: learnedCount.value,
    rng,
  })
}

/** Commit a chosen batch as the current batch for its level; persist it. */
export async function commitBatch(option) {
  if (!option) return
  state[option.level] = option
  await idb.setMeta(BATCH_META_KEY(option.level), option)
}

/** Target state a word must reach for a batch of the given level to count it. */
function batchTarget(level) {
  return level === 'mastery' ? 'mastered' : 'learned'
}

/** Per-word state for the words in a level's current batch. */
export function batchProgress(level) {
  const batch = state[level]
  if (!batch) return []
  const target = rank(batchTarget(level))
  return batch.words.map((key) => ({ word: key, state: stateOf(key), done: rank(stateOf(key)) >= target }))
}

/** Is every word in a level's current batch at (or above) its target state? */
export function batchComplete(level) {
  const batch = state[level]
  if (!batch || batch.words.length === 0) return false
  const target = rank(batchTarget(level))
  return batch.words.every((key) => rank(stateOf(key)) >= target)
}

/** Clear the current batch so the UI can offer a fresh set of options. */
export async function advanceBatch(level) {
  state[level] = null
  await idb.setMeta(BATCH_META_KEY(level), null)
}

// ---------------------------------------------------------------------------
// Sessions.
// ---------------------------------------------------------------------------

/**
 * Per-dimension weakness weights from recent attempts: a dimension the learner
 * gets wrong (or has barely practised) is weighted up so sessions favour it.
 */
export function dimensionWeakness() {
  const recent = { }
  for (const d of DIMENSIONS) recent[d] = { total: 0, correct: 0 }
  for (const rec of Object.values(state.records)) {
    for (const e of rec.events.slice(-WEAKNESS_WINDOW)) {
      const bucket = recent[e.dimension]
      if (!bucket) continue
      bucket.total++
      if (e.correct) bucket.correct++
    }
  }
  const weakness = {}
  for (const d of DIMENSIONS) {
    const { total, correct } = recent[d]
    const accuracy = total ? correct / total : 0
    // Lower accuracy (and untested dimensions) get more weight.
    weakness[d] = Math.max(0.05, 1 - accuracy)
  }
  return weakness
}

/** Words in the current batches that have not yet reached their target. */
function currentPool() {
  const out = []
  for (const level of ['learning', 'mastery']) {
    const batch = state[level]
    if (!batch) continue
    const target = rank(batchTarget(level))
    for (const key of batch.words) if (rank(stateOf(key)) < target) out.push(key)
  }
  // Fall back to anything actively being learned if no batch is committed.
  if (out.length === 0) {
    for (const k of Object.keys(state.records)) if (stateOf(k) === 'learning') out.push(k)
  }
  return [...new Set(out)]
}

/** At-risk + lost words — the reinforcement priorities. */
function reinforcePool() {
  return [...new Set([...atRisk.value, ...lost.value])]
}

/** Non-unknown words ordered by how long since they were last tested. */
function untestedPool() {
  return Object.keys(state.records)
    .filter((k) => stateOf(k) !== 'unknown')
    .sort((a, b) => (lastAttemptAt(events(a)) ?? 0) - (lastAttemptAt(events(b)) ?? 0))
}

/**
 * Start a session of a given type. Returns the Phase-1 session plan (practices
 * tagged with their 25/25/50 bucket and weighted to the weakest dimension),
 * augmented with the candidate word pool for each bucket so the session runner
 * (Phase 3) can draw exercises. The 25% at-risk + 25% untested split realises
 * the "half reinforce" half of #79's time split; the 50% current batch is the
 * "half learn" half.
 */
export function startSession({ type = 'standard', size } = {}, rng = Math.random) {
  const session = buildSession({ type, size, weakness: dimensionWeakness(), rng })
  const pools = {
    atRisk: reinforcePool(),
    untested: untestedPool(),
    current: currentPool(),
  }
  for (const practice of session.practices) practice.pool = pools[practice.bucket] ?? []
  return { ...session, pools }
}

// ---------------------------------------------------------------------------
// Loading / persistence lifecycle.
// ---------------------------------------------------------------------------

/** Populate the store from IndexedDB (progress records + committed batches). */
export async function loadProgress() {
  const records = await idb.getAllProgress()
  const map = {}
  for (const r of records) {
    map[r.word] = {
      word: r.word,
      events: Array.isArray(r.events) ? r.events : [],
      learnedAt: r.learnedAt ?? null,
      masteredAt: r.masteredAt ?? null,
      peak: r.peak ?? 0,
    }
  }
  state.records = map
  state.learning = (await idb.getMeta(BATCH_META_KEY('learning'))) ?? null
  state.mastery = (await idb.getMeta(BATCH_META_KEY('mastery'))) ?? null
  state.loaded = true
  return state
}

/** Wipe all progress (records + batches). For the Data screen's reset/tests. */
export async function resetProgress() {
  await idb.clearProgress()
  await idb.setMeta(BATCH_META_KEY('learning'), null)
  await idb.setMeta(BATCH_META_KEY('mastery'), null)
  state.records = {}
  state.learning = null
  state.mastery = null
}

/** Expose whether a word has an inflection table (used by the UI badges). */
export function hasInflections(key) {
  return wordHasInflections(wordRecord(key))
}
