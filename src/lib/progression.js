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

import { hasParadigm } from './paradigm.js'
import { DAY_MS } from './schedule.js'
import { dayKey } from './streak.js'

/** The dimensions of learning a word. `context` (the phrase-completion drill)
 *  only gates mastery, so it is deliberately absent from the learning criteria. */
export const DIMENSIONS = Object.freeze(['identification', 'usage', 'hearing', 'speaking', 'context'])

/** The ordered word states. A higher index is more advanced. */
export const STATES = Object.freeze(['unknown', 'learning', 'learned', 'mastered'])

/** The two levels at which a dimension can be exercised. */
export const LEVELS = Object.freeze(['learning', 'mastery'])

/**
 * The criteria from #79, per level and dimension. Each criterion is one of:
 *  - `{ type: 'ratio', need, window, days? }` — at least `need` of the last
 *    `window` attempts were correct (so it can slip back down as recent
 *    attempts fail). With `days`, the correct attempts must additionally span
 *    at least that many distinct calendar days (#313) — proof of memory across
 *    a night, not of a lucky streak within one sitting.
 *  - `{ type: 'attempts', need }` — at least `need` attempts, regardless of
 *    correctness (speaking: "attempt to speak the word correctly three times").
 *
 * Learning needs all four dimensions. Mastery needs identification + usage (a
 * complete inflection table) plus `context` — restoring the correct inflection
 * inside a natural phrase — each requiring two correct answers of the last
 * three, on two distinct days. Mastery has no speaking or hearing requirement.
 */
export const CRITERIA = Object.freeze({
  learning: {
    identification: { type: 'ratio', need: 3, window: 4 },
    usage: { type: 'ratio', need: 3, window: 4 },
    hearing: { type: 'ratio', need: 3, window: 4 },
    speaking: { type: 'attempts', need: 3 },
  },
  mastery: {
    identification: { type: 'ratio', need: 2, window: 3, days: 2 },
    usage: { type: 'ratio', need: 2, window: 3, days: 2 },
    context: { type: 'ratio', need: 2, window: 3, days: 2 },
  },
})

/**
 * Relaxed criteria for a word the learner has flagged "I know this word": every
 * dimension needs just a single correct answer, so one clean pass of each
 * exercise confirms the word at whichever level it is being drilled — no
 * repeated grinding and no overnight day-spacing. Same dimension keys (and
 * types) as {@link CRITERIA} so every criteria-driven helper stays valid; only
 * the thresholds shrink. Chosen over a placement quiz (#321): the learner
 * self-declares knowledge one word at a time and still has to demonstrate it
 * once, rather than seeding whole CEFR levels as learned on a sampled guess.
 */
export const KNOWN_CRITERIA = Object.freeze({
  learning: {
    identification: { type: 'ratio', need: 1, window: 1 },
    usage: { type: 'ratio', need: 1, window: 1 },
    hearing: { type: 'ratio', need: 1, window: 1 },
    speaking: { type: 'attempts', need: 1 },
  },
  mastery: {
    identification: { type: 'ratio', need: 1, window: 1 },
    usage: { type: 'ratio', need: 1, window: 1 },
    context: { type: 'ratio', need: 1, window: 1 },
  },
})

/**
 * The criteria set that applies to a word: the relaxed single-answer thresholds
 * once it is flagged `known`, otherwise the standard criteria. Reads the flag
 * off the word record so every helper below can honour it just by receiving the
 * word (which they already take, or now take, for inflection awareness).
 */
export function criteriaFor(word) {
  return word?.known ? KNOWN_CRITERIA : CRITERIA
}

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
  if (correct < crit.need) return false
  // Day-spacing requirement (#313): the correct attempts must span at least
  // `days` distinct calendar days. Counted over every stored attempt — not
  // just the window — so further successes can never un-meet it (a burst of
  // same-day correct answers must not demote a word the day after it earned
  // its spaced second data point).
  if (crit.days) {
    const days = new Set(list.filter((a) => a.correct).map((a) => dayKey(a.ts ?? 0)))
    if (days.size < crit.days) return false
  }
  return true
}

/**
 * Progress for one dimension at one level.
 *
 * `correct` is the lifetime count of correct attempts; `windowCorrect` counts
 * only those inside the criterion's window — the number the `need` threshold is
 * actually compared against. The two diverge as soon as a word slips: a word
 * with seven lifetime correct answers and two recent misses is at 2/3, not 7/3,
 * so anything rendering progress against `need` wants `windowCorrect`.
 * @returns {{level, dimension, attempts, correct, windowCorrect, met, crit}}
 */
export function dimensionProgress(events, level, dimension, word = {}) {
  const crit = criteriaFor(word)[level]?.[dimension] ?? null
  const attempts = attemptsFor(events, level, dimension)
  const window = crit?.type === 'ratio' ? attempts.slice(-crit.window) : attempts
  return {
    level,
    dimension,
    attempts: attempts.length,
    correct: attempts.filter((a) => a.correct).length,
    windowCorrect: window.filter((a) => a.correct).length,
    met: criterionMet(attempts, crit),
    crit,
  }
}

/**
 * Minimum number of additional correct attempts a list must gain to satisfy a
 * criterion, assuming every added attempt is answered correctly. Zero when the
 * criterion is already met. This is the "best case" distance to done — used to
 * size a batch's exercises-to-go progress bar.
 * @param {Array<{correct?: boolean}>} attempts chronological attempts
 * @param {{type: string, need: number, window?: number}} crit
 */
export function minCorrectToMeet(attempts, crit) {
  if (!crit) return 0
  const list = attempts ?? []
  // 'attempts' (speaking): any attempt counts, so it is just the shortfall.
  if (crit.type === 'attempts') return Math.max(0, crit.need - list.length)
  // 'ratio': append correct attempts until the criterion is met. Simulated
  // attempts land on successive *future* days (best case), so a `days`-spaced
  // criterion counts them as distinct days. At k = window every windowed
  // attempt is an appended correct one (need ≤ window) and by then k ≥ days
  // future days have accrued, so this always terminates.
  const base = lastAttemptAt(list) ?? 0
  const bound = crit.window + (crit.days ?? 0)
  for (let k = 0; k <= bound; k++) {
    const future = Array.from({ length: k }, (_, i) => ({ correct: true, ts: base + (i + 1) * DAY_MS }))
    if (criterionMet([...list, ...future], crit)) return k
  }
  return bound
}

/**
 * Would one more correct answer, recorded at `now`, move a criterion closer to
 * being met? False when the criterion is already met — and, crucially, false
 * when the only thing still missing is a *different calendar day* (#313): a
 * day-spaced criterion whose recent window is already full of today's correct
 * answers gains nothing from further same-day drilling. Session assembly uses
 * this to steer practice away from drills that cannot progress until tomorrow.
 * (A fresh criterion still advances today — banking today as its first day
 * shortens the distance left — so only genuinely saturated ones are excluded.)
 */
export function correctAdvancesAt(attempts, crit, now) {
  if (!crit) return false
  const list = attempts ?? []
  const before = minCorrectToMeet(list, crit)
  if (before === 0) return false
  return minCorrectToMeet([...list, { correct: true, ts: now }], crit) < before
}

/** {@link correctAdvancesAt} for one `(level, dimension)` of a word's events. */
export function dimensionAdvancesAt(events, level, dimension, now, word = {}) {
  const crit = criteriaFor(word)[level]?.[dimension] ?? null
  return correctAdvancesAt(attemptsFor(events, level, dimension), crit, now)
}

/**
 * The `(level, dimension)` pairs where a word is *borderline*: the criterion is
 * currently met, but its most recent attempt was wrong, so one more miss would
 * un-meet it. Only ratio criteria can be borderline — an attempts-type
 * criterion (speaking) never un-meets once reached. De-risking a pair takes a
 * correct answer in exactly that level and dimension (a correct answer anywhere
 * else leaves the wrong attempt as the pair's most recent), so session assembly
 * uses this list to point at-risk practice at the drill that actually helps.
 * @returns {Array<{level: string, dimension: string}>}
 */
export function borderlineDimensions(events, word = {}) {
  const out = []
  const criteria = criteriaFor(word)
  for (const level of LEVELS) {
    for (const dimension of dimensionsForLevel(level)) {
      const crit = criteria[level][dimension]
      if (crit.type !== 'ratio') continue
      const attempts = attemptsFor(events, level, dimension)
      if (!attempts.length || attempts[attempts.length - 1].correct !== false) continue
      if (criterionMet(attempts, crit)) out.push({ level, dimension })
    }
  }
  return out
}

/**
 * Minimum number of correct exercises a word still needs for every applicable
 * dimension of a level to be met (best case — each answered correctly). Summed
 * across a batch's words this is the "exercises to go" until the batch is done.
 */
export function minExercisesToLevel(events, level, word = {}) {
  const criteria = criteriaFor(word)
  return applicableDimensions(level, word).reduce(
    (sum, dim) => sum + minCorrectToMeet(attemptsFor(events, level, dim), criteria[level]?.[dim]),
    0,
  )
}

/**
 * Each learning dimension's remaining *criteria gap*, summed across a set of
 * word records: for every applicable, still-unmet dimension of a word, its
 * {@link minCorrectToMeet} (the best-case count of correct answers it still
 * owes there). Met dimensions contribute nothing, so they are absent from the
 * result. This is the raw material for gap-proportional session weighting —
 * a dimension blocking twenty words outweighs one blocking a single word —
 * which stops the slow, one-word-per-exercise dimensions (speaking, spelling)
 * from perpetually trailing the blanket ones (a matching or listening board
 * clears ~ten words at once).
 *
 * @param {Array<{events: Array, word?: object}>} records
 * @param {'learning'|'mastery'} level
 * @returns {Record<string, number>} dimension → remaining correct answers (>0)
 */
export function levelGapByDimension(records, level) {
  const gap = {}
  for (const { events, word = {} } of records ?? []) {
    const criteria = criteriaFor(word)
    for (const d of applicableDimensions(level, word)) {
      const need = minCorrectToMeet(attemptsFor(events, level, d), criteria[level]?.[d])
      if (need > 0) gap[d] = (gap[d] ?? 0) + need
    }
  }
  return gap
}

/** Parts of speech that carry the phrase-completion (context) drill. */
const CONTEXT_DRILL_POS = new Set(['noun', 'verb', 'adjective'])

/**
 * Whether the `context` mastery requirement applies to a word. Accepts a
 * precomputed boolean (`word.hasContextDrill`, stamped by the vocab store from
 * whether an annotated phrase teaches the word); otherwise falls back to the
 * part-of-speech + inflection heuristic so the model stays usable without the
 * phrase data loaded.
 */
export function wordHasContextDrill(word) {
  if (!word) return false
  if (typeof word.hasContextDrill === 'boolean') return word.hasContextDrill
  return CONTEXT_DRILL_POS.has(word.pos) && wordHasInflections(word)
}

/**
 * The dimensions graded for a level, narrowed to those that apply to `word`.
 * - At the mastery level, drops `context` for words with no phrase-completion
 *   drill (so they aren't left permanently un-masterable).
 */
export function applicableDimensions(level, word = {}) {
  const dims = dimensionsForLevel(level)
  if (level !== 'mastery') return dims
  return dims.filter((d) => d !== 'context' || wordHasContextDrill(word))
}

/** Are every applicable dimension's criteria for a level met? */
export function levelMet(events, level, word = {}) {
  const criteria = criteriaFor(word)
  return applicableDimensions(level, word).every((d) =>
    criterionMet(attemptsFor(events, level, d), criteria[level][d]),
  )
}

/**
 * Whether a word carries a usable inflection table. Accepts a precomputed
 * boolean (`word.hasInflections`) so callers/tests need not build a full word
 * record; otherwise it derives the answer from the shared paradigm builder.
 *
 * A *variant* table counts (#575): до́лжен and рад have no primary declension at
 * all, only a short form, and treating them as uninflected left them mastered
 * the moment they were learned — with the one table they do have never drilled.
 */
export function wordHasInflections(word) {
  if (!word) return false
  if (typeof word.hasInflections === 'boolean') return word.hasInflections
  try {
    return hasParadigm(word)
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
  if (!levelMet(events, 'learning', word)) return 'learning'
  // Learned. Words without an inflection table have nothing more to master.
  if (!wordHasInflections(word)) return 'mastered'
  return levelMet(events, 'mastery', word) ? 'mastered' : 'learned'
}

/**
 * A rich, UI-friendly breakdown of a word's progress: its state plus per-level,
 * per-dimension detail. `mastery.applicable` is false for words without an
 * inflection table (for which mastery collapses onto the learning criteria).
 */
export function wordProgress(events, word = {}) {
  const detail = (level) => {
    const dims = {}
    for (const d of applicableDimensions(level, word)) dims[d] = dimensionProgress(events, level, d, word)
    return dims
  }
  const masteryApplicable = wordHasInflections(word)
  return {
    state: wordState(events, word),
    learning: { dimensions: detail('learning'), met: levelMet(events, 'learning', word) },
    mastery: {
      dimensions: detail('mastery'),
      applicable: masteryApplicable,
      met: masteryApplicable ? levelMet(events, 'mastery', word) : levelMet(events, 'learning', word),
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
