// Type-ahead options for the flashcard drill (#473).
//
// The flashcard input doubles as an autocomplete: as the learner types the
// English, a short list of candidate words appears and refines as the guess
// gets closer, so a known word can be tapped instead of typed in full — and so
// near-identical glosses (a *winter* hat vs a *brimmed* hat) can be told apart
// by picking the exact form.
//
// The list narrows by how correct the typed guess already is. Correctness is a
// simple positional letter overlap against the card's answer (both stripped of
// any bracketed qualifier). The closer the guess, the fewer random decoys are
// mixed in — so the real matches (and the answer) surface — and the stricter
// the match becomes (prefix once the guess is perfect, substring otherwise):
//
//   100% correct → no decoys, prefix-matched words
//    90% correct → 5 decoys,  substring-matched words
//    80% correct → 50 decoys, substring-matched words
//   ≤70% correct → 500 decoys, substring-matched words
//
// Up to 8 words are shown, drawn at random from the matches + decoys, so the
// answer is more and more likely to appear as the guess improves but is never
// guaranteed to be there.
//
// Pure and framework-free; randomness is injectable for tests.

import { sample } from './quiz.js'

/** Most options shown on screen at once. */
export const MAX_OPTIONS = 8

/**
 * Correctness tiers, most-correct first. Each names how many random decoys to
 * mix in and whether a candidate must prefix- or substring-match the guess.
 * `min` is the inclusive lower bound on the guess's correctness fraction.
 */
export const OPTION_TIERS = Object.freeze([
  { min: 1, decoys: 0, match: 'prefix' },
  { min: 0.9, decoys: 5, match: 'substring' },
  { min: 0.8, decoys: 50, match: 'substring' },
  { min: 0, decoys: 500, match: 'substring' },
])

/**
 * Strip a bracketed qualifier — "(winter)", "[pl]", "{formal}" — and collapse
 * whitespace, so "hat (winter)" and "hat" compare equal. Lower-casing is left to
 * the caller. Returns the trimmed remainder.
 * @param {string} text
 * @returns {string}
 */
export function stripBrackets(text) {
  return String(text ?? '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fraction of the answer the typed guess has right, 0..1. Both sides are
 * bracket-stripped and lower-cased; each position of the answer scores only when
 * the guess has the same character there, so wrong letters and letters not yet
 * typed (an unfinished guess) both count against. An empty answer yields 0.
 * @param {string} typed
 * @param {string} answer
 * @returns {number}
 */
export function guessCorrectness(typed, answer) {
  const target = stripBrackets(answer).toLowerCase()
  const guess = stripBrackets(typed).toLowerCase()
  if (!target) return 0
  let correct = 0
  for (let i = 0; i < target.length; i++) {
    if (guess[i] === target[i]) correct++
  }
  return correct / target.length
}

/** The tier for a given correctness fraction. */
export function tierFor(correctness) {
  return OPTION_TIERS.find((t) => correctness >= t.min) ?? OPTION_TIERS[OPTION_TIERS.length - 1]
}

/**
 * Build the option list for the current guess.
 *
 * @param {object} args
 * @param {string} args.typed   the learner's current input
 * @param {string} args.answer  the card's correct English (for the correctness tier)
 * @param {Array<object>} args.pool  candidate options ({ key, en, label, … })
 * @param {number} [args.max]    most options to show (default {@link MAX_OPTIONS})
 * @param {(o: object) => string} [args.keyOf]   identity, for de-duplication
 * @param {(o: object) => string} [args.textOf]  the text a guess matches against
 * @param {() => number} [args.rng]
 * @returns {Array<object>} up to `max` options, shuffled. Empty when nothing is typed.
 */
export function buildOptions({
  typed,
  answer,
  pool = [],
  max = MAX_OPTIONS,
  keyOf = (o) => o.key,
  textOf = (o) => o.en,
  rng = Math.random,
} = {}) {
  const guess = stripBrackets(typed).toLowerCase()
  // Nothing typed yet: no autocomplete to offer (an empty guess substring-matches
  // the whole dictionary, which would just be noise).
  if (!guess) return []

  const tier = tierFor(guessCorrectness(typed, answer))
  const matches = []
  const others = []
  for (const o of pool) {
    const text = stripBrackets(textOf(o)).toLowerCase()
    if (!text) continue
    const hit = tier.match === 'prefix' ? text.startsWith(guess) : text.includes(guess)
    ;(hit ? matches : others).push(o)
  }

  const decoys = sample(others, tier.decoys, rng)
  // De-duplicate by key, keeping matches ahead of decoys, then draw the shown
  // set at random — so the answer surfaces more as the decoy count shrinks.
  const seen = new Set()
  const combined = []
  for (const o of [...matches, ...decoys]) {
    const k = keyOf(o)
    if (seen.has(k)) continue
    seen.add(k)
    combined.push(o)
  }
  return sample(combined, max, rng)
}
