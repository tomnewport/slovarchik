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
import { PARTICIPLE_SLOTS, participleGrid } from './participles.js'

// Raw-record keys that hold inflected Russian forms worth indexing. English
// glosses and example sentences live under other keys and are deliberately left
// out so they can never be matched as a "form".
const FORM_KEYS = ['accented', 'forms', 'declension', 'conjugation', 'short']

// Acute-accent marks used to mark stress (same set stripStress folds away).
const STRESS_MARKS = /[\u0301\u0341\u00B4\u02CA]/gu

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

/**
 * Like {@link normToken} but keeps the stress mark, so heteronyms that differ
 * only by stress stay distinct — «по́лке» (shelf) vs «полке́» (regiment), «стоя́т»
 * (stand) vs «сто́ят» (cost). Accent variants fold to the combining acute so
 * comparisons are consistent. Returns '' for tokens with no letters.
 * @param {string} token
 * @returns {string}
 */
export function normTokenStress(token) {
  return String(token ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(STRESS_MARKS, '\u0301')
    .replace(/[^\p{L}\u0301]/gu, '')
}

/** Whether a surface token carries an acute stress mark. */
function hasStressMark(token) {
  return /[\u0301\u0341\u00B4\u02CA]/u.test(String(token ?? ''))
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
 * @param {(t: string) => string} [norm]  token normaliser (default {@link normToken})
 * @returns {Set<string>}
 */
export function wordForms(word, norm = normToken) {
  const raw = []
  if (word?.headword) raw.push(word.headword)
  if (word?.ru) raw.push(word.ru)
  const extra = word?.extra ?? {}
  for (const key of FORM_KEYS) collectStrings(extra[key], raw)
  // Nouns keep their nested forms on the normalised record, not just in `extra`.
  collectStrings(word?.forms, raw)
  // A verb's non-finite forms, likewise promoted onto the normalised record.
  // `participles` is nested — its `pass_short` block holds the four gender
  // cells — and collectStrings recurses, so that comes along whole.
  collectStrings(word?.participles, raw)
  collectStrings(word?.gerund, raw)
  // Only each long participle's NOMINATIVE is stored; the other 23 cells are
  // derived (participles.js). Without them, tapping «пла́чущего» in a phrase
  // would resolve to a glossary stub rather than to пла́кать — which is exactly
  // the disconnect #564 is about.
  for (const slot of PARTICIPLE_SLOTS) {
    const grid = participleGrid(word, slot)
    if (grid) collectStrings(grid, raw)
  }

  const forms = new Set()
  for (const s of raw) {
    // Only single-word forms can ever match a phrase token. Indexing the pieces
    // of a multi-word form (e.g. the year «две ты́сячи») would leak its component
    // words as standalone glosses — that's how «две» came to mean "two thousand"
    // (see #155). Skip anything with internal whitespace.
    const trimmed = String(s).trim()
    if (!trimmed || /\s/.test(trimmed)) continue
    const n = norm(trimmed)
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
 * @param {(t: string) => string} [norm]  token normaliser (default {@link normToken})
 * @returns {Set<string>}
 */
export function baseForms(word, norm = normToken) {
  const out = new Set()
  for (const s of [word?.headword, word?.ru]) {
    const trimmed = String(s ?? '').trim()
    if (!trimmed || /\s/.test(trimmed)) continue
    const n = norm(trimmed)
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

/** Separator between the glosses of a form that carries more than one sense. */
const SENSE_SEPARATOR = ' / '

/**
 * The gloss line for a set of senses — every meaning the surface form can carry,
 * in dictionary order. Exported so a consumer that narrows the senses (the hint
 * store drops the ones the learner already knows) renders them the same way.
 * @param {Array<{en: string}>} senses
 * @returns {string}
 */
export function senseGloss(senses) {
  return (senses ?? []).map((s) => s.en).join(SENSE_SEPARATOR)
}

/**
 * Does `en` say something the already-collected `senses` don't? Guards against
 * a hint reading "task / task" when two entries share a gloss, and against
 * repeating a gloss already contained in a longer one.
 */
function isNewGloss(senses, en) {
  return !senses.some((s) => s.en === en || s.en.includes(en))
}

/**
 * Add a sense `{ key, ru, en }` to the entry for `form`, creating the entry when
 * the form is new. The first sense also supplies the entry's own `key`/`ru`, so
 * a single-sense entry looks exactly as it did before senses existed.
 */
function addSense(index, form, sense) {
  const existing = index.get(form)
  if (!existing) {
    index.set(form, { key: sense.key, ru: sense.ru, en: sense.en, senses: [sense] })
    return
  }
  if (existing.senses.some((s) => s.key === sense.key)) return
  if (!isNewGloss(existing.senses, sense.en)) return
  existing.senses.push(sense)
  existing.en = senseGloss(existing.senses)
}

/**
 * Build a lookup from a normalised surface form to a hint entry
 * `{ key, ru, en, senses }` for the word(s) that can appear as that form.
 *
 * Collisions are resolved in two passes. First every word claims its own
 * **dictionary form** (headword/key), so a word whose lemma *is* the surface
 * token always beats another word for which the token is merely an oblique
 * inflected form — e.g. «дорого́й» glosses as the adjective "expensive" rather
 * than the instrumental of «доро́га» "road" (#173). Only then do inflected forms
 * fill the remaining gaps.
 *
 * When two *dictionary* forms genuinely collide the token is a homograph, and
 * one gloss would be a lie half the time — «есть» is both "to eat" and the
 * existential "there is", «замок» both "castle" and "lock" (#568). Those stack
 * up as multiple `senses` on the one entry and `en` joins their glosses, so the
 * hint offers every meaning the learner might be looking at. Inflected forms
 * (pass 2) mostly don't stack: an oblique form that happens to look like another
 * word is a coincidence, not a second meaning. Two things are exceptions. An
 * explicit heteronym annotation, which is exactly a claim that the collision is
 * real ("it costs" for сто́ит vs "it stands" for стои́т). And a **learnable lemma
 * meeting an entry held only by gloss-only stubs** (#574): a stub is keyed on the
 * surface form it glosses, so it claims that form in pass 1 as though it were a
 * headword, and the verb that also spells it there can only ever reach pass 2.
 * Left unstacked, «закро́й» glosses as "close" and dead-ends; stacked, it reads
 * "close / to close" and the learner gets back to закры́ть. The stub keeps its own
 * sense, which for a nominalised gloss — «заде́ржанный» "detainee", not "to detain"
 * — is the sense that matters.
 *
 * Within each pass senses appear in dictionary order of the entries claiming them.
 * @param {object[]} sorted   word records, pre-sorted by headword then key
 * @param {(t: string) => string} norm  token normaliser keying the index
 * @returns {Map<string, {key: string, ru: string, en: string, senses: object[]}>}
 */
function buildIndex(sorted, norm) {
  const index = new Map()
  // Gloss-only entries are keyed on a surface form, not on a lemma, so the entries
  // they hold are the ones a real lemma is allowed to join in pass 2.
  const glossOnly = new Set(sorted.filter((w) => w.learnable === false).map((w) => w.key))

  /** Is every sense on this entry a gloss-only stub? */
  const heldOnlyByStubs = (entry) => entry.senses.every((s) => glossOnly.has(s.key))

  // Pass 1: base (dictionary) forms — a word whose lemma *is* the surface form
  // always beats another word for which the token is merely an oblique form.
  for (const w of sorted) {
    const sense = { key: w.key, ru: w.headword || w.ru, en: w.meaning || w.en }
    if (!sense.en) continue
    for (const form of baseForms(w, norm)) addSense(index, form, sense)
  }

  // Pass 2: inflected forms. When a word has heteronym annotations, use the
  // per-form gloss (e.g. "it stands" for стои́т vs "it costs" for сто́ит) instead
  // of the generic headword meaning. When two heteronymic inflected forms collapse
  // to the same normalised string (stress stripped + ё→е), combine both glosses
  // so the hint shows both possibilities.
  for (const w of sorted) {
    const baseEn = w.meaning || w.en
    if (!baseEn) continue
    for (const form of wordForms(w, norm)) {
      const hetEntry = w.heteronyms?.find((h) => norm(h.ru) === form)
      const en = hetEntry?.gloss || baseEn
      const sense = { key: w.key, ru: w.headword || w.ru, en }
      // Inflected forms mostly just fill the gaps pass 1 left. Two things may
      // join a form another entry already holds: a heteronym annotation, and a
      // learnable lemma whose form is held only by gloss-only stubs (#574) — a
      // stub is keyed on a surface form, so it claims that form in pass 1 as if
      // it were a headword, and «закро́й» would otherwise gloss as "close" with
      // no route back to закры́ть. Stacking keeps the stub's own sense, which for
      // a nominalised gloss ("detainee", not "to detain") is the one that matters.
      const entry = index.get(form)
      const joinsStub = entry && w.learnable !== false && heldOnlyByStubs(entry)
      if (!entry || hetEntry || joinsStub) addSense(index, form, sense)
    }
  }

  return index
}

/**
 * Build a lookup from a normalised surface form to a hint entry
 * `{ key, ru, en, senses }` for the word(s) that can appear as that form. See
 * {@link buildIndex} for the two-pass collision rules and how a homograph comes
 * to carry several senses.
 *
 * The returned Map is keyed by the stress-stripped form (the default lookup). A
 * companion **stress-aware** index is attached as `.stressIndex`, keyed with the
 * stress mark kept, so {@link phraseHintTokens} can disambiguate heteronyms that
 * differ only by stress — «по́лке» (shelf) vs «полке́» (regiment), «стоя́т» (stand)
 * vs «сто́ят» (cost) — whenever the phrase token carries its stress mark.
 * @param {object[]} words   normalised word records (from buildWords)
 * @returns {Map<string, {key: string, ru: string, en: string, senses: object[]}> & {stressIndex: Map}}
 */
export function buildFormIndex(words) {
  const sorted = (words ?? [])
    .slice()
    .sort(
      (a, b) =>
        stripStress(a.ru ?? '').localeCompare(stripStress(b.ru ?? ''), 'ru') ||
        // Homographs share a bare form, so the tie needs breaking explicitly —
        // otherwise the order their senses stack in (and which one an entry takes
        // its `key` from) would depend on which vocab file happened to load first.
        // A curriculum word sorts ahead of a gloss-only one so the entry's `key`
        // names something the learner can actually be drilling.
        (a.learnable === false) - (b.learnable === false) ||
        String(a.key ?? '').localeCompare(String(b.key ?? ''), 'ru'),
    )
  const index = buildIndex(sorted, normToken)
  index.stressIndex = buildIndex(sorted, normTokenStress)
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
  const stressIndex = index?.stressIndex
  return phraseTokens(phrase).map((text) => {
    // When the token carries a stress mark, prefer a stress-exact match so a
    // heteronym is disambiguated (по́лке→shelf, not regiment). Fall back to the
    // stress-stripped index for tokens without stress or with no exact match.
    const stressed =
      stressIndex && hasStressMark(text) ? stressIndex.get(normTokenStress(text)) : null
    return {
      text,
      hint: stressed ?? index?.get(normToken(text)) ?? null,
    }
  })
}
