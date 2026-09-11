// Per-word records: the derivation memo, everything derived from it, and every
// path that writes an attempt.
//
// This module owns the memo outright (#667). `memo` / `memoIndex` are private
// to it; `clearMemo` is exported for the two callers that replace records
// wholesale — the load/reset lifecycle and an import.
import { computed } from 'vue'

import * as idb from '../../lib/idb.js'
import {
  wordState,
  wordHasInflections,
  wordHasContextDrill,
  borderlineDimensions,
} from '../../lib/progression.js'
import { tableKey } from '../../lib/tableStage.js'
import { reviewSchedule, confirmationOutcome } from '../../lib/schedule.js'
import {
  earnedSet,
  earnedPartSet,
  partAchievements,
  buildCefrStats,
  achievementById,
  stampEarned,
} from '../../lib/achievements.js'
import { buildPartStats } from '../../lib/curriculum.js'

import { state, wordIndex, wordRecord, rank, events, learnableVocab } from './state.js'
import { persist, saveMeta } from './persistence.js'
import { logActivity } from './activity.js'
import { hasMet } from './encounters.js'
import { curriculumParts } from '../vocab.js'

// Keep storage bounded: only the most recent attempts per (level, dimension)
// matter to the model (windows of four; speaking needs three). Ten is plenty.
const MAX_EVENTS_PER_DIM = 10
// How many freshly-learned words `recentlyLearned` surfaces.
const RECENT_LIMIT = 12

// ---------------------------------------------------------------------------
// Per-word derivation memo (#531, deferred from #314).
//
// `wordState` (and `borderlineDimensions`) are pure functions of a word's
// events plus its vocab record, but seven exported computeds map them over
// every tracked record — and every `recordAttempt` invalidates all of them. At
// a couple of thousand tracked words that is tens of milliseconds of redundant
// recompute per answer, on the hot path of a drill. A word's derived state
// cannot change unless its own inputs changed, so memoise per word.
//
// The memo entry is keyed on everything those inputs can change through:
//
//   * the record object — replaced wholesale by load/import/reset;
//   * the event count, and the identity of the newest event. Identity rather
//     than its timestamp: every attempt pushes a fresh object, so this stays
//     sound when the event-window cap keeps the length steady, or when two
//     attempts share a `ts`;
//   * `known` — `markKnown` swaps in the relaxed criteria without appending
//     any event.
//
// The vocab side is covered by dropping the whole memo whenever `wordIndex`
// rebuilds (it produces a fresh Map each time `vocabState.words` is replaced),
// which matters on first load: progress is read before the vocab arrives, and
// the applicable dimensions change once it does.
//
// Every field of the key is read on the *hit* path too. That is deliberate: it
// keeps the calling computeds subscribed to exactly the reactive sources they
// depended on before, so memoising cannot make a stale computed stick.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/** word key → { rec, len, last, known, state?, borderline? } */
const memo = new Map()
let memoIndex = null

/** The live memo entry for a word, recomputing the key (never the values). */
function memoEntry(key) {
  const index = wordIndex.value
  if (index !== memoIndex) {
    memoIndex = index
    memo.clear()
  }
  const rec = state.records[key]
  const evs = rec?.events ?? []
  const len = evs.length
  const last = len > 0 ? evs[len - 1] : null
  const known = !!rec?.known
  const hit = memo.get(key)
  if (hit && hit.rec === rec && hit.len === len && hit.last === last && hit.known === known) {
    return hit
  }
  const entry = { rec, len, last, known }
  memo.set(key, entry)
  return entry
}

/** Drop the memo wholesale (bulk record replacement: load/import/reset). */
export function clearMemo() {
  memo.clear()
}

/** Current state of a word, computed from its attempts + the pure model. */
export function stateOf(key) {
  const entry = memoEntry(key)
  if (entry.state === undefined) entry.state = wordState(events(key), wordRecord(key))
  return entry.state
}

export const learnedCount = computed(
  () => Object.keys(state.records).filter((k) => rank(stateOf(k)) >= rank('learned')).length,
)

export const masteredCount = computed(
  () => Object.keys(state.records).filter((k) => stateOf(k) === 'mastered').length,
)

/** CEFR-level stats (total / met / learned / mastered) from vocab + progress. */
export const cefrStats = computed(() => buildCefrStats(learnableVocab.value, stateOf, hasMet))

/** The same four counts per curriculum part (#674) — the unit a learner works
 *  through, and what the Progress screen's bars are keyed on. */
export const partStats = computed(() => buildPartStats(curriculumParts.value, stateOf, hasMet))

/** Every achievement that can be granted, fixed and part-derived alike. */
export const achievementCatalogue = computed(() => partAchievements(curriculumParts.value))

/** Look up an achievement by id across both catalogues. */
function anyAchievementById(id) {
  return achievementById(id) ?? achievementCatalogue.value.find((a) => a.id === id)
}

/**
 * All achievement IDs the learner has earned (reactive) — those meeting their
 * threshold right now, *plus* every one ever stamped. The union is taken here
 * rather than read off the stamp alone so a freshly-earned achievement is
 * reactive immediately, before {@link stampAchievements} persists it.
 */
export const earnedAchievements = computed(
  () =>
    new Set([
      ...Object.keys(state.achievementsEarnedAt),
      ...earnedSet(learnedCount.value, masteredCount.value, cefrStats.value),
      ...earnedPartSet(curriculumParts.value, partStats.value),
    ]),
)

/**
 * Stamp any newly-earned achievement with the time it was earned, so growth in
 * the corpus (or a slipped word) can never revoke one — see `stampEarned`.
 * Called after every recorded attempt, and a no-op — with no write — when
 * nothing is new, which is all but a handful of them.
 *
 * Synchronous, persisting in the background like the activity log: the stamp
 * above is what {@link earnedAchievements} reads, so it is already correct when
 * this returns, and awaiting IndexedDB here would put a write on the hot path
 * of every drill answer. A failed write is recovered by the next attempt, which
 * re-stamps from the same live set.
 * @param {number} ts
 */
function stampAchievements(ts) {
  const { next, added } = stampEarned(state.achievementsEarnedAt, earnedAchievements.value, ts)
  if (!added.length) return
  state.achievementsEarnedAt = next
  saveMeta('achievementsEarnedAt', next)
}

/**
 * Achievements earned but not yet shown to the user.
 * Returns an array of achievement objects (not just IDs).
 */
export const pendingAchievements = computed(() => {
  const earned = earnedAchievements.value
  const seen = state.seenAchievements
  return [...earned]
    .filter((id) => !seen.has(id))
    .map((id) => anyAchievementById(id))
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
  const entry = memoEntry(key)
  if (entry.borderline === undefined) {
    entry.borderline = borderlineDimensions(events(key), wordRecord(key)).length > 0
  }
  return entry.borderline
}

/**
 * Learned by criteria, but not yet confirmed by a spaced review (#313): the
 * word completed its batch checkmarks, which only proves working memory. It
 * graduates once a review ≥1 day after reaching `learned` lands correct.
 */
export function isPendingConfirmation(key) {
  const rec = state.records[key]
  if (!rec || rec.confirmedAt != null) return false
  // A word the learner has vouched for ("I know this word") needs no overnight
  // confirmation — the point of the flag is to skip the grind, so it is eligible
  // for mastery immediately rather than waiting a day (#321).
  if (rec.known) return false
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
      // "I know this word" (#321): when set, the pure model grades this word on
      // relaxed single-answer criteria, so one clean pass of each exercise
      // confirms it as learned/mastered instead of the usual repeated drilling.
      known: false,
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
      // When the learner was shown this word's intro card (#587). Deliberately
      // separate from `agg.firstSeenAt`, which only moves on a real attempt:
      // someone shown the card who then abandons the session *has* been
      // introduced, and shouldn't meet the same card again next time.
      introducedAt: null,
      // Inflection tables the learner has assembled from the word bank with
      // nothing in the wrong cell (#645): table key (see lib/tableStage.js) →
      // timestamp. A big table not listed here is still dealt one column at a
      // time rather than all at once.
      tables: {},
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
 * @returns {Promise<string>} the word's new state
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
  // Known words (#321) opt out of the spaced confirmation entirely: the learner
  // has vouched for them, so a single correct answer is enough — no pending
  // state, no fold-back on a "failed" overnight review.
  if (!rec.known && rec.confirmedAt == null && rank(next) >= rank('learned')) {
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
  stampAchievements(ts)
  return next
}

/** Whether the learner has flagged a word "I know this word". */
export function isKnown(key) {
  return !!state.records[key]?.known
}

/**
 * Flag a word as already known (#321): from now on it is graded on the relaxed
 * single-answer criteria, so one clean pass of each exercise confirms it at
 * whichever level it is being drilled. If the word already has enough correct
 * attempts to clear the relaxed bar, this immediately lifts its state — so we
 * stamp the learned/mastered timestamps and peak here exactly as recordAttempt
 * does, keeping the history chart and slip detection consistent. A word never
 * yet attempted stays `unknown`: the learner still has to demonstrate it once.
 * @returns {Promise<string>} the word's state after flagging
 */
export async function markKnown(key) {
  if (!key) return stateOf(key)
  const rec = ensureRecord(key)
  if (rec.known) return stateOf(key)
  rec.known = true
  const ts = Date.now()
  const next = stateOf(key)
  if (rec.learnedAt == null && rank(next) >= rank('learned')) rec.learnedAt = ts
  if (rec.masteredAt == null && next === 'mastered') rec.masteredAt = ts
  rec.peak = Math.max(rec.peak ?? 0, rank(next))
  await persist(rec)
  stampAchievements(ts)
  return next
}

/**
 * Record that the learner has been shown this word's intro card (#587). Writes
 * nothing else: being introduced is not an attempt, so the word's state,
 * schedule and aggregates are all untouched.
 * @returns {Promise<number>} the timestamp stored (the existing one if already set)
 */
export async function markIntroduced(key) {
  if (!key) return null
  const rec = ensureRecord(key)
  if (rec.introducedAt) return rec.introducedAt
  rec.introducedAt = Date.now()
  await persist(rec)
  return rec.introducedAt
}

/** Has this word's intro card already been shown? */
export function wasIntroduced(key) {
  return !!state.records[key]?.introducedAt
}

/**
 * Has the learner already assembled this table from the word bank with nothing
 * in the wrong cell (#645)? Until they have, a big table is dealt one column at
 * a time to cut down the choice of forms.
 * @param {string} key the word's progress key
 * @param {string|null} [variant] which of the word's tables (null = its primary)
 */
export function isTableClean(key, variant = null) {
  return !!state.records[key]?.tables?.[tableKey(variant)]
}

/**
 * Record a table assembled with nothing misplaced. Idempotent — the first clean
 * pass is the one that counts, so a later one doesn't rewrite the timestamp.
 * @returns {Promise<number|null>} the timestamp stored
 */
export async function markTableClean(key, variant = null, ts = Date.now()) {
  if (!key) return null
  const rec = ensureRecord(key)
  if (!rec.tables) rec.tables = {}
  const table = tableKey(variant)
  if (rec.tables[table]) return rec.tables[table]
  rec.tables[table] = ts
  await persist(rec)
  return ts
}

/**
 * Clear a word's "known" flag, returning it to the standard criteria. Its
 * recorded attempts are untouched, so it re-derives its state under the full
 * thresholds (and may drop back below learned until it earns the extra reps).
 */
export async function unmarkKnown(key) {
  const rec = state.records[key]
  if (!rec || !rec.known) return
  rec.known = false
  await persist(rec)
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

/** Expose whether a word has an inflection table (used by the UI badges). */
export function hasInflections(key) {
  return wordHasInflections(wordRecord(key))
}

/** Whether the phrase-completion (context) mastery requirement applies to a word. */
export function hasContextDrill(key) {
  return wordHasContextDrill(wordRecord(key))
}
