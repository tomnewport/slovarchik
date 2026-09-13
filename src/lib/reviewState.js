// When a word comes back, and whether it held overnight — the scheduler's state
// in the learner's terms.
//
// `lib/schedule.js` is the model: every dimension of every word carries a
// stability (its current review interval) and a `due` time, and every answer
// folds into them. `recordAttempt` has written that record since #313 and the
// due queue has sorted sessions by it ever since, but none of it reached a
// screen: the word card could say a word was learned on Tuesday and not when it
// is next expected, nor whether it had passed the overnight confirmation review
// that separates "finished the batch" from "learned". `isDue` had no caller at
// all. This module turns one progress record into that answer.
//
// Nothing here decides anything — it reports what the scheduler already holds.
// Framework-free (no Vue, no store, no DOM) like the rest of `src/lib/`.

import { STATES } from './progression.js'
import { CONFIRM_GAP_MS, DAY_MS, isDue, overdueness } from './schedule.js'

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
/** Used only to name a long interval; the model never reasons in months. */
const MONTH_MS = 30 * DAY_MS

function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * A duration in the largest unit that still leaves a number worth reading, so a
 * four-month interval doesn't arrive as "124 days". Each branch rounds from the
 * original duration rather than from the branch above it, so nothing lands on
 * "24 hours" or "14 days" — the value that would read that way has already
 * fallen through to the next unit.
 */
export function formatInterval(ms) {
  const abs = Math.max(0, ms)
  if (abs < HOUR_MS) return 'under an hour'
  const hours = Math.round(abs / HOUR_MS)
  if (hours < 24) return plural(hours, 'hour')
  const days = Math.round(abs / DAY_MS)
  if (days < 14) return plural(days, 'day')
  const weeks = Math.round(abs / WEEK_MS)
  if (weeks < 9) return plural(weeks, 'week')
  return plural(Math.round(abs / MONTH_MS), 'month')
}

/**
 * A due time relative to now: ahead of it, on it, or past it. The hour of grace
 * either side of zero keeps a review the learner has just earned from reading
 * as "1 hour overdue" the moment the modal is reopened.
 */
export function formatDue(due, now) {
  const delta = due - now
  if (delta > HOUR_MS) return `in ${formatInterval(delta)}`
  if (delta >= -HOUR_MS) return 'due now'
  return `${formatInterval(-delta)} overdue`
}

/**
 * Where a word stands with its confirmation review (#313) — the spaced answer a
 * day or more after it reached `learned` that separates having finished the
 * batch from having learned the word.
 *
 * `status` is one of:
 *  - `confirmed` — a later review landed correct; `at` is when.
 *  - `waived` — the learner flagged the word known (#321), so it skips the wait.
 *  - `waiting` — learned, but not yet old enough to be confirmed; `eligibleAt`
 *    is the earliest an answer can settle it.
 *  - `due` — old enough, and the next answer in any drill settles it.
 *  - `failed` — a review after the gap came back wrong; `at` is when. The word
 *    is folded back into the current pool until one lands correct.
 *  - `none` — nothing to say yet: the word has never reached `learned`, or has
 *    since slipped below it (a slip is the lost-word plumbing's business, and
 *    its own panel on the card already says so).
 *
 * @param {PlainObject|null} rec the progress record
 * @param {{now?: number, state?: string|null}} [opts] `state` is the word's
 *   current state, so a slipped word isn't told to expect a confirmation it
 *   cannot earn until its criteria are whole again.
 */
export function confirmationState(rec, { now = Date.now(), state = null } = {}) {
  const learnedAt = rec?.learnedAt ?? null
  const confirmedAt = rec?.confirmedAt ?? null
  const failedAt = rec?.confirmFailedAt ?? null
  const none = { status: 'none', at: null, eligibleAt: null, text: null }
  if (confirmedAt != null) {
    return {
      status: 'confirmed',
      at: confirmedAt,
      eligibleAt: null,
      text: 'A later review confirmed this word held overnight.',
    }
  }
  if (learnedAt == null) return none
  if (state != null && STATES.indexOf(state) < STATES.indexOf('learned')) return none
  if (rec?.known) {
    return {
      status: 'waived',
      at: null,
      eligibleAt: null,
      text: 'Marked known, so this word skips the overnight confirmation.',
    }
  }
  const eligibleAt = learnedAt + CONFIRM_GAP_MS
  if (failedAt != null) {
    return {
      status: 'failed',
      at: failedAt,
      eligibleAt,
      text: 'A review after the first night came back wrong, so the word is back in the current batch until one lands correct.',
    }
  }
  if (now < eligibleAt) {
    return {
      status: 'waiting',
      at: null,
      eligibleAt,
      text: 'Finishing the batch proves working memory. The first answer from tomorrow settles whether it stuck.',
    }
  }
  return {
    status: 'due',
    at: null,
    eligibleAt,
    text: 'The next answer in any drill settles the confirmation review.',
  }
}

/**
 * The whole review picture for one word: a row per scheduled dimension, the
 * soonest of them, and the confirmation state above.
 *
 * Rows are ordered most-overdue first — the same sort the due queue uses to
 * decide what a session reaches for — so the top row is the skill the engine
 * would pick next. `scheduled` is false for a word whose dimensions carry no
 * schedule at all: a word never answered, or one last practised before the
 * scheduler existed (those records are normalised to an empty schedule, which
 * fills in again on the word's next answer).
 *
 * @param {PlainObject|null} rec the progress record
 * @param {{now?: number, state?: string|null}} [opts]
 * @returns {{scheduled: boolean, dimensions: Array, next: PlainObject|null,
 *   dueCount: number, confirmation: PlainObject}}
 */
export function reviewState(rec, { now = Date.now(), state = null } = {}) {
  const schedule = rec?.schedule ?? {}
  const dimensions = Object.entries(schedule)
    .filter(([, sch]) => sch && typeof sch.due === 'number')
    .map(([dimension, sch]) => ({
      dimension,
      stability: sch.stability,
      due: sch.due,
      lastReview: sch.lastReview,
      overdueness: overdueness(sch, now),
      dueNow: isDue(sch, now),
      interval: formatInterval(sch.stability),
      when: formatDue(sch.due, now),
    }))
    .sort((a, b) => b.overdueness - a.overdueness)
  return {
    scheduled: dimensions.length > 0,
    dimensions,
    next: dimensions.reduce((soonest, d) => (soonest && soonest.due <= d.due ? soonest : d), null),
    dueCount: dimensions.filter((d) => d.dueNow).length,
    confirmation: confirmationState(rec, { now, state }),
  }
}
