// Memory scheduler — the forgetting model behind spaced repetition (#313).
//
// Each dimension of each word carries a small schedule record:
//
//   { stability, due, lastReview }
//
// `stability` is the model's estimate (in ms) of how long the memory lasts:
// the review interval. A *spaced* success grows it — the growth factor scales
// with how much of the interval had elapsed, so massed same-session repeats
// barely move it while a success after the full interval multiplies it (more
// for an unhinted answer than a hinted one). A failure halves it and makes the
// dimension due immediately, so the next session's refresh half picks it up.
//
// This is a deliberately simplified take on FSRS-style scheduling: full FSRS
// wants many fitted parameters and aggregate training data that an offline
// single-user app doesn't have. Everything here is pure and framework-free;
// timestamps are epoch ms and injectable for tests.

export const DAY_MS = 24 * 60 * 60 * 1000

/** Stability granted by the first-ever correct answer in a dimension. */
export const FIRST_STABILITY_MS = DAY_MS
/** Stability never drops below this, so `overdueness` stays well-behaved. */
export const MIN_STABILITY_MS = DAY_MS / 4
/** Assumed stability for learned words that predate the scheduler. */
export const DEFAULT_STABILITY_MS = 3 * DAY_MS
/** Growth factor for a fully-spaced correct answer typed without the hint. */
export const GROWTH_UNHINTED = 2.5
/** Growth factor for a fully-spaced correct answer that used the hint. */
export const GROWTH_HINTED = 1.6
/** A failure halves stability. */
export const FAIL_FACTOR = 0.5

/**
 * Fold one review into a dimension's schedule.
 * @param {{stability: number, due: number, lastReview: number}|null} prev
 *   the dimension's schedule before this review (null on first review)
 * @param {{correct: boolean, hinted?: boolean, ts?: number}} review
 *   `hinted` marks answers produced with the keyboard hint (or any exercise
 *   where unaided recall wasn't demonstrated); they grow stability less.
 * @returns {{stability: number, due: number, lastReview: number}}
 */
export function reviewSchedule(prev, { correct, hinted = true, ts = Date.now() } = {}) {
  if (!correct) {
    // Halve stability and make the dimension due right away.
    const base = prev?.stability ?? MIN_STABILITY_MS / FAIL_FACTOR
    const stability = Math.max(MIN_STABILITY_MS, base * FAIL_FACTOR)
    return { stability, due: ts, lastReview: ts }
  }
  if (!prev) {
    return { stability: FIRST_STABILITY_MS, due: ts + FIRST_STABILITY_MS, lastReview: ts }
  }
  // Scale growth by how much of the interval elapsed: a same-session repeat
  // (elapsed ≈ 0) leaves stability unchanged, a review at (or past) the full
  // interval earns the whole growth factor. Capping the ratio at 1 keeps the
  // model conservative for very late reviews.
  const growth = hinted ? GROWTH_HINTED : GROWTH_UNHINTED
  const elapsed = Math.max(0, ts - prev.lastReview)
  const spacing = Math.min(1, elapsed / Math.max(1, prev.stability))
  const factor = 1 + (growth - 1) * spacing
  const stability = Math.max(MIN_STABILITY_MS, prev.stability * factor)
  return { stability, due: ts + stability, lastReview: ts }
}

/** Is a dimension's review due? (No schedule at all counts as due.) */
export function isDue(schedule, now = Date.now()) {
  return schedule == null || now >= schedule.due
}

/**
 * How overdue a dimension's review is, as elapsed time over stability: 1 at
 * exactly due, >1 overdue, <1 not yet due. This is the sort key that puts the
 * memory closest to being forgotten first.
 */
export function overdueness(schedule, now = Date.now()) {
  if (schedule == null) return Infinity
  return Math.max(0, now - schedule.lastReview) / Math.max(1, schedule.stability)
}

/**
 * A whole word's overdueness: that of its most-overdue scheduled dimension.
 * Records that predate the scheduler have no schedule map — fall back to time
 * since the last attempt over an assumed default stability, so legacy learned
 * words still join the due queue in a sensible order.
 */
export function wordOverdueness(schedule, lastAttemptAt, now = Date.now()) {
  const entries = schedule ? Object.values(schedule) : []
  if (entries.length === 0) {
    return Math.max(0, now - (lastAttemptAt ?? 0)) / DEFAULT_STABILITY_MS
  }
  let worst = 0
  for (const sch of entries) worst = Math.max(worst, overdueness(sch, now))
  return worst
}

// ---------------------------------------------------------------------------
// Confirmation reviews — "batch done" is not yet "learned" (#313).
// ---------------------------------------------------------------------------

/** A review can only confirm a word this long after it reached `learned`. */
export const CONFIRM_GAP_MS = DAY_MS

/**
 * Judge whether an attempt on a learned-but-unconfirmed word settles its
 * confirmation review. A word completes its batch criteria within a session,
 * but that only proves working memory; it graduates to confirmed once a
 * spaced review — at least {@link CONFIRM_GAP_MS} after it reached `learned` —
 * lands correct. Callers should only consult this while the word's state is
 * still `learned` or better (a word that slipped is handled by the lost-word
 * plumbing instead).
 * @param {{learnedAt?: number|null, confirmedAt?: number|null}} rec
 * @param {{correct: boolean, ts?: number}} attempt
 * @returns {'confirmed'|'failed'|null} null when this attempt is not a
 *   confirmation review (already confirmed, never learned, or too soon).
 */
export function confirmationOutcome({ learnedAt = null, confirmedAt = null } = {}, { correct, ts = Date.now() } = {}) {
  if (learnedAt == null || confirmedAt != null) return null
  if (ts - learnedAt < CONFIRM_GAP_MS) return null
  return correct ? 'confirmed' : 'failed'
}
