// Session builder + run-time helpers. A session is assembled from practices
// following the construction algorithm in #79:
//
//   1. Filter practices by the requested session type.
//   2. 25% of practices target at-risk / lost words.
//   3. 25% target words not tested for a long time.
//   4. 50% target the current learning / mastery batch.
//   5. Choose each practice's type at random, weighted to the weakest dimension.
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

/** Resolve the practice count for a session type (+ size key for standard). */
export function sessionSize(type, sizeKey) {
  const spec = SESSION_TYPES[type]
  if (!spec) return 0
  if (spec.sizes) return spec.sizes[sizeKey] ?? spec.sizes[spec.default]
  return spec.size
}

/**
 * Split a session of `size` practices into the 25 / 25 / 50 buckets. The
 * current-batch bucket absorbs the rounding remainder so the counts always sum
 * to `size`.
 * @returns {{atRisk: number, untested: number, current: number}}
 */
export function allocateBuckets(size) {
  const atRisk = Math.round(size * BUCKET_SHARES.atRisk)
  const untested = Math.round(size * BUCKET_SHARES.untested)
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
 *   higher means weaker, so that dimension is favoured. Defaults to equal.
 * @param {() => number} [args.rng]
 * @returns {{type, size, buckets, practices: object[]}}
 */
export function buildSession({ type = 'standard', size: sizeKey, weakness = {}, rng = Math.random } = {}) {
  const eligible = practicesForSession(type)
  const size = sessionSize(type, sizeKey)
  const counts = allocateBuckets(size)
  const slots = shuffle(bucketSlots(counts), rng)

  const practices = slots.map((bucket) => {
    const pt = weightedPick(eligible, (p) => weakness[p.dimension] ?? 1, rng)
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
