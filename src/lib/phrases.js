// Pure, framework-free helpers for the phrase drill. The "phrase bank" is the
// set of usage examples every word carries; these helpers turn a target phrase
// into the pieces each level needs — word tokens for the build-the-sentence
// game and a letter-by-letter sequence for the guided keyboard — and grade
// answers leniently, forgiving punctuation, case, stress and the usual ё/е slip.
import { stripStress } from './text.js'
import { shuffle } from './quiz.js'

/** Lowercase alphabets offered by the guided keyboards. */
export const RU_LETTERS = [...'абвгдежзийклмнопрстуфхцчшщъыьэюя']
export const EN_LETTERS = [...'abcdefghijklmnopqrstuvwxyz']

/** Split a phrase into whitespace-separated word tokens (punctuation kept). */
export function phraseTokens(phrase) {
  return String(phrase ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * The lowercase letter/space sequence a learner actually types: stress marks
 * removed, ё→е, punctuation dropped and whitespace collapsed. This is what the
 * guided keyboard walks through and what answers are compared against.
 * @param {string} phrase
 * @returns {string}
 */
export function typingSequence(phrase) {
  return stripStress(String(phrase ?? ''))
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Grade a phrase answer, ignoring punctuation, case, stress and ё/е.
 * @param {string} input
 * @param {string} target
 * @returns {boolean}
 */
export function phraseCorrect(input, target) {
  const wanted = typingSequence(target)
  return wanted.length > 0 && typingSequence(input) === wanted
}

/**
 * The next character the learner should type given what they have so far.
 * Returns '' once the phrase is complete; ' ' at a word boundary.
 * @param {string} target
 * @param {string} typed   what the learner has typed (lowercase letters/spaces)
 * @returns {string}
 */
export function nextChar(target, typed) {
  return typingSequence(target)[String(typed ?? '').length] ?? ''
}

/**
 * Keys to highlight on the guided keyboard: the correct next letter plus
 * `extra` random decoys drawn from `letters`. A space hint stands alone since
 * word boundaries are obvious. `rng` is injectable for deterministic tests.
 * @param {string} next
 * @param {string[]} letters
 * @param {number} [extra]
 * @param {() => number} [rng]
 * @returns {string[]}
 */
export function hintKeys(next, letters, extra = 2, rng = Math.random) {
  if (!next) return []
  if (next === ' ') return [' ']
  const decoys = shuffle(
    letters.filter((l) => l !== next),
    rng,
  ).slice(0, Math.max(0, extra))
  return shuffle([next, ...decoys], rng)
}
