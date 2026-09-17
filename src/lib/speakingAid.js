// What a speaking exercise hands the learner, and what each rung of help costs.
//
// The spoken drill prompts with the English and asks for the Russian aloud, so
// the learner is producing a whole sentence from nothing. Three rungs of help
// stand behind that prompt, and only the last one costs anything:
//
//   0  dictionary  eligible non-target words of the sentence, as headword +
//                  gloss, in alphabetical order. The caller shows it only on
//                  a phrase's first encounter. It
//                  gives away vocabulary the drill is not grading, and the
//                  alphabetical order is deliberate: it says which words are in
//                  the sentence without saying where they go.
//   1  order       the same words arranged into the sentence, in their real
//                  inflected forms, with the target word blanked. Free.
//   2  reveal      the blank filled in. NOT free: the learner has been told the
//                  answer, so the exercise is no longer flawless and the word
//                  can't be fast-tracked on the strength of it (#725).
//
// "Free" means exactly one thing — `flawless` stays true — because that is the
// signal the quick-progression offer reads. A free rung still leaves an
// ordinary correct attempt on the record.
//
// A single word has nothing to put in order, so its ladder is the reveal alone.
//
// Pure and framework-free: the caller supplies tokens already aligned
// (lib/phraseAlign.js's `alignedHintTokens`, wired up in stores/hints.js).

import { normToken } from './phraseHint.js'

/** The rungs, in the order they are climbed. */
export const HINT_ORDER = 1
export const HINT_REVEAL = 2

/**
 * Is the exercise still flawless having climbed to this rung? Only the reveal
 * spends it — see the module comment for why the others are free.
 * @param {number} rung
 * @returns {boolean}
 */
export function rungIsFree(rung) {
  return (rung ?? 0) < HINT_REVEAL
}

/**
 * The rungs this exercise actually offers, lowest first. A prompt with nothing
 * to arrange (a single word, or a sentence whose target token we couldn't find)
 * skips straight to the reveal rather than offering a rung that would show the
 * learner the answer a step early.
 * @param {{hasSkeleton?: boolean}} about
 * @returns {number[]}
 */
export function hintLadder({ hasSkeleton = false } = {}) {
  return hasSkeleton ? [HINT_ORDER, HINT_REVEAL] : [HINT_REVEAL]
}

/**
 * Is this token part of what the exercise is assessing?
 *
 * Two independent answers, and either is enough. `targetTokens` are the
 * surface forms the builder resolved from the word's own paradigm (the same
 * list phrase spelling uses to spare a word from collateral damage); alignment
 * is what the token turned out to be once the sentence was read. They usually
 * agree, and where they don't, blanking one token too many costs the learner
 * nothing but a harder blank — whereas leaving the target on show would hand
 * over the answer for free.
 */
function isTarget(token, targets, targetForms) {
  if (targetForms.has(normToken(token.text))) return true
  const a = token.alignment
  if (!a) return false
  if (targets.has(a.key)) return true
  return (a.credit ?? []).some((k) => targets.has(k))
}

/**
 * The dictionary panel: one entry per non-target word of the sentence, as
 * headword and gloss, sorted alphabetically in Russian.
 *
 * Deduplicated by dictionary entry rather than by surface form, so a word the
 * sentence uses twice is listed once. Tokens no entry was found for (a name, a
 * word outside the dictionary) are dropped: there is nothing to define, and
 * listing the bare surface form would leak the sentence's own wording.
 *
 * @param {Array<{text: string, hint: PlainObject|null, alignment: PlainObject|null}>} tokens
 *   aligned hint tokens for the sentence (lib/phraseAlign.js's `alignedHintTokens`)
 * @param {{targets?: string[], targetTokens?: string[]}} [about]  the word(s)
 *   being assessed, by key and (where known) by surface form
 * @returns {Array<{key: string, ru: string, en: string}>}
 */
export function speakingDictionary(tokens, { targets = [], targetTokens = [] } = {}) {
  const targetKeys = new Set(targets.filter(Boolean))
  const targetForms = new Set(targetTokens.map(normToken).filter(Boolean))
  const byKey = new Map()
  for (const token of tokens ?? []) {
    const hint = token?.hint
    if (!hint?.en || isTarget(token, targetKeys, targetForms)) continue
    const key = hint.key ?? hint.ru
    if (!byKey.has(key)) byKey.set(key, { key, ru: hint.ru, en: hint.en })
  }
  return [...byKey.values()].sort((a, b) => String(a.ru).localeCompare(String(b.ru), 'ru'))
}

/**
 * Replace the letters of a token with a blank, keeping whatever punctuation sat
 * around them — «а́тлас.» becomes «___.», which says a sentence ends there
 * without saying what ends it. Combining marks go with the letters so a stress
 * mark can't survive on its own.
 * @param {string} text
 * @returns {string}
 */
export function blankToken(text) {
  return String(text ?? '').replace(/[\p{L}\p{M}]+/gu, '___')
}

/**
 * The sentence with its target word blanked out — rung 1.
 *
 * Every other token keeps its real inflected form, which is the point: the
 * dictionary gives headwords, and this rung is what the sentence does to them.
 *
 * @param {Array<{text: string, alignment: PlainObject|null}>} tokens
 * @param {{targets?: string[], targetTokens?: string[]}} [about]
 * @returns {Array<{text: string, blank: boolean}>}  one entry per token
 */
export function speakingSkeleton(tokens, { targets = [], targetTokens = [] } = {}) {
  const targetKeys = new Set(targets.filter(Boolean))
  const targetForms = new Set(targetTokens.map(normToken).filter(Boolean))
  return (tokens ?? []).map((token) => {
    const blank = isTarget(token, targetKeys, targetForms)
    return { text: blank ? blankToken(token.text) : token.text, blank }
  })
}

/**
 * Both aids at once, plus whether the order rung is worth offering.
 *
 * A skeleton with no blank in it *is* the answer, so it is withheld rather than
 * shown: that happens when nothing in the sentence could be tied to the word
 * being assessed, and a sentence we can't blank is one we can't half-tell.
 *
 * @param {Array<{text: string, hint: PlainObject|null, alignment: PlainObject|null}>} tokens
 * @param {{targets?: string[], targetTokens?: string[]}} [about]
 * @returns {{dictionary: Array<PlainObject>, skeleton: Array<PlainObject>, hasSkeleton: boolean}}
 */
export function buildSpeakingAid(tokens, about = {}) {
  const dictionary = speakingDictionary(tokens, about)
  const skeleton = speakingSkeleton(tokens, about)
  const hasSkeleton = skeleton.length > 1 && skeleton.some((t) => t.blank)
  return { dictionary, skeleton, hasSkeleton }
}
