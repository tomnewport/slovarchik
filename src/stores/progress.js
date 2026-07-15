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
  applicableDimensions,
  wordState,
  wordHasInflections,
  wordHasContextDrill,
  dimensionProgress,
  dimensionAdvancesAt,
  borderlineDimensions,
  levelMet,
  lastAttemptAt,
  minExercisesToLevel,
} from '../lib/progression.js'
import { buildBatchOptions } from '../lib/batches.js'
import { reviewSchedule, wordOverdueness, confirmationOutcome } from '../lib/schedule.js'
import { learnableWords } from '../lib/vocabBuild.js'
import { buildSession } from '../lib/session.js'
import { practicesForSession } from '../lib/practices.js'
import { rankSkills, skillById, focusedKeys } from '../lib/focus.js'
import { earnedSet, buildCefrStats, achievementById } from '../lib/achievements.js'
import {
  dayKey,
  buildActivityFromEvents,
  currentStreak as computeStreak,
  longestStreak as computeLongestStreak,
  maxDailyCount,
  totalExercises as computeTotalExercises,
  randomHue,
  hueForDay,
  buildCalendar,
} from '../lib/streak.js'

/**
 * Bumped if the export schema (or the meaning of its data) changes; guards
 * imports. v2: mastery criteria tightened to two spaced correct answers per
 * dimension (#313) — pre-v2 backups get their mastered peaks re-checked on
 * import (see {@link recheckMasteredPeak}).
 */
export const EXPORT_VERSION = 2

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
  /** word key → { word, events, learnedAt, masteredAt, peak, confirmedAt,
   *  confirmFailedAt, schedule, agg } */
  records: {},
  /** the committed current batches, or null */
  learning: null,
  mastery: null,
  /** epoch ms of first use (for the "how long" stat on the Data screen) */
  firstUseAt: null,
  /** Set of achievement IDs the user has already been notified about. */
  seenAchievements: new Set(),
  /** day key → { count, correct, hue } — the contribution calendar / streak. */
  activity: {},
  /** Hue (0..359) currently assigned to days; rerolled when the batch changes. */
  streakHue: 0,
  /** Signature of the active batches when the hue was last rerolled. */
  batchSig: '',
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

// A word is borderline when any graded ratio criterion — at either level — is
// met but its most recent attempt was wrong (see lib/progression.js). Covering
// the mastery level too means a mastered word one wrong answer from dropping
// back to learned is surfaced, not just learning-level slips.
function isBorderline(key) {
  return borderlineDimensions(events(key)).length > 0
}

/**
 * Learned by criteria, but not yet confirmed by a spaced review (#313): the
 * word completed its batch checkmarks, which only proves working memory. It
 * graduates once a review ≥1 day after reaching `learned` lands correct.
 */
export function isPendingConfirmation(key) {
  const rec = state.records[key]
  if (!rec || rec.confirmedAt != null) return false
  return rank(stateOf(key)) >= rank('learned')
}

/** All words currently pending their confirmation review. */
export const pendingConfirmation = computed(() =>
  Object.keys(state.records).filter((k) => isPendingConfirmation(k)),
)

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
    state.records[key] = {
      word: key,
      events: [],
      learnedAt: null,
      masteredAt: null,
      peak: 0,
      // Confirmation review (#313): set once a spaced review ≥1 day after
      // reaching `learned` lands correct; until then the word is "pending".
      confirmedAt: null,
      // Set when a pending word's confirmation review fails, folding it back
      // into the current pool; cleared when it is finally confirmed.
      confirmFailedAt: null,
      /** dimension → { stability, due, lastReview } (see lib/schedule.js). */
      schedule: {},
      /** Lifetime aggregates (#314): counters survive the event-window cap. */
      agg: { firstSeenAt: null, lastSeenAt: null, dims: {} },
    }
  }
  return state.records[key]
}

/** Update a record's lifetime aggregate counters for one real attempt (#314).
 *  Deliberately ignores `times` double-credit: aggregates record what actually
 *  happened, so a future scheduler can estimate difficulty from true counts. */
function updateAggregates(rec, { dimension, level, correct, ts }) {
  const agg = rec.agg ?? (rec.agg = { firstSeenAt: null, lastSeenAt: null, dims: {} })
  if (agg.firstSeenAt == null || ts < agg.firstSeenAt) agg.firstSeenAt = ts
  if (agg.lastSeenAt == null || ts > agg.lastSeenAt) agg.lastSeenAt = ts
  const bucket = `${level}:${dimension}`
  const dims = agg.dims[bucket] ?? (agg.dims[bucket] = { attempts: 0, correct: 0, streak: 0, bestStreak: 0 })
  dims.attempts++
  if (correct) {
    dims.correct++
    dims.streak++
    if (dims.streak > dims.bestStreak) dims.bestStreak = dims.streak
  } else {
    dims.streak = 0
  }
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
 * `hinted` marks answers produced with the keyboard hint available-and-used (or
 * any exercise that can't demonstrate unaided recall); the memory scheduler
 * grows stability less for those (#313).
 * @returns {string} the word's new state
 */
export async function recordAttempt({
  word,
  dimension,
  level,
  correct,
  ts = Date.now(),
  times = 1,
  hinted = true,
}) {
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
  // Lifetime aggregates and the memory schedule fold in the attempt exactly
  // once — `times` is a criteria device, not extra evidence.
  updateAggregates(rec, { dimension, level, correct: !!correct, ts })
  if (!rec.schedule) rec.schedule = {}
  rec.schedule[dimension] = reviewSchedule(rec.schedule[dimension] ?? null, {
    correct: !!correct,
    hinted,
    ts,
  })

  const next = stateOf(word)
  if (rec.learnedAt == null && rank(next) >= rank('learned')) rec.learnedAt = ts
  if (rec.masteredAt == null && next === 'mastered') rec.masteredAt = ts
  rec.peak = Math.max(rec.peak ?? 0, rank(next))
  // Confirmation review (#313): while the word still meets its criteria, a
  // spaced attempt ≥1 day after it reached `learned` either confirms it (real
  // learned) or folds it back into the current pool for re-drilling. A word
  // that slips below `learned` is handled by the lost-word plumbing instead.
  if (rec.confirmedAt == null && rank(next) >= rank('learned')) {
    const outcome = confirmationOutcome(rec, { correct: !!correct, ts })
    if (outcome === 'confirmed') {
      rec.confirmedAt = ts
      rec.confirmFailedAt = null
    } else if (outcome === 'failed') {
      rec.confirmFailedAt = ts
    }
  }

  await persist(rec)
  // Update the streak/calendar reactively now; persist it without blocking the
  // caller so recording an attempt stays a single awaited write (the session
  // runner awaits this per target, and the activity log is recoverable from the
  // events anyway).
  logActivity(ts, correct, Math.max(1, times))
  return next
}

// ---------------------------------------------------------------------------
// Streak + activity calendar (#streak-system).
// ---------------------------------------------------------------------------

/** A stable signature of the active batches; changes when either batch does. */
function batchSignature() {
  const sig = (b) => (b ? `${b.name}:${(b.words ?? []).join(',')}` : '-')
  return `${sig(state.learning)}|${sig(state.mastery)}`
}

function plainActivity() {
  return JSON.parse(JSON.stringify(state.activity))
}

/** Fire-and-forget meta write — swallow errors so it never becomes unhandled. */
function saveMeta(key, value) {
  idb.setMeta(key, value).catch(() => {})
}

/**
 * Record one day's worth of exercise effort: bump today's count/correct and
 * stamp it with the current batch hue, rerolling that hue whenever the active
 * batch has changed since the last attempt. Reactive state updates synchronously
 * (so the streak and calendar are instantly live); persistence is fire-and-forget
 * so the calendar survives the event-window capping that discards old attempts
 * without adding an awaited write to the hot recording path.
 */
function logActivity(ts, correct, times) {
  const sig = batchSignature()
  if (sig !== state.batchSig) {
    state.batchSig = sig
    state.streakHue = randomHue()
    saveMeta('streak:batchSig', sig)
    saveMeta('streak:hue', state.streakHue)
  }
  const day = dayKey(ts)
  const rec = state.activity[day] ?? { count: 0, correct: 0, hue: state.streakHue }
  rec.count += times
  if (correct) rec.correct += times
  rec.hue = state.streakHue
  state.activity[day] = rec
  saveMeta('streak:activity', plainActivity())
}

/** Current streak length in days (today, or a yesterday-grace day, backwards). */
export const currentStreak = computed(() => computeStreak(state.activity, dayKey(Date.now())))

/** Longest run of consecutive active days ever achieved. */
export const longestStreak = computed(() => computeLongestStreak(state.activity))

/** Personal record: the most exercises done in a single day. */
export const dailyRecord = computed(() => maxDailyCount(state.activity))

/** Total exercises ever done (across all days). */
export const totalExercises = computed(() => computeTotalExercises(state.activity))

/** GitHub-style contribution grid for the Progress screen. */
export function activityCalendar(weeks = 53) {
  return buildCalendar(state.activity, dayKey(Date.now()), weeks)
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
    confirmedAt: rec.confirmedAt ?? null,
    confirmFailedAt: rec.confirmFailedAt ?? null,
    // JSON round-trip strips Vue proxies from the nested maps so IndexedDB's
    // structured clone can serialise them.
    schedule: JSON.parse(JSON.stringify(rec.schedule ?? {})),
    agg: JSON.parse(JSON.stringify(rec.agg ?? { firstSeenAt: null, lastSeenAt: null, dims: {} })),
  }
}

function persist(rec) {
  return idb.putProgress(plain(rec))
}

/**
 * One-time re-check when the mastery criteria tightened (#313): a word
 * "mastered" under the old single-correct-answer rule no longer meets the
 * spaced two-answer criteria, so its state drops back to `learned` — that is
 * the point of the change — but its recorded peak would then flag it as
 * slipped and flood the reinforce pools. Cap the peak instead, so the word
 * quietly re-enters mastery batches to earn its second data point. Checked
 * without the word record (context inapplicable), which can only over-cap —
 * and the peak self-heals on the word's next attempt.
 * @returns {boolean} whether the record changed
 */
function recheckMasteredPeak(rec) {
  if ((rec.peak ?? 0) < rank('mastered')) return false
  if (levelMet(rec.events, 'mastery')) return false
  rec.peak = rank('learned')
  return true
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
  // Mastery builds on confirmed memory: a word still pending its spaced
  // confirmation review (#313) is not yet eligible to enter a mastery batch.
  const words =
    level === 'mastery' ? vocabWords().filter((w) => !isPendingConfirmation(w.key)) : vocabWords()
  return buildBatchOptions({
    words,
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

/**
 * Exercise-based completion of a level's current batch. Measures the minimum
 * number of correct exercises still needed to finish the batch (`remaining`)
 * against the number a brand-new batch of the same words would have needed
 * (`fresh`), so a smooth bar can fill from 0 (just committed) to 1 (complete)
 * as each dimension is chipped away — finer-grained than the words-done count.
 * @returns {{remaining: number, fresh: number, done: number, fraction: number}}
 */
export function batchExerciseProgress(level) {
  const batch = state[level]
  if (!batch || batch.words.length === 0) return { remaining: 0, fresh: 0, done: 0, fraction: 1 }
  let remaining = 0
  let fresh = 0
  for (const key of batch.words) {
    const word = wordRecord(key)
    remaining += minExercisesToLevel(events(key), level, word)
    fresh += minExercisesToLevel([], level, word)
  }
  const done = Math.max(0, fresh - remaining)
  return { remaining, fresh, done, fraction: fresh ? done / fresh : 1 }
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
  // Count only the dimensions this word is actually graded on, so a word whose
  // speaking is waived isn't treated as perpetually one dimension short.
  for (const dim of applicableDimensions('learning', wordRecord(key))) {
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
  // Words that have slipped below `learned` need re-learning, but they fall
  // through every other pool: the reinforce pools (at-risk / untested) keep only
  // learned-or-better words, and a slipped word is usually no longer in any
  // committed batch. Fold them into the current batch so they get tested again
  // instead of sitting in `lost` forever. They sort to the front via
  // `understanding`, so they get the most practice.
  for (const key of lost.value) if (rank(stateOf(key)) < rank('learned')) out.push(key)
  // A word that failed its confirmation review (#313) is still `learned` by
  // criteria but demonstrably not retained overnight — fold it back into the
  // current pool for focused re-drilling until a later spaced review confirms it.
  for (const [key, rec] of Object.entries(state.records)) {
    if (rec.confirmedAt == null && rec.confirmFailedAt != null && rank(stateOf(key)) >= rank('learned')) {
      out.push(key)
    }
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
 * The due pool (#313): learned/mastered words ordered by how overdue their
 * scheduled review is — the word whose weakest dimension is closest to being
 * forgotten first, not merely the least-recently-tested. Records that predate
 * the scheduler fall back to last-attempt recency (see lib/schedule.js). Like
 * {@link reinforcePool}, this refresh pool excludes words still being learned.
 */
function duePool(now = Date.now()) {
  const scored = Object.keys(state.records)
    .filter((k) => rank(stateOf(k)) >= rank('learned'))
    .map((k) => [k, wordOverdueness(state.records[k]?.schedule, lastAttemptAt(events(k)), now)])
  return scored.sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/**
 * True when the mastery batch exists and has at least one word that has not yet
 * been mastered AND can still make progress today. Mastery-level practices are
 * only included in sessions when this is true, so a learner is never presented
 * with mastery exercises before they have words actively being mastered — nor
 * once every remaining criterion is day-blocked (#313): when all a batch still
 * needs is a correct answer on *another calendar day*, today's session slots
 * are better spent on learning-level words that can actually move.
 */
function masteryBatchActive(now = Date.now()) {
  const batch = state.mastery
  if (!batch) return false
  const target = rank(batchTarget('mastery'))
  return batch.words.some((key) => {
    if (rank(stateOf(key)) >= target) return false
    const evs = events(key)
    return applicableDimensions('mastery', wordRecord(key)).some((d) =>
      dimensionAdvancesAt(evs, 'mastery', d, now),
    )
  })
}

/**
 * Start a session of a given type. Returns the Phase-1 session plan (practices
 * tagged with their 25/25/50 bucket and weighted to the weakest dimension),
 * augmented with the candidate word pool for each bucket so the session runner
 * (Phase 3) can draw exercises. The 25% at-risk + 25% untested split is the 50%
 * "refresh" half — both pools draw only from learned/mastered words; the 50%
 * current batch is the "learn" half, ordered worst-understood first.
 */
export function startSession({ type = 'standard', size, focusKeys = null, now = Date.now() } = {}, rng = Math.random) {
  const focusSet = focusKeys ? new Set(focusKeys) : null
  // Which learned/mastered words are borderline in which (level, dimension) —
  // the de-risking targets. A word only leaves the at-risk list after a correct
  // answer in exactly the (level, dimension) whose last attempt was wrong, so
  // the practice weighting and word pools below both steer to these pairs.
  const riskByDim = { learning: new Map(), mastery: new Map() }
  for (const key of Object.keys(state.records)) {
    if (rank(stateOf(key)) < rank('learned')) continue
    if (focusSet && !focusSet.has(key)) continue
    for (const { level, dimension } of borderlineDimensions(events(key))) {
      const dims = riskByDim[level]
      if (!dims.has(dimension)) dims.set(dimension, [])
      dims.get(dimension).push(key)
    }
  }
  // Restrict to learning-level practices when there is neither an active
  // mastery batch nor a word at risk at the mastery level — but only if that
  // leaves at least one eligible practice (e.g. a grammar session has no
  // learning-level practices and would otherwise become empty). Mastery-risky
  // words keep mastery practices in play because only a mastery-level drill can
  // de-risk them: a mastered word never re-enters a mastery batch, so without
  // this it would stay at risk forever.
  const hasLearningPractices = practicesForSession(type).some((p) => p.level === 'learning')
  const masteryActive = masteryBatchActive(now) || riskByDim.mastery.size > 0
  const levels = !masteryActive && hasLearningPractices ? ['learning'] : null
  // Weakness is computed *per level* so the two levels never steal each other's
  // practice-selection probability. Both start from the same global per-dimension
  // accuracy, then each level boosts only the dimensions still blocking its own
  // words. Crucially the mastery boost (e.g. lifting `identification` to fund the
  // inflection word-bank) lands only in the mastery map, so it can't pull an
  // identification drill into a learning slot whose word finished identification
  // long ago — which previously halved the share of usage drills the unlearned
  // current-batch words actually need.
  const learningWeakness = dimensionWeakness()
  const masteryWeakness = dimensionWeakness()
  // Boost dimensions still unmet for current-pool words so sessions stay
  // targeted at what's blocking batch completion, not just the global
  // accuracy average (which masks remaining gaps when most words are learned).
  for (const key of currentPool()) {
    const evs = events(key)
    // applicableDimensions (not dimensionsForLevel) so a word whose speaking is
    // waived doesn't keep boosting speaking weight it can no longer satisfy.
    for (const d of applicableDimensions('learning', wordRecord(key))) {
      if (!dimensionProgress(evs, 'learning', d).met) {
        learningWeakness[d] = Math.max(learningWeakness[d], 2)
      }
    }
  }
  // Likewise boost dimensions still unmet at the *mastery* level for the words
  // currently being mastered. Without this, a near-complete mastery batch can
  // stall on its last word: if the dimension that word still needs (e.g. the
  // inflection word-bank for identification) has high global accuracy, its
  // weakness weight collapses to ~0 and the practice that would finish the word
  // is almost never chosen.
  // A dimension only earns the boost when a correct answer *today* would move
  // some word forward. One whose every needing word is day-blocked (#313 — the
  // remaining requirement is a correct answer on another calendar day) is
  // instead zeroed, so its practices become a last resort rather than eating
  // session slots that cannot progress until tomorrow.
  if (state.mastery) {
    const needed = new Set()
    const advanceable = new Set()
    for (const key of state.mastery.words) {
      if (stateOf(key) !== 'learned') continue
      const evs = events(key)
      for (const d of applicableDimensions('mastery', wordRecord(key))) {
        if (dimensionProgress(evs, 'mastery', d).met) continue
        needed.add(d)
        if (dimensionAdvancesAt(evs, 'mastery', d, now)) advanceable.add(d)
      }
    }
    for (const d of needed) {
      masteryWeakness[d] = advanceable.has(d) ? Math.max(masteryWeakness[d], 2) : 0
    }
  }
  // Dimensions with mastery-level at-risk words always earn a boost (applied
  // after the day-blocking zeroing above): a correct answer there de-risks the
  // word today, so the dimension is never day-blocked.
  for (const [d, keys] of riskByDim.mastery) {
    if (keys.length) masteryWeakness[d] = Math.max(masteryWeakness[d] ?? 0, 2)
  }
  const weakness = { learning: learningWeakness, mastery: masteryWeakness }
  // At-risk slots get their own weights, proportional to how many words are at
  // risk in each dimension, so the slot's practice lands on a drill that can
  // actually de-risk something instead of one whose recent history is clean.
  if (riskByDim.learning.size > 0) {
    const atRiskWeakness = {}
    for (const d of DIMENSIONS) atRiskWeakness[d] = riskByDim.learning.get(d)?.length ?? 0
    weakness.atRisk = atRiskWeakness
  }
  const session = buildSession({ type, size, weakness, rng, levels })
  let pools
  if (focusKeys) {
    // Focused session: every bucket is restricted to the filtered words, which
    // also become the "current" focus.
    const set = new Set(focusKeys)
    pools = {
      atRisk: reinforcePool().filter((k) => set.has(k)),
      untested: duePool().filter((k) => set.has(k)),
      current: [...focusKeys],
    }
  } else {
    // The `untested` bucket keeps its historical name in the session shape, but
    // it is fed by the scheduler's due queue (most-overdue first) — this is the
    // refresh half that makes the practice spaced repetition (#313).
    pools = { atRisk: reinforcePool(), untested: duePool(), current: currentPool() }
  }
  const masterySet = state.mastery ? new Set(state.mastery.words) : null
  for (const practice of session.practices) {
    const bucketPool = pools[practice.bucket] ?? []
    // When a non-current bucket pool is empty (e.g. no at-risk words yet),
    // fall back to the current batch pool so exercises stay within known
    // vocabulary rather than drawing random unknown words as filler.
    let base = bucketPool.length > 0 ? bucketPool : pools.current
    // An at-risk slot narrows to the words at risk in ITS dimension — a correct
    // answer in any other dimension cannot de-risk them. When no word is at
    // risk in this dimension the slot keeps the wider reinforce pool.
    if (practice.bucket === 'atRisk' && practice.level === 'learning') {
      const risky = riskByDim.learning.get(practice.dimension) ?? []
      if (risky.length) base = risky
    }
    const masteryRisky = riskByDim.mastery.get(practice.dimension) ?? []
    if (practice.level === 'mastery' && (masterySet || masteryRisky.length)) {
      // Mastery-level practices must only draw from the mastery batch to avoid
      // recording mastery-level events on non-batch words (which corrupts their
      // progression state — see exerciseBuild.buildInflect for the same guard
      // on the top-up path) — plus the words at risk in this dimension: those
      // already carry a met mastery criterion, so further mastery attempts are
      // safe, and a correct one is the only thing that de-risks them.
      const riskySet = new Set(masteryRisky)
      const batchWords = masterySet ? base.filter((k) => masterySet.has(k)) : []
      const candidates = [...new Set([...batchWords, ...masteryRisky])]
      // Prefer words this practice's dimension can still advance today: a word
      // whose criterion is met, or day-blocked (#313 — it just needs another
      // calendar day), gains nothing from more drilling now. An at-risk word
      // always counts as advanceable — its criterion is met, so
      // dimensionAdvancesAt says no, but a correct answer still moves it (off
      // the at-risk list). Fall back to every candidate when nothing can
      // advance (e.g. an all-mastery grammar session with everything blocked)
      // so the session still has content.
      const advancing = candidates.filter(
        (k) => riskySet.has(k) || dimensionAdvancesAt(events(k), 'mastery', practice.dimension, now),
      )
      practice.pool = advancing.length > 0 ? advancing : candidates
    } else {
      practice.pool = base
    }
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
  // Records persisted before the scheduler existed carry no `schedule` field.
  // Their learned words are grandfathered as already confirmed below — the
  // learner shouldn't wake up to every known word suddenly "pending" (#313).
  const legacy = new Set()
  for (const r of records) {
    if (r.schedule === undefined) legacy.add(r.word)
    map[r.word] = {
      word: r.word,
      events: Array.isArray(r.events) ? r.events : [],
      learnedAt: r.learnedAt ?? null,
      masteredAt: r.masteredAt ?? null,
      peak: r.peak ?? 0,
      confirmedAt: r.confirmedAt ?? null,
      confirmFailedAt: r.confirmFailedAt ?? null,
      schedule: r.schedule ?? {},
      agg: r.agg ?? { firstSeenAt: null, lastSeenAt: null, dims: {} },
    }
  }
  // Backfill first-learned / first-mastered timestamps for any record that
  // qualifies but predates timestamp stamping, so the history chart can't fall
  // behind the live learned/mastered counts. These criteria are inflection-
  // independent, so they're safe to compute before the vocab is loaded.
  const masteryRechecked = (await idb.getMeta('migration:mastery-recheck')) ?? false
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
    if (legacy.has(rec.word) && rec.learnedAt != null && rec.confirmedAt == null) {
      rec.confirmedAt = rec.learnedAt
      changed = true
    }
    if (!masteryRechecked && recheckMasteredPeak(rec)) changed = true
    if (changed) await persist(rec)
  }
  if (!masteryRechecked) await idb.setMeta('migration:mastery-recheck', true)

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

  // Activity calendar / streak. The forward-logged store is authoritative; on
  // first run (or for any day it lacks) back-populate from the surviving per-
  // word events so existing learners keep their history. Capping means old days
  // may undercount, but it's the best available — and we never overwrite a day
  // already logged, so no day is double-counted.
  state.streakHue = (await idb.getMeta('streak:hue')) ?? randomHue()
  state.batchSig = (await idb.getMeta('streak:batchSig')) ?? batchSignature()
  const storedActivity = (await idb.getMeta('streak:activity')) ?? {}
  const activity = { ...storedActivity }
  const derived = buildActivityFromEvents(state.records)
  let backfilled = false
  for (const [day, d] of Object.entries(derived)) {
    if (!activity[day]) {
      activity[day] = { count: d.count, correct: d.correct, hue: hueForDay(day) }
      backfilled = true
    }
  }
  state.activity = activity
  if (backfilled) await idb.setMeta('streak:activity', plainActivity())

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
  await idb.setMeta('streak:activity', {})
  await idb.setMeta('streak:hue', null)
  await idb.setMeta('streak:batchSig', null)
  state.records = {}
  state.learning = null
  state.mastery = null
  state.firstUseAt = null
  state.seenAchievements = new Set()
  state.activity = {}
  state.streakHue = randomHue()
  state.batchSig = ''
}

/** Expose whether a word has an inflection table (used by the UI badges). */
export function hasInflections(key) {
  return wordHasInflections(wordRecord(key))
}

/** Whether the phrase-completion (context) mastery requirement applies to a word. */
export function hasContextDrill(key) {
  return wordHasContextDrill(wordRecord(key))
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
    activity: state.activity,
    streakHue: state.streakHue,
    batchSig: state.batchSig,
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
      // Backups from before the scheduler carry no `schedule`: grandfather
      // their learned words as confirmed, same as loadProgress does (#313).
      confirmedAt: r.confirmedAt ?? (r.schedule === undefined ? (r.learnedAt ?? null) : null),
      confirmFailedAt: r.confirmFailedAt ?? null,
      schedule: r.schedule ?? {},
      agg: r.agg ?? { firstSeenAt: null, lastSeenAt: null, dims: {} },
    }
    // Backups exported before the mastery criteria tightened (v1) carry peaks
    // earned under the old single-answer rule — re-check them (#313).
    if (data.version < 2) recheckMasteredPeak(rec)
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
  // Restore the activity calendar / streak, falling back to whatever the events
  // imply for backups that predate the streak system.
  const importedActivity =
    data.activity && typeof data.activity === 'object'
      ? data.activity
      : buildActivityFromEvents(map)
  state.activity = JSON.parse(JSON.stringify(importedActivity))
  state.streakHue = typeof data.streakHue === 'number' ? data.streakHue : randomHue()
  state.batchSig = typeof data.batchSig === 'string' ? data.batchSig : batchSignature()
  await idb.setMeta('streak:activity', plainActivity())
  await idb.setMeta('streak:hue', state.streakHue)
  await idb.setMeta('streak:batchSig', state.batchSig)
  // Silently acknowledge any achievements already earned in the imported data so
  // they don't all fire as notifications at the end of the very next session.
  await acknowledgeAchievements()
  return true
}
