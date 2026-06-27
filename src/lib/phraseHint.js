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
    // Only single-word forms can ever match a phrase token. Indexing the pieces
    // of a multi-word form (e.g. the year «две ты́сячи») would leak its component
    // words as standalone glosses — that's how «две» came to mean "two thousand"
    // (see #155). Skip anything with internal whitespace.
    const trimmed = String(s).trim()
    if (!trimmed || /\s/.test(trimmed)) continue
    const n = normToken(trimmed)
    if (n) forms.add(n)
  }
  // Third-person personal pronouns take an n- prefix after a preposition
  // (его→него, ему→нему, её→неё, им→ним, их→них, ими→ними). These surface forms
  // never appear in the curated tables, so derive them here for hinting only.
  // The rule is purely phonological: oblique forms beginning with е/и gain a
  // leading н. Restricted to `pers` so the indeclinable possessives его/её/их
  // don't shadow «него»/«неё» with "his"/"her".
  if (word?.pos === 'pronoun' && extra.type === 'pers') {
    for (const f of [...forms]) {
      if (/^[еи]/.test(f)) forms.add(`н${f}`)
    }
  }
  return forms
}

/**
 * The normalised *dictionary* forms of a word — its headword and bare key form.
 * These are the lemma a learner would look up, as opposed to the oblique
 * inflected forms also returned by {@link wordForms}.
 * @param {object} word
 * @returns {Set<string>}
 */
export function baseForms(word) {
  const out = new Set()
  for (const s of [word?.headword, word?.ru]) {
    const trimmed = String(s ?? '').trim()
    if (!trimmed || /\s/.test(trimmed)) continue
    const n = normToken(trimmed)
    if (n) out.add(n)
  }
  return out
}

/**
 * The normalised surface tokens of `phrase` that are inflected forms of `word`.
 * Tells which token(s) in a phrase belong to a particular word — used to spare
 * the word being assessed from a penalty when a phrase-spelling answer goes wrong
 * only elsewhere in the phrase (collateral damage). Order follows the phrase;
 * a word appearing twice yields two entries.
 * @param {string} phrase
 * @param {object} word   a normalised word record (from buildWords)
 * @returns {string[]}    normalised tokens (possibly empty)
 */
export function wordTokensInPhrase(phrase, word) {
  const forms = wordForms(word)
  if (!forms.size) return []
  return phraseTokens(phrase)
    .map(normToken)
    .filter((t) => t && forms.has(t))
}

/**
 * Build a lookup from a normalised surface form to a hint entry
 * `{ key, ru, en }` for the word that can appear as that form.
 *
 * Collisions are resolved in two passes. First every word claims its own
 * **dictionary form** (headword/key), so a word whose lemma *is* the surface
 * token always beats another word for which the token is merely an oblique
 * inflected form — e.g. «дорого́й» glosses as the adjective "expensive" rather
 * than the instrumental of «доро́га» "road" (#173). Only then do inflected forms
 * fill the remaining gaps. Within each pass the alphabetically earlier headword
 * wins, a stable choice regardless of load order.
 * @param {object[]} words   normalised word records (from buildWords)
 * @returns {Map<string, {key: string, ru: string, en: string}>}
 */
export function buildFormIndex(words) {
  const sorted = (words ?? [])
    .slice()
    .sort((a, b) => stripStress(a.ru ?? '').localeCompare(stripStress(b.ru ?? ''), 'ru'))
  const index = new Map()

  // Pass 1: base (dictionary) forms — a word whose lemma *is* the surface form
  // always beats another word for which the token is merely an oblique form.
  for (const w of sorted) {
    const entry = { key: w.key, ru: w.headword || w.ru, en: w.meaning || w.en }
    if (!entry.en) continue
    for (const form of baseForms(w)) {
      if (!index.has(form)) index.set(form, entry)
    }
  }

  // Pass 2: inflected forms. When a word has heteronym annotations, use the
  // per-form gloss (e.g. "it stands" for стои́т vs "it costs" for сто́ит) instead
  // of the generic headword meaning. When two heteronymic inflected forms collapse
  // to the same normalised string (stress stripped + ё→е), combine both glosses
  // so the hint shows both possibilities.
  for (const w of sorted) {
    const baseEn = w.meaning || w.en
    if (!baseEn) continue
    for (const form of wordForms(w)) {
      const hetEntry = w.heteronyms?.find((h) => normToken(h.ru) === form)
      const en = hetEntry?.gloss || baseEn
      if (!index.has(form)) {
        index.set(form, { key: w.key, ru: w.headword || w.ru, en })
      } else if (hetEntry) {
        // Heteronym collision: append this side's gloss if it is new information.
        const existing = index.get(form)
        if (en !== existing.en && !existing.en.includes(en)) {
          index.set(form, { ...existing, en: `${existing.en} / ${en}` })
        }
      }
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
