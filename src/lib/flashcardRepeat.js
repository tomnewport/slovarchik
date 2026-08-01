// Pure logic for the flashcard word-level repeat (#472/#473) and a couple of
// small session-summary helpers, extracted from SessionView.vue so the
// accumulate-misses / build-combined-boards decisions are unit-testable.
//
// Framework-free (no Vue, no store): the view owns the runner and the progress
// store; these functions take plain Maps/Sets and injected accessors and decide
// *which* words replay, *in which modality*, and *how* the top-up is ordered.

import { buildCombinedFlashcard } from './exerciseBuild.js'

// The two modalities a match board can drill, replayed in this order: reading
// (visual) misses before listening (audio) misses.
export const REPEAT_DIMENSIONS = ['identification', 'hearing']

/** Get (or create) the per-dimension key set in a flashcard accumulator map. */
export function dimSet(map, dim) {
  let s = map.get(dim)
  if (!s) map.set(dim, (s = new Set()))
  return s
}

/**
 * Fold one match board's per-word outcome into the accumulators. Missed words
 * join the per-dimension `wrong` set (and leave `correct`); a correctly-guessed
 * word joins `correct` as a top-up candidate — but only while it isn't already
 * a known miss this window, so a word missed on one board can't be re-added as a
 * top-up by a later correct guess before the repeat board is built.
 *
 * @param acc `{ wrong: Map, correct: Map }` — the accumulator maps (mutated)
 * @param dimension the board's dimension
 * @param targets the board's target keys
 * @param wrong a Set of the missed keys (or null when nothing was missed)
 */
export function collectMatchResult(acc, { dimension, targets, wrong }) {
  const wrongSet = dimSet(acc.wrong, dimension)
  const correctSet = dimSet(acc.correct, dimension)
  for (const key of (targets ?? []).filter(Boolean)) {
    if (wrong?.has(key)) {
      wrongSet.add(key)
      correctSet.delete(key)
    } else if (!wrongSet.has(key)) {
      correctSet.add(key)
    }
  }
}

/**
 * Build the combined flashcard-repeat boards for whatever misses have piled up:
 * one board per modality, each seeded with that modality's missed words and
 * topped up with the weakest correctly-guessed words. The `wrong` set for a
 * built board is cleared so its own misses re-seed the next window.
 *
 * @param acc `{ wrong: Map, correct: Map }` — the accumulator maps (wrong sets
 *   for built boards are cleared)
 * @param opts `{ vocabById, options, rankOf, repSeq }` where `rankOf(key)` maps
 *   a key to a comparable weakness rank (lower = weaker → topped up first) and
 *   `repSeq` is the next repeat-board sequence number
 * @returns `{ boards, repSeq }` — the built boards and the advanced sequence
 */
export function buildFlashcardRepeatBoards(acc, { vocabById, options = [], rankOf, repSeq = 0 } = {}) {
  const boards = []
  for (const dim of REPEAT_DIMENSIONS) {
    const wrongSet = acc.wrong.get(dim)
    if (!wrongSet || wrongSet.size === 0) continue
    const wrongKeys = [...wrongSet]
    // Weakest correctly-guessed words first (lower rank = weaker), for top-up.
    const correctSet = acc.correct.get(dim) ?? new Set()
    const topUpKeys = [...correctSet]
      .filter((k) => !wrongSet.has(k))
      .sort((a, b) => rankOf(a) - rankOf(b))
    // Reset the window before the board runs so its own misses re-seed the next.
    wrongSet.clear()
    const board = buildCombinedFlashcard({
      wrongKeys,
      topUpKeys,
      vocabById,
      options,
      dimension: dim,
      audio: dim === 'hearing',
      id: `fcrep${repSeq++}`,
    })
    if (board) boards.push(board)
  }
  return { boards, repSeq }
}

/**
 * Order phrases by their source word's priority (its index in `wordKeys`), so a
 * skipped modality draws replacement phrases for the highest-priority words
 * first. Phrases whose source isn't in the list sort to the back. Stable, and
 * non-mutating.
 */
export function orderPhrasesBySource(phrases, wordKeys) {
  const order = new Map(wordKeys.map((k, i) => [k, i]))
  return phrases
    .slice()
    .sort((a, b) => (order.get(a.source) ?? Infinity) - (order.get(b.source) ?? Infinity))
}

/** Human-readable session duration: "1m 5s" over a minute, else "42s". */
export function durationLabel(ms) {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}
