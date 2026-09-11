// Batches: assembling, committing, measuring and retiring the current learning
// and mastery batches.
//
// Depends on `records.js` (for `stateOf` and the pending-confirmation rule) and
// on nothing else in this directory beyond `state.js`. Nothing here imports
// `activity.js`, which is what keeps that dependency one-directional (#667).
import * as idb from '../../lib/idb.js'
import { toPlain } from '../../lib/plain.js'
import { buildBatchOptions } from '../../lib/batches.js'
import { minExercisesToLevel } from '../../lib/progression.js'

import { curriculumParts, partOfWord } from '../vocab.js'

import { state, BATCH_META_KEY, wordRecord, rank, events, vocabWords } from './state.js'
import { stateOf, isPendingConfirmation } from './records.js'

/**
 * Curriculum order for the batch engine: a word's position is the position of
 * the part that teaches it (#674), so a learner is offered "A2 Part I" words
 * until that part is done rather than the whole of A2 at once.
 *
 * Null when the parts have not loaded — a cache written before they shipped, or
 * a first launch mid-sync. The engine then falls back to its own CEFR ordering
 * wholesale, which is the behaviour that predates parts. Falling back *per word*
 * would be worse than either: mixing part indices with CEFR ranks would order
 * the pool by two incomparable scales at once.
 */
function partRank() {
  const parts = curriculumParts.value
  if (!parts.length) return undefined
  const order = new Map(parts.map((p, i) => [p.id, i]))
  const of = partOfWord.value
  // A word no part claims sorts last rather than first: `check:parts` fails the
  // build on an orphan, so one here means a stale cache, and the safe reading of
  // "the curriculum doesn't mention this word" is "not yet", not "teach it now".
  return (w) => order.get(of.get(w.key)) ?? parts.length
}

/**
 * Offer up to five batch options for the next learning or mastery journey.
 * @param {'learning'|'mastery'} [level]
 * @param {() => number} [rng]
 * @returns {object[]}
 */
export function getBatchOptions(level = 'learning', rng = Math.random) {
  // Mastery builds on confirmed memory: a word still pending its spaced
  // confirmation review (#313) is not yet eligible to enter a mastery batch.
  const words =
    level === 'mastery' ? vocabWords().filter((w) => !isPendingConfirmation(w.key)) : vocabWords()
  return buildBatchOptions({
    words,
    stateOf: (w) => stateOf(w.key),
    level,
    rng,
    rankOf: partRank(),
  })
}

/**
 * Randomly pick one of the available mastery batch options and commit it.
 * Returns the committed option, or null if no full mastery batch can be formed
 * (fewer than MASTERY_BATCH_SIZE learned-but-unmastered words remain).
 */
export async function autoCommitMasteryBatch(rng = Math.random) {
  const options = getBatchOptions('mastery', rng)
  if (options.length === 0) return null
  const pick = options[Math.floor(rng() * options.length)]
  await commitBatch(pick)
  return pick
}

/**
 * Ensure a mastery batch is active and being worked on, assembling a fresh one
 * as soon as enough words are learned — without waiting for the previous batch's
 * completion to be celebrated. If the active batch is already complete (every
 * word mastered) it is cleared first so a new one can take its place.
 * @returns {Promise<object|null>} the newly committed batch, or null if none was
 *   committed (one is still in progress, or too few words are ready to master).
 */
export async function ensureMasteryBatch(rng = Math.random) {
  if (state.mastery && !batchComplete('mastery')) return null
  if (state.mastery) await advanceBatch('mastery')
  return autoCommitMasteryBatch(rng)
}

/** Commit a chosen batch as the current batch for its level; persist it. */
export async function commitBatch(option) {
  if (!option) return
  // Detach before adopting: the option may arrive as a reactive proxy owned by
  // whoever built it, and the current batch must not alias their state.
  const plainOption = toPlain(option)
  state[plainOption.level] = plainOption
  await idb.setMeta(BATCH_META_KEY(plainOption.level), plainOption)
}

/** Target state a word must reach for a batch of the given level to count it. */
function batchTarget(level) {
  return level === 'mastery' ? 'mastered' : 'learned'
}

/** Per-word state for the words in a level's current batch. */
export function batchProgress(level) {
  const batch = state[level]
  if (!batch) return []
  const target = rank(batchTarget(level))
  return batch.words.map((key) => ({ word: key, state: stateOf(key), done: rank(stateOf(key)) >= target }))
}

/**
 * Exercise-based completion of a level's current batch. Measures the minimum
 * number of correct exercises still needed to finish the batch (`remaining`)
 * against the number a brand-new batch of the same words would have needed
 * (`fresh`), so a smooth bar can fill from 0 (just committed) to 1 (complete)
 * as each dimension is chipped away — finer-grained than the words-done count.
 * @returns {{remaining: number, fresh: number, done: number, fraction: number}}
 */
export function batchExerciseProgress(level) {
  const batch = state[level]
  if (!batch || batch.words.length === 0) return { remaining: 0, fresh: 0, done: 0, fraction: 1 }
  let remaining = 0
  let fresh = 0
  for (const key of batch.words) {
    const word = wordRecord(key)
    remaining += minExercisesToLevel(events(key), level, word)
    fresh += minExercisesToLevel([], level, word)
  }
  const done = Math.max(0, fresh - remaining)
  return { remaining, fresh, done, fraction: fresh ? done / fresh : 1 }
}

/** Is every word in a level's current batch at (or above) its target state? */
export function batchComplete(level) {
  const batch = state[level]
  if (!batch || batch.words.length === 0) return false
  const target = rank(batchTarget(level))
  return batch.words.every((key) => rank(stateOf(key)) >= target)
}

/** Clear the current batch so the UI can offer a fresh set of options. */
export async function advanceBatch(level) {
  state[level] = null
  await idb.setMeta(BATCH_META_KEY(level), null)
}

/** Delete a word's entire progress record (reactive state + IndexedDB). */
export async function deleteRecord(key) {
  if (state.records[key]) delete state.records[key]
  await idb.deleteProgress(key)
}

/**
 * Remove one word from a level's committed batch, persisting the change. If the
 * batch would be left empty it is cleared entirely so the UI offers a fresh set
 * of options. No-op when the level has no batch or the word isn't in it.
 */
export async function removeFromBatch(level, key) {
  const batch = state[level]
  if (!batch || !batch.words.includes(key)) return
  const words = batch.words.filter((w) => w !== key)
  if (words.length === 0) {
    await advanceBatch(level)
    return
  }
  const updated = toPlain(batch)
  updated.words = words
  updated.size = words.length
  await commitBatch(updated)
}

/**
 * "Leave for later": pop a word out of whichever current batch holds it so the
 * learner can set it aside (e.g. it's being learned elsewhere and shouldn't be
 * driven by the app). By default all recorded progress for the word is discarded
 * too, keeping the app's picture of what's known in sync with outside study;
 * pass `{ keepProgress: true }` to only detach it from the batch.
 */
export async function leaveForLater(key, { keepProgress = false } = {}) {
  await removeFromBatch('learning', key)
  await removeFromBatch('mastery', key)
  if (!keepProgress) await deleteRecord(key)
}
