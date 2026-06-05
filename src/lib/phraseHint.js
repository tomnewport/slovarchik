// Pure, framework-free helpers for hinting words inside a phrase.
//
// When a Russian phrase is shown, words the learner has not yet learned (and
// which aren't in the batch they're actively learning) can be hinted: tapped to
// reveal their English meaning and hear them read aloud. To do that we need to
// recognise an inflected surface word inside a phrase — "абза́це", "арестова́ла"
// — as the dictionary entry it belongs to. Every word record carries its full
// inflection table (noun declension, verb conjugation, adjective/pronoun forms),
// so we index every form a word can take and look surface tokens up against it.
import { stripStress } from './text.js'
import { phraseTokens } from './phrases.js'

// Raw-record keys that hold inflected Russian forms worth indexing. English
// glosses and example sentences live under other keys and are deliberately left
// out so they can never be matched as a "form".
const FORM_KEYS = ['accented', 'forms', 'declension', 'conjugation']

/**
 * Normalise a Russian surface token for matching: stress marks removed, ё→е,
 * lowercased and stripped of everything but letters (so trailing punctuation in
 * "абза́ц." doesn't defeat the lookup). Returns '' for tokens with no letters.
 * @param {string} token
 * @returns {string}
 */
export function normToken(token) {
  return stripStress(String(token ?? ''))
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}]/gu, '')
}

/** Recursively gather every string leaf under a (possibly nested) value. */
function collectStrings(value, out) {
  if (value == null) return
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out)
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out)
  }
}

/**
 * Every normalised surface form a word can appear as in a phrase: its headword
 * and bare key form plus all of its inflected forms.
 * @param {object} word   a normalised word record (from buildWords)
 * @returns {Set<string>}
 */
export function wordForms(word) {
  const raw = []
  if (word?.headword) raw.push(word.headword)
  if (word?.ru) raw.push(word.ru)
  const extra = word?.extra ?? {}
  for (const key of FORM_KEYS) collectStrings(extra[key], raw)
  // Nouns keep their nested forms on the normalised record, not just in `extra`.
  collectStrings(word?.forms, raw)

  const forms = new Set()
  for (const s of raw) {
    for (const piece of String(s).split(/\s+/)) {
      const n = normToken(piece)
      if (n) forms.add(n)
    }
  }
  return forms
}

/**
 * Build a lookup from a normalised surface form to a hint entry
 * `{ key, ru, en }` for the word that can appear as that form. The word list is
 * sorted (alphabetically by headword), so on a collision the earlier word wins —
 * a stable, deterministic choice rather than whichever happened to load last.
 * @param {object[]} words   normalised word records (from buildWords)
 * @returns {Map<string, {key: string, ru: string, en: string}>}
 */
export function buildFormIndex(words) {
  const index = new Map()
  for (const w of words ?? []) {
    const entry = { key: w.key, ru: w.headword || w.ru, en: w.meaning || w.en }
    if (!entry.en) continue // nothing useful to show — skip
    for (const form of wordForms(w)) {
      if (!index.has(form)) index.set(form, entry)
    }
  }
  return index
}

/**
 * Split a phrase into display tokens, each tagged with the matching hint entry
 * (or null when the token isn't a known word). The raw token is preserved for
 * display (stress marks, capitalisation and punctuation intact); only the lookup
 * is normalised.
 * @param {string} phrase
 * @param {Map<string, object>} index   from {@link buildFormIndex}
 * @returns {Array<{text: string, hint: object|null}>}
 */
export function phraseHintTokens(phrase, index) {
  return phraseTokens(phrase).map((text) => ({
    text,
    hint: index?.get(normToken(text)) ?? null,
  }))
}
