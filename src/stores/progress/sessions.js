// Sessions: the snapshot the pure session engine reads, and the per-word and
// per-skill views the session and progress screens ask for.
//
// Reads from `records.js` (`atRisk`, `lost`, `stateOf`) and writes nothing.
import {
  STATES,
  applicableDimensions,
  dimensionProgress,
  lastAttemptAt,
} from '../../lib/progression.js'
import {
  assembleSession,
  dimensionWeakness as computeDimensionWeakness,
} from '../../lib/sessionPools.js'
import { rankSkills, skillById, focusedKeys } from '../../lib/focus.js'
import { recoveryPlan } from '../../lib/recovery.js'

import { state, wordRecord, events, vocabWords } from './state.js'
import { stateOf, atRisk, lost } from './records.js'

/** Snapshot of the reactive store the pure session engine reads from. */
function sessionSnapshot() {
  return {
    records: state.records,
    wordRecord,
    learning: state.learning,
    mastery: state.mastery,
    atRisk: atRisk.value,
    lost: lost.value,
  }
}

/**
 * Per-dimension weakness weights from recent attempts: a dimension the learner
 * gets wrong (or has barely practised) is weighted up so sessions favour it.
 * Thin wrapper over the pure engine (see lib/sessionPools.js).
 */
export function dimensionWeakness() {
  return computeDimensionWeakness(state.records)
}

/**
 * Start a session of a given type. Returns the Phase-1 session plan (practices
 * tagged with their 25/25/50 bucket and weighted to the weakest dimension),
 * augmented with the candidate word pool for each bucket so the session runner
 * (Phase 3) can draw exercises. The 25% at-risk + 25% untested split is the 50%
 * "refresh" half — both pools draw only from learned/mastered words; the 50%
 * current batch is the "learn" half, ordered worst-understood first.
 *
 * All the pool building and weakness weighting is the pure `assembleSession`
 * engine (lib/sessionPools.js); this only supplies the store snapshot.
 */
export function startSession(opts = {}, rng = Math.random) {
  return assembleSession(sessionSnapshot(), opts, rng)
}

/** Number of identification events recorded for a word (across all levels). */
export function encounterCount(key) {
  return (state.records[key]?.events ?? []).filter((e) => e.dimension === 'identification').length
}

/** True when a word has ever been answered correctly (any dimension/level). */
export function hasBeenCorrect(key) {
  return (state.records[key]?.events ?? []).some((e) => e.correct)
}

/**
 * A full snapshot of a word's learning progress, for the word-detail modal:
 * its current and peak state, first-learned / first-mastered timestamps, total
 * attempts and last-seen time, and per-level dimension progress (only the
 * dimensions the word is actually graded on). `tracked` is false for a word the
 * engine has never recorded an attempt against.
 *
 * `recovery` is what the word has lost and what would win it back (see
 * lib/recovery.js) — the card is opened from the slipped and at-risk lists as
 * well as from a batch, and those two need it to say what dropped. `inBatch`
 * says whether the word is in a committed batch at all, which is what decides
 * whether "leave for later" is a removal or an erasure.
 */
export function wordProgressDetail(key) {
  const rec = state.records[key] ?? null
  const evs = events(key)
  const word = wordRecord(key)
  const levels = {}
  for (const level of ['learning', 'mastery']) {
    levels[level] = applicableDimensions(level, word).map((d) => dimensionProgress(evs, level, d, word))
  }
  return {
    tracked: !!rec,
    known: !!rec?.known,
    state: stateOf(key),
    peak: STATES[rec?.peak ?? 0],
    learnedAt: rec?.learnedAt ?? null,
    masteredAt: rec?.masteredAt ?? null,
    introducedAt: rec?.introducedAt ?? null,
    totalAttempts: evs.length,
    lastAt: lastAttemptAt(evs),
    levels,
    recovery: recoveryPlan(evs, word, { peak: rec?.peak, state: stateOf(key) }),
    inBatch: inAnyBatch(key),
  }
}

/** Is the word in either committed batch? */
function inAnyBatch(key) {
  return !!(state.learning?.words?.includes(key) || state.mastery?.words?.includes(key))
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
