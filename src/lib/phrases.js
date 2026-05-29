// Pure, framework-free helpers for the phrase drill. The "phrase bank" is the
// set of usage examples every word carries; these helpers turn a target phrase
// into the pieces each level needs — word tokens for the build-the-sentence
// game and a letter-by-letter sequence for the guided keyboard — and grade
// answers leniently, forgiving punctuation, case, stress and the usual ё/е slip.
import { stripStress } from './text.js'
import { sample, shuffle } from './quiz.js'

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

/**
 * Display tokens for the listening word bank: each word lowercased with
 * surrounding punctuation and stress marks removed (internal apostrophes in
 * contractions like "don't" are kept). Lowercasing everything keeps decoys
 * indistinguishable from the real words — there's no capital-letter tell for
 * the first word of the phrase.
 * @param {string} phrase
 * @returns {string[]}
 */
export function listeningTokens(phrase) {
  return phraseTokens(phrase)
    .map((w) =>
      stripStress(w)
        .toLowerCase()
        .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''),
    )
    .filter(Boolean)
}

/**
 * Flatten a set of phrases into a deduplicated pool of candidate decoy words,
 * taken from their English side and cleaned like {@link listeningTokens}.
 * @param {Array<{en: string}>} phrases
 * @returns {string[]}
 */
export function listeningWordPool(phrases) {
  const out = new Set()
  for (const p of phrases ?? []) {
    for (const w of listeningTokens(p?.en ?? '')) out.add(w)
  }
  return [...out]
}

/**
 * Build a shuffled word bank for the listening drill: every word of the target
 * English phrase plus up to `decoyCount` random decoys drawn from `pool`
 * (skipping any word that already appears in the phrase, so there's never an
 * ambiguous extra copy). Each tile carries a stable `id` so repeated words stay
 * distinct, and a `decoy` flag. `rng` is injectable for deterministic tests.
 * @param {string} target    the English phrase to rebuild
 * @param {string[]} pool    candidate decoy words
 * @param {number} [decoyCount]
 * @param {() => number} [rng]
 * @returns {Array<{id: number, text: string, decoy: boolean}>}
 */
export function buildListeningBank(target, pool, decoyCount = 3, rng = Math.random) {
  const words = listeningTokens(target)
  const have = new Set(words)
  const decoys = sample(
    (pool ?? []).filter((w) => !have.has(w)),
    Math.max(0, decoyCount),
    rng,
  )
  const tiles = [
    ...words.map((text) => ({ text, decoy: false })),
    ...decoys.map((text) => ({ text, decoy: true })),
  ].map((t, id) => ({ id, ...t }))
  return shuffle(tiles, rng)
}
