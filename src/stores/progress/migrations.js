// Schema migrations for a stored or imported progress record (#667).
//
// Both `loadProgress` (reading the IndexedDB store) and `importData` (reading a
// backup file) have to bring an older record up to the current shape, and they
// used to do it with two copies of the same rules, 200 lines apart, each with
// its own copy of the reasoning in a comment. They had already begun to drift:
// the pre-scheduler grandfathering was spelled differently in each. Written
// once here, called from both.
//
// Nothing in this module touches reactive state — it takes a raw record and
// returns (or mutates) a plain one.
import { levelMet } from '../../lib/progression.js'

import { rank } from './state.js'

/**
 * Bring one stored/imported record up to the current shape, filling in every
 * field an older writer may have omitted.
 *
 * Version-independent: the fields below have only ever been *added*, so
 * defaulting them is correct for every version. The rules that do depend on
 * which version wrote the record are the two functions after this one, applied
 * by the caller — `loadProgress` has to apply the grandfathering *after* its
 * `learnedAt` backfill, and `importData` before anything else, so folding them
 * in here would change one of the two.
 *
 * @param {PlainObject} raw  a record as read from IndexedDB or a backup file
 * @returns {PlainObject} a new plain record in the current shape
 */
export function normaliseRecord(raw) {
  return {
    word: raw.word,
    events: Array.isArray(raw.events) ? raw.events : [],
    known: raw.known ?? false,
    learnedAt: raw.learnedAt ?? null,
    masteredAt: raw.masteredAt ?? null,
    peak: raw.peak ?? 0,
    confirmedAt: raw.confirmedAt ?? null,
    confirmFailedAt: raw.confirmFailedAt ?? null,
    schedule: raw.schedule ?? {},
    agg: raw.agg ?? { firstSeenAt: null, lastSeenAt: null, dims: {} },
    introducedAt: raw.introducedAt ?? null,
    tables: raw.tables ?? {},
  }
}

/**
 * Was this record written before the scheduler existed (#313)? Such records
 * carry no `schedule` field at all, which is the only marker they have.
 */
export function isPreScheduler(raw) {
  return raw.schedule === undefined
}

/**
 * Grandfather a pre-scheduler record's learned words as already confirmed: the
 * learner shouldn't wake up to every known word suddenly "pending" (#313).
 *
 * Call only for a record {@link isPreScheduler} identifies, and only once the
 * caller has settled `learnedAt` — `loadProgress` backfills it first, so the
 * grandfathering sees the backfilled value.
 * @returns {boolean} whether the record changed
 */
export function grandfatherConfirmed(rec) {
  if (rec.learnedAt == null || rec.confirmedAt != null) return false
  rec.confirmedAt = rec.learnedAt
  return true
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
export function recheckMasteredPeak(rec) {
  if ((rec.peak ?? 0) < rank('mastered')) return false
  if (levelMet(rec.events, 'mastery', { known: rec.known })) return false
  rec.peak = rank('learned')
  return true
}
