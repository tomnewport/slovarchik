// Session builder + run-time helpers. A session is assembled from practices
// following the construction algorithm in #79:
//
//   1. Filter practices by the requested session type.
//   2. When both learning and mastery practices are available, reserve a fixed
//      share of the session (MASTERY_SESSION_SHARE) for mastery so it is always
//      practised regardless of weakness weighting. The rest are learning slots.
//   3. Learning slots split 25% at-risk / 25% not-tested-recently / 50% current
//      batch; mastery slots all target the current mastery batch.
//   4. Choose each slot's practice type at random, weighted to the weakest
//      dimension.
//
// Plus two run-time helpers: a repeat-mistakes loop that re-queues wrong items
// until none remain, and an end-of-session summary.
//
// Pure and framework-free; randomness is injectable for tests.

import { shuffle } from './quiz.js'
import { DIMENSIONS } from './progression.js'
import { practicesForSession } from './practices.js'

/**
 * Session types and their sizes (number of practices). Standard offers three
 * sizes; the focused sessions are a fixed four practices each.
 */
export const SESSION_TYPES = Object.freeze({
  standard: { sizes: { quick: 4, normal: 12, super: 20 }, default: 'normal' },
  speaking: { size: 4 },
  listening: { size: 4 },
  words: { size: 4 },
  phrases: { size: 4 },
  grammar: { size: 4 },
})

/** The three word buckets and their share of a session. */
export const BUCKETS = Object.freeze(['atRisk', 'untested', 'current'])
export const BUCKET_SHARES = Object.freeze({ atRisk: 0.25, untested: 0.25, current: 0.5 })

/**
 * When both learning and mastery practices are on offer (i.e. there are words in
 * both batches), a third of the session's slots (at least one) are reserved for
 * mastery and the rest go to learning. Mastery work consolidates words already
 * learned, so it deserves a guaranteed share — a near-complete mastery batch
 * must keep moving — but it stays the minority: learning new words is the
 * session's main job, and an earlier even split made sessions feel dominated by
 * inflection-table drilling. When only one level is on offer that level takes
 * the whole session.
 */
export const MASTERY_SESSION_SHARE = 1 / 3

/** Resolve the practice count for a session type (+ size key for standard). */
export function sessionSize(type, sizeKey) {
  const spec = SESSION_TYPES[type]
  if (!spec) return 0
  if (spec.sizes) return spec.sizes[sizeKey] ?? spec.sizes[spec.default]
  return spec.size
}

/**
 * Split a session of `size` practices into the 25 / 25 / 50 buckets. The two
 * refresh buckets (at-risk / untested) round *down*, and the current-batch
 * bucket absorbs the whole remainder. This both keeps the counts summing to
 * `size` and guarantees the current batch is never rounded away to zero in a
 * short session: current always gets at least ⌈size/2⌉ slots, so a quick
 * learning portion of just one or two slots still spends them on the current
 * batch (where unlearned/slipped words live) rather than on retention.
 * @returns {{atRisk: number, untested: number, current: number}}
 */
export function allocateBuckets(size) {
  const atRisk = Math.floor(size * BUCKET_SHARES.atRisk)
  const untested = Math.floor(size * BUCKET_SHARES.untested)
  const current = Math.max(0, size - atRisk - untested)
  return { atRisk, untested, current }
}

/** Flatten a bucket-count map into one entry per practice slot. */
function bucketSlots(counts) {
  const slots = []
  for (const bucket of BUCKETS) {
    for (let i = 0; i < (counts[bucket] ?? 0); i++) slots.push(bucket)
  }
  return slots
}

/**
 * Resolve a per-practice weakness weight. `weakness` may be either:
 *  - a flat `{ dimension: weight }` map applied to every level, or
 *  - a per-level `{ learning: {...}, mastery: {...}, atRisk?: {...} }` map, so
 *    a level's slots are weighted only by that level's own needs.
 *
 * The per-level form is what keeps the two levels from stealing each other's
 * probability: e.g. boosting `identification` to fund mastery's word-bank drill
 * must not also pull `identification` into a learning slot (whose word may have
 * finished identification long ago). Dimensions and level/bucket names are
 * disjoint, so the presence of a `learning`/`mastery`/`atRisk` key unambiguously
 * marks the per-level shape.
 *
 * The optional `atRisk` map overrides the level map for slots in the at-risk
 * bucket: de-risking a word takes a correct answer in exactly the dimension
 * whose last attempt was wrong, so those slots are pointed at the dimensions
 * the at-risk words actually need rather than the level's general weakness.
 */
function weightResolver(weakness = {}) {
  const perLevel = 'learning' in weakness || 'mastery' in weakness || 'atRisk' in weakness
  return (level, dimension, bucket) => {
    const key = bucket === 'atRisk' && weakness.atRisk ? 'atRisk' : level
    const map = perLevel ? (weakness[key] ?? {}) : weakness
    return map[dimension] ?? 1
  }
}

/**
 * Pick one item by weight. Non-positive weights are floored to a tiny value so
 * every eligible practice keeps a chance of being chosen.
 */
function weightedPick(items, weightOf, rng) {
  const weights = items.map((it) => Math.max(1e-6, weightOf(it)))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Build a session.
 * @param {object} args
 * @param {string} [args.type] session type (see {@link SESSION_TYPES})
 * @param {string} [args.size] size key for a standard session (quick/normal/super)
 * @param {Partial<Record<string, number>>} [args.weakness] per-dimension weights;
 *   higher means weaker, so that dimension is favoured. Defaults to equal. May
 *   instead be a per-level map `{ learning: {...}, mastery: {...}, atRisk?: {...} }`
 *   so each level's slots are weighted only by that level's own needs, with an
 *   optional override for at-risk-bucket slots (see {@link weightResolver}).
 * @param {() => number} [args.rng]
 * @returns {{type, size, buckets, practices: object[]}}
 */
export function buildSession({ type = 'standard', size: sizeKey, weakness = {}, rng = Math.random, levels = null } = {}) {
  const all = practicesForSession(type)
  const eligible = levels ? all.filter((p) => levels.includes(p.level)) : all
  const size = sessionSize(type, sizeKey)

  const masteryPractices = eligible.filter((p) => p.level === 'mastery')
  const learningPractices = eligible.filter((p) => p.level === 'learning')

  // Reserve a guaranteed share of the session for mastery whenever both levels
  // are available. When only one level is on offer (a grammar session is all
  // mastery; a speaking session has none) that level takes the whole session.
  let masterySize
  if (masteryPractices.length === 0) masterySize = 0
  else if (learningPractices.length === 0) masterySize = size
  else masterySize = Math.min(size, Math.max(1, Math.round(size * MASTERY_SESSION_SHARE)))
  const learningSize = size - masterySize

  // Learning slots keep the 25/25/50 at-risk/untested/current split. Mastery
  // slots all target the words actively being mastered (the current mastery
  // batch), so they use the current bucket — there is no refresh split for
  // mastery. Each slot remembers the practice set it must draw from.
  const counts = allocateBuckets(learningSize)
  const learningSlots = bucketSlots(counts).map((bucket) => ({ bucket, pool: learningPractices }))
  const masterySlots = Array.from({ length: masterySize }, () => ({ bucket: 'current', pool: masteryPractices }))
  const slots = shuffle([...learningSlots, ...masterySlots], rng)

  const weightFor = weightResolver(weakness)
  const practices = slots.map(({ bucket, pool }) => {
    const pt = weightedPick(pool, (p) => weightFor(p.level, p.dimension, bucket), rng)
    return {
      practiceType: pt.id,
      dimension: pt.dimension,
      level: pt.level,
      content: pt.content,
      exercises: pt.exercises,
      items: pt.items, // e.g. matching-board size; undefined for most types
      bucket,
    }
  })

  // Mastery identification (word-bank table) must come before mastery usage
  // (keyboard typing) so every word gets at least one easier identification
  // drill before being asked to type from memory (#220).
  practices.sort((a, b) => {
    if (a.level !== 'mastery' || b.level !== 'mastery') return 0
    const order = { identification: 0, usage: 1, context: 2 }
    return (order[a.dimension] ?? 0) - (order[b.dimension] ?? 0)
  })

  return { type, size, buckets: counts, practices }
}

/**
 * Default per-dimension weakness weights (all equal). Provided so callers have
 * a stable starting point to scale up the dimensions a learner struggles with.
 */
export function evenWeakness() {
  return Object.fromEntries(DIMENSIONS.map((d) => [d, 1]))
}

/**
 * Drive the repeat-mistakes loop to completion: run every queued item, re-queue
 * the ones answered wrong, and repeat until none remain (or `maxRounds` is hit).
 * `grade(item, round)` returns true when the item was answered correctly.
 * @returns {{rounds, attempts, remaining}}
 */
export function runRepeatMistakes(items, grade, { maxRounds = 1000 } = {}) {
  let queue = (items ?? []).slice()
  let rounds = 0
  let attempts = 0
  while (queue.length > 0 && rounds < maxRounds) {
    rounds++
    const wrong = []
    for (const item of queue) {
      attempts++
      if (!grade(item, rounds)) wrong.push(item)
    }
    queue = wrong
  }
  return { rounds, attempts, remaining: queue.length }
}

/**
 * End-of-session summary.
 * @param {Array<{correct?: boolean, word?: string, slipped?: boolean}>} results
 *   one entry per graded exercise (first attempts only)
 * @param {{startedAt?: number, finishedAt?: number}} [timing]
 */
export function summarize(results = [], { startedAt, finishedAt } = {}) {
  const total = results.length
  const correct = results.filter((r) => r.correct).length
  const percent = total ? Math.round((correct / total) * 100) : 0
  const durationMs = startedAt != null && finishedAt != null ? Math.max(0, finishedAt - startedAt) : null
  const slipped = [...new Set(results.filter((r) => r.slipped && r.word != null).map((r) => r.word))]
  return { total, correct, percent, durationMs, slipped }
}
