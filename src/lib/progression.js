// Word progression model — the "brain" that turns a word's recorded attempts
// into its learning state. Pure and framework-free (no Vue, no DOM, no I/O) so
// it is trivially unit-testable, mirroring the other `src/lib/*` modules.
//
// A learner moves a word through four states:
//
//   unknown → learning → learned → mastered
//
//   unknown   never seen in an exercise
//   learning  seen at least once, but not yet learned
//   learned   spelled / identified / heard consistently (the word-level criteria)
//   mastered  also inflected correctly (or, for words without inflections,
//             nothing more than the word-level criteria — "they just need to
//             spell it")
//
// Progress is tracked across four *dimensions* of skill and at two *levels*
// (learning vs mastery). Every recorded attempt maps to a `(dimension, level)`
// pair plus whether it was correct; a word's state is recomputed from scratch
// from its attempt history each time, so words can also slip back down.

import { buildParadigm } from './paradigm.js'

/** The four dimensions of learning a word. */
export const DIMENSIONS = Object.freeze(['identification', 'usage', 'hearing', 'speaking'])

/** The ordered word states. A higher index is more advanced. */
export const STATES = Object.freeze(['unknown', 'learning', 'learned', 'mastered'])

/** The two levels at which a dimension can be exercised. */
export const LEVELS = Object.freeze(['learning', 'mastery'])

/**
 * The criteria from #79, per level and dimension. Each criterion is one of:
 *  - `{ type: 'ratio', need, window }` — at least `need` of the last `window`
 *    attempts were correct (so it can slip back down as recent attempts fail).
 *  - `{ type: 'attempts', need }` — at least `need` attempts, regardless of
 *    correctness (speaking: "attempt to speak the word correctly three times").
 *
 * Learning needs all four dimensions. Mastery needs identification + usage (a
 * complete inflection table, modelled as a single correct most-recent attempt)
 * plus hearing 3/4. Mastery has no speaking requirement.
 */
export const CRITERIA = Object.freeze({
  learning: {
    identification: { type: 'ratio', need: 3, window: 4 },
    usage: { type: 'ratio', need: 3, window: 4 },
    hearing: { type: 'ratio', need: 3, window: 4 },
    speaking: { type: 'attempts', need: 3 },
  },
  mastery: {
    identification: { type: 'ratio', need: 1, window: 1 },
    usage: { type: 'ratio', need: 1, window: 1 },
    hearing: { type: 'ratio', need: 3, window: 4 },
  },
})

/** The dimensions a given level is graded on, in display order. */
export function dimensionsForLevel(level) {
  const crit = CRITERIA[level]
  return crit ? DIMENSIONS.filter((d) => d in crit) : []
}

/** Attempts recorded for one `(level, dimension)`, in chronological order. */
function attemptsFor(events, level, dimension) {
  return (events ?? []).filter((e) => e.level === level && e.dimension === dimension)
}

/**
 * Does a list of attempts (chronological) satisfy a single criterion?
 * @param {Array<{correct?: boolean}>} attempts
 * @param {{type: string, need: number, window?: number}} crit
 */
export function criterionMet(attempts, crit) {
  if (!crit) return true
  const list = attempts ?? []
  if (crit.type === 'attempts') return list.length >= crit.need
  // 'ratio': count correct within the most recent `window` attempts.
  const recent = list.slice(-crit.window)
  const correct = recent.filter((a) => a.correct).length
  return correct >= crit.need
}

/**
 * Progress for one dimension at one level.
 * @returns {{level, dimension, attempts, correct, met, crit}}
 */
export function dimensionProgress(events, level, dimension) {
  const crit = CRITERIA[level]?.[dimension] ?? null
  const attempts = attemptsFor(events, level, dimension)
  return {
    level,
    dimension,
    attempts: attempts.length,
    correct: attempts.filter((a) => a.correct).length,
    met: criterionMet(attempts, crit),
    crit,
  }
}

/** Are every dimension's criteria for a level met? */
export function levelMet(events, level) {
  return dimensionsForLevel(level).every((d) =>
    criterionMet(attemptsFor(events, level, d), CRITERIA[level][d]),
  )
}

/**
 * Whether a word carries a usable inflection table. Accepts a precomputed
 * boolean (`word.hasInflections`) so callers/tests need not build a full word
 * record; otherwise it derives the answer from the shared paradigm builder.
 */
export function wordHasInflections(word) {
  if (!word) return false
  if (typeof word.hasInflections === 'boolean') return word.hasInflections
  try {
    return buildParadigm(word) != null
  } catch {
    return false
  }
}

/**
 * Compute a word's current state from its attempt history.
 * @param {Array} events attempts for this word (any order within a dimension is
 *   treated as chronological)
 * @param {object} [word] the word record (used to decide if mastery applies)
 * @returns {'unknown'|'learning'|'learned'|'mastered'}
 */
export function wordState(events, word = {}) {
  if (!events || events.length === 0) return 'unknown'
  if (!levelMet(events, 'learning')) return 'learning'
  // Learned. Words without an inflection table have nothing more to master.
  if (!wordHasInflections(word)) return 'mastered'
  return levelMet(events, 'mastery') ? 'mastered' : 'learned'
}

/**
 * A rich, UI-friendly breakdown of a word's progress: its state plus per-level,
 * per-dimension detail. `mastery.applicable` is false for words without an
 * inflection table (for which mastery collapses onto the learning criteria).
 */
export function wordProgress(events, word = {}) {
  const detail = (level) => {
    const dims = {}
    for (const d of dimensionsForLevel(level)) dims[d] = dimensionProgress(events, level, d)
    return dims
  }
  const masteryApplicable = wordHasInflections(word)
  return {
    state: wordState(events, word),
    learning: { dimensions: detail('learning'), met: levelMet(events, 'learning') },
    mastery: {
      dimensions: detail('mastery'),
      applicable: masteryApplicable,
      met: masteryApplicable ? levelMet(events, 'mastery') : levelMet(events, 'learning'),
    },
  }
}

/** Timestamp of the most recent attempt, or null if never attempted. */
export function lastAttemptAt(events) {
  let latest = null
  for (const e of events ?? []) {
    const ts = e.ts ?? null
    if (ts != null && (latest == null || ts > latest)) latest = ts
  }
  return latest
}
