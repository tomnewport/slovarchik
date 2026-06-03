// Pure, framework-free quiz helpers. Kept side-effect free so they are easy to
// unit test and reuse across the vocab and declension drills.

import { normalize } from './text.js'

export { normalize }

/**
 * Check a free-text answer against one or more accepted answers.
 * @param {string} input
 * @param {string|string[]} accepted
 * @returns {boolean}
 */
export function checkAnswer(input, accepted) {
  const wanted = Array.isArray(accepted) ? accepted : [accepted]
  const got = normalize(input)
  return wanted.some((a) => normalize(a) === got && got.length > 0)
}

/**
 * Fisher–Yates shuffle. Returns a new array and never mutates the input.
 * `rng` is injectable so tests can be deterministic.
 * @template T
 * @param {T[]} items
 * @param {() => number} [rng]
 * @returns {T[]}
 */
export function shuffle(items, rng = Math.random) {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Pick up to `n` distinct items at random.
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @param {() => number} [rng]
 * @returns {T[]}
 */
export function sample(items, n, rng = Math.random) {
  return shuffle(items, rng).slice(0, Math.max(0, n))
}

/**
 * Build a multiple-choice question: the correct option plus distractors drawn
 * from `pool`, shuffled together.
 * @template T
 * @param {T} correct
 * @param {T[]} pool        candidates for distractors (may include `correct`)
 * @param {number} choices  total number of options desired
 * @param {(item: T) => string} keyOf  identity function to avoid dup/self
 * @param {() => number} [rng]
 * @returns {T[]}
 */
export function buildChoices(correct, pool, choices, keyOf, rng = Math.random) {
  const correctKey = keyOf(correct)
  const distractors = sample(
    pool.filter((item) => keyOf(item) !== correctKey),
    Math.max(0, choices - 1),
    rng,
  )
  return shuffle([correct, ...distractors], rng)
}

