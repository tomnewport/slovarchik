// Pure, framework-free helpers for the phrase drill. The "phrase bank" is the
// set of usage examples every word carries; these helpers turn a target phrase
// into the pieces each level needs — word tokens for the build-the-sentence
// game and a letter-by-letter sequence for the guided keyboard — and grade
// answers leniently, forgiving punctuation, case, stress and the usual ё/е slip.
import { stripStress, foldYo } from './text.js'
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
 * removed, punctuation dropped and whitespace collapsed. ё is *preserved* so the
 * guided keyboard walks the learner through the real letter; the leniency that
 * treats ё/е as equal is applied separately at grading time (see foldYo).
 * @param {string} phrase
 * @returns {string}
 */
export function typingSequence(phrase) {
  return stripStress(String(phrase ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip standalone English articles ("a", "an", "the") from a normalised
 * sequence so that wrong or missing articles in English translations of Russian
 * phrases are never counted as errors (Russian has no articles).
 *
 * `seq` is expected to be the output of {@link typingSequence}: already
 * lowercased, stress-stripped and whitespace-collapsed — so the regex only
 * needs to handle clean lowercase ASCII/Cyrillic input.
 *
 * If the entire phrase collapses to an empty string (e.g. a target of just
 * "a"), the original sequence is returned so that a single-article phrase can
 * still be answered correctly.
 * @param {string} seq
 * @returns {string}
 */
function stripArticles(seq) {
  const stripped = seq.replace(/\b(a|an|the)\b\s*/g, '').replace(/\s+/g, ' ').trim()
  return stripped || seq
}

/**
 * Grade a phrase answer, ignoring punctuation, case, stress, ё/е and English
 * articles (since Russian has no articles, any choice of article is acceptable).
 * `target` may be a single string or a list of accepted renderings (a phrase
 * can have several valid English translations — see `en_alt` in the vocab); the
 * answer is correct if it matches any of them.
 * @param {string} input
 * @param {string|string[]} target
 * @returns {boolean}
 */
export function phraseCorrect(input, target) {
  const got = foldYo(stripArticles(typingSequence(input)))
  const targets = Array.isArray(target) ? target : [target]
  return targets.some((t) => {
    const wanted = foldYo(stripArticles(typingSequence(t)))
    return wanted.length > 0 && got === wanted
  })
}

/**
 * Split a normalised, article-stripped sequence into a word → count multiset.
 * @param {string} phrase
 * @returns {Map<string, number>}
 */
function wordBag(phrase) {
  const seq = foldYo(stripArticles(typingSequence(phrase)))
  const bag = new Map()
  for (const w of seq.split(' ').filter(Boolean)) bag.set(w, (bag.get(w) ?? 0) + 1)
  return bag
}

function sameBag(a, b) {
  if (a.size !== b.size) return false
  for (const [word, count] of a) {
    if (b.get(word) !== count) return false
  }
  return true
}

/**
 * Grade a word-bank "assemble" answer order-insensitively: correct if the
 * answer uses exactly the same multiset of words as the target (or one of its
 * alternates), regardless of order. English word order is far freer than
 * Russian, so when the learner is just placing a fixed bank of tiles — rather
 * than typing a phrase from scratch, where order is the skill being tested —
 * any valid reordering should be accepted rather than only the one curated
 * rendering (see `en_alt`/#267). Punctuation, case, stress, ё/е and articles
 * are folded exactly as in {@link phraseCorrect}.
 * @param {string} input
 * @param {string|string[]} target
 * @returns {boolean}
 */
export function phraseCorrectBagOfWords(input, target) {
  const got = wordBag(input)
  const targets = Array.isArray(target) ? target : [target]
  return targets.some((t) => {
    const wanted = wordBag(t)
    return wanted.size > 0 && sameBag(got, wanted)
  })
}

/**
 * Whether the word being assessed in a phrase-spelling exercise was itself
 * spelled correctly, regardless of mistakes elsewhere in the phrase.
 * `targetTokens` are the word's normalised surface form(s) as they appear in the
 * target phrase (see {@link wordTokensInPhrase}); the answer must contain each of
 * them at least as many times (so a word appearing twice must be right both
 * times). Stress, case and ё/е are folded exactly as in {@link phraseCorrect}.
 *
 * Returns `null` when there are no target tokens to check against, so the caller
 * can fall back to the whole-phrase grade rather than wrongly sparing the word.
 * @param {string} input             the learner's typed answer
 * @param {string[]} [targetTokens]  the assessed word's normalised forms
 * @returns {boolean|null}
 */
export function assessedWordCorrect(input, targetTokens) {
  if (!targetTokens?.length) return null
  const typed = foldYo(typingSequence(input)).split(' ').filter(Boolean)
  const have = new Map()
  for (const t of typed) have.set(t, (have.get(t) ?? 0) + 1)
  const need = new Map()
  for (const t of targetTokens) need.set(t, (need.get(t) ?? 0) + 1)
  for (const [t, n] of need) {
    if ((have.get(t) ?? 0) < n) return false
  }
  return true
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
 * `extra` random decoys. The space is just another key — it can be the correct
 * next key (a word boundary) or one of the decoys — so it joins `letters` in the
 * candidate pool and the spacebar lights up like any other hint. `rng` is
 * injectable for deterministic tests. Five decoys (six keys lit) keeps the hint
 * a nudge rather than a giveaway now that it's only offered on the second try.
 * @param {string} next
 * @param {string[]} letters
 * @param {number} [extra]
 * @param {() => number} [rng]
 * @returns {string[]}
 */
export function hintKeys(next, letters, extra = 5, rng = Math.random) {
  if (!next) return []
  const pool = [...letters, ' ']
  const decoys = shuffle(
    pool.filter((l) => l !== next),
    rng,
  ).slice(0, Math.max(0, extra))
  return shuffle([next, ...decoys], rng)
}

/** ё/е-folding, case-insensitive character equality — the same leniency the
 * grader applies, so a ё/е slip is never flagged as a spelling error. */
function sameLetter(a, b) {
  return foldYo(String(a).toLowerCase()) === foldYo(String(b).toLowerCase())
}

/**
 * Align a learner's typed attempt against the correct answer and mark where it
 * went wrong — without revealing the correct letters, so a second attempt is
 * still a spelling. Returns one cell per character of the *typed* attempt, plus
 * a gap cell for each letter the learner omitted:
 *
 *   { type: 'ok',    char }  — a character typed correctly
 *   { type: 'wrong', char }  — a wrong or extra character the learner typed
 *   { type: 'gap',   char: '' } — a letter is missing here
 *
 * The number of non-`ok` cells equals the Levenshtein distance between the two
 * strings (substitutions, insertions and deletions each cost 1). ё/е and case
 * are folded so neither counts as an error.
 * @param {string} typed
 * @param {string} answer
 * @returns {Array<{type: 'ok'|'wrong'|'gap', char: string}>}
 */
export function spellingDiff(typed, answer) {
  const a = [...String(typed ?? '')]
  const b = [...String(answer ?? '')]
  const m = a.length
  const n = b.length
  // Full edit-distance matrix so we can backtrace an optimal alignment.
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = sameLetter(a[i - 1], b[j - 1]) ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  const cells = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    const match = i > 0 && j > 0 && sameLetter(a[i - 1], b[j - 1])
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (match ? 0 : 1)) {
      cells.push({ type: match ? 'ok' : 'wrong', char: a[i - 1] })
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      // An extra character the learner typed that the answer doesn't have.
      cells.push({ type: 'wrong', char: a[i - 1] })
      i--
    } else {
      // A letter the answer has that the learner left out.
      cells.push({ type: 'gap', char: '' })
      j--
    }
  }
  cells.reverse()
  return cells
}

/** Number of single-character edits between the two strings (folding ё/е and
 * case), derived from the {@link spellingDiff} alignment. */
export function spellingDistance(typed, answer) {
  return spellingDiff(typed, answer).filter((c) => c.type !== 'ok').length
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
 * Build a shuffled word bank for the phrase-assembly (easy) drill: the real
 * tokens of `target` plus enough decoys drawn from `pool` phrases so the total
 * tile count is `factor` × the phrase length (default 2.5×). Decoys are taken
 * from any word that doesn't already appear in the target (case-insensitive).
 * Each tile has `{ id, text, decoy }`. `rng` is injectable for deterministic tests.
 * @param {string}   target  the phrase to assemble
 * @param {string[]} pool    other phrase strings to draw decoy words from
 * @param {number}   [factor]
 * @param {() => number} [rng]
 * @returns {Array<{id: number, text: string, decoy: boolean}>}
 */
export function buildAssemblyBank(target, pool, factor = 2.5, rng = Math.random) {
  const words = phraseTokens(target)
  const decoyCount = Math.round(words.length * (factor - 1))
  const have = new Set(words.map((w) => w.toLowerCase()))

  const seen = new Set()
  const candidates = []
  for (const phrase of pool ?? []) {
    for (const w of phraseTokens(phrase)) {
      const key = w.toLowerCase()
      if (!have.has(key) && !seen.has(key)) {
        seen.add(key)
        candidates.push(w)
      }
    }
  }

  const decoys = sample(candidates, Math.max(0, decoyCount), rng)
  const tiles = [
    ...words.map((text) => ({ text, decoy: false })),
    ...decoys.map((text) => ({ text, decoy: true })),
  ].map((t, id) => ({ id, ...t }))
  return shuffle(tiles, rng)
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
