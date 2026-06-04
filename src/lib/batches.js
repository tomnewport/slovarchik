// Batch selection engine. Given the learner's per-word states, it offers a
// short menu of named word batches to learn or master next, following the
// process in #79:
//
//   1. Find eligible words (unlearned for a learning batch; learned-but-
//      unmastered for a mastery batch).
//   2. Refine to the lowest CEFR level present; if too few remain, top up with
//      random words from the next level(s) up.
//   3. Build candidate batches keyed on collection names. A batch may borrow up
//      to 25% of its words from other collections; if it cannot keep 75% from a
//      single collection it is named "Random".
//   4. Offer up to five options, prioritising non-random (named) batches.
//
// Pure and framework-free: no Vue, no I/O. Randomness is injectable for tests.

import { shuffle, sample } from './quiz.js'

/** CEFR levels from easiest to hardest. */
export const CEFR_ORDER = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1'])

export const LEARNING_BATCH_SIZE = 20
export const MASTERY_BATCH_SIZE = 10
/** Mastery batches only unlock once the learner has learned this many words. */
export const MASTERY_UNLOCK_AT = 100
/** How many batch options to offer. */
export const BATCH_OPTIONS = 5
/** A named batch must draw at least this fraction from one collection. */
export const SAME_COLLECTION_RATIO = 0.75

/**
 * Parts of speech treated as "glue" words — pronouns, conjunctions,
 * prepositions and interjections. A few of these are always mixed into
 * learning batches so the learner picks them up naturally alongside the
 * main vocabulary.
 */
export const GLUE_POS = Object.freeze(['pronoun', 'conjunction', 'preposition', 'interjection'])

/** How many glue words to append to each learning batch option. */
export const GLUE_PER_BATCH = 3

/** Batch accent colours: learning is green, mastery is gold. */
export const BATCH_COLORS = Object.freeze({ learning: 'green', mastery: 'gold' })

/** Numeric rank of a CEFR level; unknown levels sort to the end. */
export function cefrRank(cefr) {
  const i = CEFR_ORDER.indexOf(cefr)
  return i === -1 ? CEFR_ORDER.length : i
}

/** Is a word in `state` eligible for a batch at `level`? */
export function isEligible(state, level) {
  if (level === 'mastery') return state === 'learned'
  return state === 'unknown' || state === 'learning'
}

/** Target batch size for a level. */
export function batchSize(level) {
  return level === 'mastery' ? MASTERY_BATCH_SIZE : LEARNING_BATCH_SIZE
}

/**
 * Refine eligible words to the lowest CEFR level present, topping up with
 * random words from successively higher levels until at least `size` are
 * available (or the words run out).
 */
export function refineToLowest(words, size, rng = Math.random) {
  if (words.length === 0) return []
  const byRank = new Map()
  for (const w of words) {
    const r = cefrRank(w.cefr)
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r).push(w)
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const pool = []
  for (const r of ranks) {
    if (pool.length >= size) break
    // The lowest level enters whole; higher levels are sampled to top up.
    if (pool.length === 0) pool.push(...byRank.get(r))
    else pool.push(...sample(byRank.get(r), size - pool.length, rng))
  }
  return pool
}

/** Count words per collection within a pool. */
function collectionCounts(pool) {
  const counts = new Map()
  for (const w of pool) {
    for (const c of w.collections ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return counts
}

/**
 * Assemble a single named batch around a collection: take as many of that
 * collection's words as fit, then borrow up to `otherMax` from elsewhere.
 */
function namedBatch(pool, collection, size, otherMax, level, rng) {
  const inC = shuffle(
    pool.filter((w) => (w.collections ?? []).includes(collection)),
    rng,
  )
  const same = inC.slice(0, size)
  const fillNeeded = Math.max(0, size - same.length)
  const others = shuffle(
    pool.filter((w) => !(w.collections ?? []).includes(collection)),
    rng,
  ).slice(0, Math.min(fillNeeded, otherMax))
  return makeOption(collection, [...same, ...others], level)
}

/** A random fallback batch drawn from the whole pool. */
function randomBatch(pool, size, level, rng) {
  return makeOption(null, sample(pool, size, rng), level)
}

function makeOption(collection, words, level) {
  return {
    name: collection ?? 'Random',
    collection,
    level,
    color: BATCH_COLORS[level],
    words: words.map((w) => w.key),
    size: words.length,
  }
}

/** Append a sample of glue words to a batch option. */
function addGlue(option, refinedGlue, rng) {
  if (!refinedGlue.length) return option
  const picked = sample(refinedGlue, GLUE_PER_BATCH, rng)
  return {
    ...option,
    words: [...option.words, ...picked.map((w) => w.key)],
    size: option.size + picked.length,
  }
}

/** A stable signature for a batch's word set, used to drop duplicate options. */
function signature(option) {
  return option.words.slice().sort().join('|')
}

/**
 * Turn a refined pool into up to {@link BATCH_OPTIONS} batch options,
 * prioritising named (non-random) batches, then padding with random batches.
 */
export function assembleOptions(pool, size, level, rng = Math.random) {
  if (pool.length === 0) return []
  const otherMax = Math.floor(size * (1 - SAME_COLLECTION_RATIO))
  const sameMin = size - otherMax

  // Collections strong enough to anchor a 75%-same batch, strongest first.
  const counts = collectionCounts(pool)
  const candidates = [...counts.entries()]
    .filter(([, n]) => n >= Math.min(sameMin, pool.length))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)

  const options = []
  const seen = new Set()
  const add = (option) => {
    if (option.size === 0) return
    const sig = signature(option)
    if (seen.has(sig)) return
    seen.add(sig)
    options.push(option)
  }

  for (const collection of candidates) {
    if (options.length >= BATCH_OPTIONS) break
    add(namedBatch(pool, collection, size, otherMax, level, rng))
  }
  // Pad with random batches. Bail out if they stop adding anything new (the
  // pool is too small to produce distinct sets).
  let guard = 0
  while (options.length < BATCH_OPTIONS && guard < BATCH_OPTIONS * 4) {
    const before = options.length
    add(randomBatch(pool, size, level, rng))
    if (options.length === before) guard++
  }
  return options
}

/**
 * Offer batch options for the next learning or mastery journey.
 * @param {object} args
 * @param {object[]} args.words normalised word records (need `key`, `cefr`,
 *   `collections`)
 * @param {(word: object) => string} args.stateOf current state per word
 * @param {'learning'|'mastery'} [args.level]
 * @param {number} [args.learnedCount] total learned words (gates mastery)
 * @param {() => number} [args.rng]
 * @returns {object[]} up to five batch options
 */
export function buildBatchOptions({
  words = [],
  stateOf = () => 'unknown',
  level = 'learning',
  learnedCount = 0,
  rng = Math.random,
} = {}) {
  if (level === 'mastery' && learnedCount < MASTERY_UNLOCK_AT) return []
  const size = batchSize(level)
  const eligible = words.filter((w) => isEligible(stateOf(w), level))

  // For learning batches only: separate glue words (pronouns, conjunctions,
  // prepositions, interjections) from main vocabulary so they are always mixed
  // into every batch option regardless of which collection anchors it.
  let mainEligible = eligible
  let refinedGlue = []
  if (level === 'learning') {
    const isGlue = (w) => GLUE_POS.includes(w.pos)
    const glueEligible = eligible.filter(isGlue)
    mainEligible = eligible.filter((w) => !isGlue(w))
    if (glueEligible.length) refinedGlue = refineToLowest(glueEligible, GLUE_PER_BATCH, rng)
  }

  if (mainEligible.length === 0) return []
  const pool = refineToLowest(mainEligible, size, rng)
  const options = assembleOptions(pool, size, level, rng)
  return options.map((opt) => addGlue(opt, refinedGlue, rng))
}
