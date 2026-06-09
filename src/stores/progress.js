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
  LEVELS,
  STATES,
  CRITERIA,
  dimensionsForLevel,
  wordState,
  wordHasInflections,
  dimensionProgress,
  levelMet,
  lastAttemptAt,
} from '../lib/progression.js'
import { buildBatchOptions } from '../lib/batches.js'
import { learnableWords } from '../lib/vocabBuild.js'
import { buildSession } from '../lib/session.js'
import { practicesForSession } from '../lib/practices.js'
import { rankSkills, skillById, focusedKeys } from '../lib/focus.js'
import { earnedSet, buildCefrStats, achievementById } from '../lib/achievements.js'

/** Bumped if the export schema ever changes; guards imports. */
export const EXPORT_VERSION = 1

// Keep storage bounded: only the most recent attempts per (level, dimension)
// matter to the model (windows of four; speaking needs three). Ten is plenty.
const MAX_EVENTS_PER_DIM = 10
// How many of each word's most recent attempts feed the dimension-weakness
// weighting (applied per word, then aggregated across all words).
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
  /** epoch ms of first use (for the "how long" stat on the Data screen) */
  firstUseAt: null,
  /** Set of achievement IDs the user has already been notified about. */
  seenAchievements: new Set(),
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

/** CEFR-level stats (total words / learned words) derived from vocab + progress. */
export const cefrStats = computed(() =>
  buildCefrStats(learnableWords(vocabState.words), stateOf),
)

/** All achievement IDs the learner has currently earned (reactive). */
export const earnedAchievements = computed(() =>
  earnedSet(learnedCount.value, masteredCount.value, cefrStats.value),
)

/**
 * Achievements earned but not yet shown to the user.
 * Returns an array of achievement objects (not just IDs).
 */
export const pendingAchievements = computed(() => {
  const earned = earnedAchievements.value
  const seen = state.seenAchievements
  return [...earned]
    .filter((id) => !seen.has(id))
    .map((id) => achievementById(id))
    .filter(Boolean)
})

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
  // Check every graded ratio criterion at both levels: a met criterion whose
  // most recent attempt was wrong is one more miss from un-meeting. We skip
  // `attempts`-type criteria (speaking) — those never un-meet once reached, so
  // a wrong attempt there can't put a word at risk. Covering the mastery level
  // too means a mastered word one wrong hearing answer from dropping back to
  // learned is surfaced, not just learning-level slips.
  for (const level of LEVELS) {
    for (const dim of dimensionsForLevel(level)) {
      if (CRITERIA[level][dim].type !== 'ratio') continue
      if (!dimensionProgress(evs, level, dim).met) continue
      const recent = evs.filter((e) => e.level === level && e.dimension === dim)
      if (recent.length && recent[recent.length - 1].correct === false) return true
    }
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
 * `times` records the same outcome more than once in a single persist — an
 * unhinted correct answer counts double (#210) without a second IndexedDB write.
 * @returns {string} the word's new state
 */
export async function recordAttempt({ word, dimension, level, correct, ts = Date.now(), times = 1 }) {
  // A missing word key means there is nothing meaningful to record (e.g. a
  // phrase exercise with no source word, or a vocab entry that lacks a key).
  // Skip it gracefully rather than letting it reach the IndexedDB `put`, whose
  // keyed `progress` store would otherwise throw the opaque
  //   "Failed to execute 'put' ... key path did not yield a value"
  // DataError (#185, #190). Throwing here is no better: any such error bubbles
  // to the global handler and resurfaces as the same "unexpected error" toast
  // and auto-filed report we are trying to avoid. The caller still advances.
  if (!word) {
    console.warn('recordAttempt: skipping attempt with no word key', { dimension, level })
    return stateOf(word)
  }
  const rec = ensureRecord(word)
  for (let i = 0; i < Math.max(1, times); i++) {
    rec.events.push({ dimension, level, correct: !!correct, ts })
  }
  capEvents(rec)

  const next = stateOf(word)
  if (rec.learnedAt == null && rank(next) >= rank('learned')) rec.learnedAt = ts
  if (rec.masteredAt == null && next === 'mastered') rec.masteredAt = ts
  rec.peak = Math.max(rec.peak ?? 0, rank(next))

  await persist(rec)
  return next
}

/**
 * Mark all currently earned achievements as seen so they won't be shown again.
 * Persists to IndexedDB.
 */
export async function acknowledgeAchievements() {
  const ids = [...earnedAchievements.value]
  state.seenAchievements = new Set(ids)
  await idb.setMeta('seenAchievements', ids)
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

/** All learnable vocab words as the batch engine expects them. */
function vocabWords() {
  return learnableWords(vocabState.words)
}

/** Offer up to five batch options for the next learning or mastery journey. */
export function getBatchOptions(level = 'learning', rng = Math.random) {
  return buildBatchOptions({
    words: vocabWords(),
    stateOf: (w) => stateOf(w.key),
    level,
    rng,
  })
}

/**
 * Randomly pick one of the available mastery batch options and commit it.
 * Returns the committed option, or null if no full mastery batch can be formed
 * (fewer than MASTERY_BATCH_SIZE learned-but-unmastered words remain).
 */
export async function autoCommitMasteryBatch(rng = Math.random) {
  const options = getBatchOptions('mastery', rng)
  if (options.length === 0) return null
  const pick = options[Math.floor(rng() * options.length)]
  await commitBatch(pick)
  return pick
}

/**
 * Ensure a mastery batch is active and being worked on, assembling a fresh one
 * as soon as enough words are learned — without waiting for the previous batch's
 * completion to be celebrated. If the active batch is already complete (every
 * word mastered) it is cleared first so a new one can take its place.
 * @returns {Promise<object|null>} the newly committed batch, or null if none was
 *   committed (one is still in progress, or too few words are ready to master).
 */
export async function ensureMasteryBatch(rng = Math.random) {
  if (state.mastery && !batchComplete('mastery')) return null
  if (state.mastery) await advanceBatch('mastery')
  return autoCommitMasteryBatch(rng)
}

/** Commit a chosen batch as the current batch for its level; persist it. */
export async function commitBatch(option) {
  if (!option) return
  // Store a plain, fully-unwrapped clone: the option may arrive as a Vue
  // reactive proxy (incl. nested arrays), which IndexedDB's structured clone
  // cannot serialise. A JSON round-trip drops the proxies and stays correct if
  // the option shape ever gains a field.
  const plainOption = JSON.parse(JSON.stringify(option))
  state[plainOption.level] = plainOption
  await idb.setMeta(BATCH_META_KEY(plainOption.level), plainOption)
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

/**
 * How well a word is understood, lowest (worst) first. Counts the learning-level
 * dimension criteria it meets and adds its recent accuracy as a tiebreaker, so
 * the least-understood words sort to the front of the current pool.
 */
function understanding(key) {
  const evs = events(key)
  let met = 0
  for (const dim of dimensionsForLevel('learning')) {
    if (dimensionProgress(evs, 'learning', dim).met) met++
  }
  const recent = evs.slice(-WEAKNESS_WINDOW)
  const accuracy = recent.length ? recent.filter((e) => e.correct).length / recent.length : 0
  return met + accuracy
}

/**
 * Words in the current batches that have not yet reached their target, ordered
 * worst-understood first. The exercise builder front-biases the current bucket,
 * so this ordering makes the half-learn time favour the worst-understood word.
 */
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
  return [...new Set(out)].sort((a, b) => understanding(a) - understanding(b))
}

/**
 * At-risk + lost words — the reinforcement priorities. Restricted to words
 * currently learned or mastered: the refresh half of a session is for retaining
 * words already known, not for words still being learned.
 */
function reinforcePool() {
  return [...new Set([...atRisk.value, ...lost.value])].filter(
    (k) => rank(stateOf(k)) >= rank('learned'),
  )
}

/**
 * Learned/mastered words ordered by how long since they were last tested. Like
 * {@link reinforcePool}, this refresh pool excludes words still being learned.
 */
function untestedPool() {
  return Object.keys(state.records)
    .filter((k) => rank(stateOf(k)) >= rank('learned'))
    .sort((a, b) => (lastAttemptAt(events(a)) ?? 0) - (lastAttemptAt(events(b)) ?? 0))
}

/**
 * True when the mastery batch exists and has at least one word that has not yet
 * been mastered. Mastery-level practices are only included in sessions when this
 * is true, so a learner is never presented with mastery exercises before they
 * have words actively being mastered.
 */
function masteryBatchActive() {
  const batch = state.mastery
  if (!batch) return false
  const target = rank(batchTarget('mastery'))
  return batch.words.some((key) => rank(stateOf(key)) < target)
}

/**
 * Start a session of a given type. Returns the Phase-1 session plan (practices
 * tagged with their 25/25/50 bucket and weighted to the weakest dimension),
 * augmented with the candidate word pool for each bucket so the session runner
 * (Phase 3) can draw exercises. The 25% at-risk + 25% untested split is the 50%
 * "refresh" half — both pools draw only from learned/mastered words; the 50%
 * current batch is the "learn" half, ordered worst-understood first.
 */
export function startSession({ type = 'standard', size, focusKeys = null } = {}, rng = Math.random) {
  // Restrict to learning-level practices when no mastery batch is active —
  // but only if that leaves at least one eligible practice (e.g. a grammar
  // session has no learning-level practices and would otherwise become empty).
  const hasLearningPractices = practicesForSession(type).some((p) => p.level === 'learning')
  const levels = !masteryBatchActive() && hasLearningPractices ? ['learning'] : null
  const weakness = dimensionWeakness()
  // Boost dimensions still unmet for current-pool words so sessions stay
  // targeted at what's blocking batch completion, not just the global
  // accuracy average (which masks remaining gaps when most words are learned).
  for (const key of currentPool()) {
    const evs = events(key)
    for (const d of dimensionsForLevel('learning')) {
      if (!dimensionProgress(evs, 'learning', d).met) {
        weakness[d] = Math.max(weakness[d], 2)
      }
    }
  }
  const session = buildSession({ type, size, weakness, rng, levels })
  let pools
  if (focusKeys) {
    // Focused session: every bucket is restricted to the filtered words, which
    // also become the "current" focus.
    const set = new Set(focusKeys)
    pools = {
      atRisk: reinforcePool().filter((k) => set.has(k)),
      untested: untestedPool().filter((k) => set.has(k)),
      current: [...focusKeys],
    }
  } else {
    pools = { atRisk: reinforcePool(), untested: untestedPool(), current: currentPool() }
  }
  const masterySet = state.mastery ? new Set(state.mastery.words) : null
  for (const practice of session.practices) {
    const bucketPool = pools[practice.bucket] ?? []
    // When a non-current bucket pool is empty (e.g. no at-risk words yet),
    // fall back to the current batch pool so exercises stay within known
    // vocabulary rather than drawing random unknown words as filler.
    const base = bucketPool.length > 0 ? bucketPool : pools.current
    // Mastery-level practices must only draw from the mastery batch to avoid
    // recording mastery-level events on non-batch words (which corrupts their
    // progression state — see exerciseBuild.buildInflect for the same guard
    // on the top-up path).
    practice.pool =
      practice.level === 'mastery' && masterySet ? base.filter((k) => masterySet.has(k)) : base
  }
  return { ...session, focusKeys: focusKeys ?? null, pools }
}

/** Number of identification events recorded for a word (across all levels). */
export function encounterCount(key) {
  return (state.records[key]?.events ?? []).filter((e) => e.dimension === 'identification').length
}

/** True when a word has ever been answered correctly (any dimension/level). */
export function hasBeenCorrect(key) {
  return (state.records[key]?.events ?? []).some((e) => e.correct)
}

/** Keys of the non-unknown words matching a skill id (focused-session pool). */
export function focusKeysFor(skillId) {
  const skill = skillById(skillId)
  if (!skill) return []
  return focusedKeys(vocabWords(), skill, (k) => stateOf(k))
}

/** The learner's weakest skills, weakest first (for the Progress screen). */
export function weakestSkills() {
  return rankSkills(vocabWords(), { stateOf: (k) => stateOf(k) })
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
  // Backfill first-learned / first-mastered timestamps for any record that
  // qualifies but predates timestamp stamping, so the history chart can't fall
  // behind the live learned/mastered counts. These criteria are inflection-
  // independent, so they're safe to compute before the vocab is loaded.
  for (const rec of Object.values(map)) {
    let changed = false
    const when = lastAttemptAt(rec.events) ?? Date.now()
    if (rec.learnedAt == null && levelMet(rec.events, 'learning')) {
      rec.learnedAt = when
      changed = true
    }
    if (rec.masteredAt == null && levelMet(rec.events, 'mastery')) {
      rec.masteredAt = when
      changed = true
    }
    if (changed) await persist(rec)
  }

  state.records = map
  state.learning = (await idb.getMeta(BATCH_META_KEY('learning'))) ?? null
  state.mastery = (await idb.getMeta(BATCH_META_KEY('mastery'))) ?? null
  // Stamp first use the first time we ever load.
  state.firstUseAt = (await idb.getMeta('firstUseAt')) ?? null
  if (state.firstUseAt == null) {
    state.firstUseAt = Date.now()
    await idb.setMeta('firstUseAt', state.firstUseAt)
  }
  const seenIds = (await idb.getMeta('seenAchievements')) ?? []
  state.seenAchievements = new Set(Array.isArray(seenIds) ? seenIds : [])
  state.loaded = true
  return state
}

/** Wipe all progress (records + batches + first-use timestamp). For the Data screen's reset/tests. */
export async function resetProgress() {
  await idb.clearProgress()
  await idb.setMeta(BATCH_META_KEY('learning'), null)
  await idb.setMeta(BATCH_META_KEY('mastery'), null)
  await idb.setMeta('firstUseAt', null)
  await idb.setMeta('seenAchievements', [])
  state.records = {}
  state.learning = null
  state.mastery = null
  state.firstUseAt = null
  state.seenAchievements = new Set()
}

/** Expose whether a word has an inflection table (used by the UI badges). */
export function hasInflections(key) {
  return wordHasInflections(wordRecord(key))
}

// ---------------------------------------------------------------------------
// Analytics for the Progress screen.
// ---------------------------------------------------------------------------

/** Keys currently at (or above) `learned`. */
export function learnedWords() {
  return Object.keys(state.records).filter((k) => rank(stateOf(k)) >= rank('learned'))
}

/** Keys currently `mastered`. */
export function masteredWords() {
  return Object.keys(state.records).filter((k) => stateOf(k) === 'mastered')
}

/**
 * Cumulative words-known-by-day history, derived from each record's first
 * learned / mastered timestamps. One point per day on which something changed.
 * @returns {Array<{day: string, learned: number, mastered: number}>}
 */
export function history() {
  const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10)
  const learnedByDay = new Map()
  const masteredByDay = new Map()
  for (const rec of Object.values(state.records)) {
    if (rec.learnedAt != null) {
      const d = dayOf(rec.learnedAt)
      learnedByDay.set(d, (learnedByDay.get(d) ?? 0) + 1)
    }
    if (rec.masteredAt != null) {
      const d = dayOf(rec.masteredAt)
      masteredByDay.set(d, (masteredByDay.get(d) ?? 0) + 1)
    }
  }
  const days = [...new Set([...learnedByDay.keys(), ...masteredByDay.keys()])].sort()
  let learned = 0
  let mastered = 0
  return days.map((day) => {
    learned += learnedByDay.get(day) ?? 0
    mastered += masteredByDay.get(day) ?? 0
    return { day, learned, mastered }
  })
}

// ---------------------------------------------------------------------------
// Data export / import (the Data screen's JSON backup).
// ---------------------------------------------------------------------------

/** A serialisable snapshot of all progress data (plain, proxy-free). */
export function exportData() {
  const snapshot = {
    app: 'slovarchik',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    firstUseAt: state.firstUseAt,
    records: Object.values(state.records).map(plain),
    batches: { learning: state.learning, mastery: state.mastery },
    seenAchievements: [...state.seenAchievements],
  }
  // Round-trip to strip any Vue reactive proxies (e.g. on the batches).
  return JSON.parse(JSON.stringify(snapshot))
}

/** Validate a parsed import payload. Returns `{ ok, error }`. */
export function validateImport(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Not a backup object.' }
  if (data.app !== 'slovarchik') return { ok: false, error: 'Not a Slovarchik backup.' }
  if (typeof data.version !== 'number') return { ok: false, error: 'Missing version.' }
  if (data.version > EXPORT_VERSION) return { ok: false, error: 'Backup is from a newer version.' }
  if (!Array.isArray(data.records)) return { ok: false, error: 'Missing records.' }
  for (const r of data.records) {
    if (!r || typeof r.word !== 'string' || !Array.isArray(r.events)) {
      return { ok: false, error: 'A record is malformed.' }
    }
  }
  return { ok: true }
}

/** Replace all progress with an imported snapshot (validated first). */
export async function importData(data) {
  const check = validateImport(data)
  if (!check.ok) throw new Error(check.error)

  await idb.clearProgress()
  const map = {}
  for (const r of data.records) {
    const rec = {
      word: r.word,
      events: r.events,
      learnedAt: r.learnedAt ?? null,
      masteredAt: r.masteredAt ?? null,
      peak: r.peak ?? 0,
    }
    map[r.word] = rec
    await idb.putProgress(rec)
  }
  // Use the plain source values for persistence — reading them back off the
  // reactive `state` would hand IndexedDB a Vue proxy it can't clone.
  const learningBatch = data.batches?.learning ?? null
  const masteryBatch = data.batches?.mastery ?? null
  state.records = map
  state.learning = learningBatch
  state.mastery = masteryBatch
  await idb.setMeta(BATCH_META_KEY('learning'), learningBatch)
  await idb.setMeta(BATCH_META_KEY('mastery'), masteryBatch)
  if (data.firstUseAt) {
    state.firstUseAt = data.firstUseAt
    await idb.setMeta('firstUseAt', data.firstUseAt)
  }
  const seenIds = Array.isArray(data.seenAchievements) ? data.seenAchievements : []
  state.seenAchievements = new Set(seenIds)
  await idb.setMeta('seenAchievements', seenIds)
  // Silently acknowledge any achievements already earned in the imported data so
  // they don't all fire as notifications at the end of the very next session.
  await acknowledgeAchievements()
  return true
}
