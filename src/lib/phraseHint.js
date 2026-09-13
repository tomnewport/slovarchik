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
 * Does this token carry an acute stress mark?
 *
 * Exported because word alignment asks the same question of the same four
 * codepoints (lib/phraseAlign.js), and a second copy of the set is a second
 * place to forget when one of them changes.
 * @param {string} token
 * @returns {boolean}
 */
export function hasStressMark(token) {
  return new RegExp(STRESS_MARKS.source, 'u').test(String(token ?? ''))
}

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
 * Every *raw* surface form a word can appear as in a phrase: its headword and
 * bare key form, its authored form tables, and the participle cells derived
 * from them. Deduplicated but not normalised — the caller decides which
 * normaliser keys them, which is what lets {@link buildFormIndex} walk each
 * record once and normalise the strings it collects twice.
 *
 * Only single-word forms come back. Indexing the pieces of a multi-word form
 * (e.g. the year «две ты́сячи») would leak its component words as standalone
 * glosses — that's how «две» came to mean "two thousand" (see #155).
 * @param {object} word   a normalised word record (from buildWords)
 * @returns {Set<string>}
 */
function rawWordForms(word) {
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
  return singleWords(raw)
}

/** The raw dictionary forms — headword and bare key form. See {@link baseForms}. */
function rawBaseForms(word) {
  return singleWords([word?.headword, word?.ru])
}

/** Trim, drop the empties and anything with internal whitespace, dedupe. */
function singleWords(raw) {
  const out = new Set()
  for (const s of raw) {
    const trimmed = String(s ?? '').trim()
    if (!trimmed || /\s/.test(trimmed)) continue
    out.add(trimmed)
  }
  return out
}

/** Key a collected set of raw forms with `norm`, dropping the ones that empty out. */
function normForms(raw, norm) {
  const forms = new Set()
  for (const s of raw) {
    const n = norm(s)
    if (n) forms.add(n)
  }
  return forms
}

/**
 * Add the n-prefixed third-person pronoun forms to an already-normalised set,
 * in place.
 *
 * Third-person personal pronouns take an n- prefix after a preposition
 * (его→него, ему→нему, её→неё, им→ним, их→них, ими→ними). These surface forms
 * never appear in the curated tables, so derive them here for hinting only.
 * The rule is purely phonological: oblique forms beginning with е/и gain a
 * leading н. Restricted to `pers` so the indeclinable possessives его/её/их
 * don't shadow «него»/«неё» with "his"/"her".
 *
 * It reads the normalised form rather than the raw one, and both normalisers
 * leave the first letter alone (a combining acute only ever follows a vowel),
 * so the prefixed forms derive from one another exactly as their bases do —
 * which is what keeps {@link plainForm} exact over the whole set.
 */
function addPronounForms(word, forms) {
  if (word?.pos !== 'pronoun' || word?.extra?.type !== 'pers') return forms
  for (const f of [...forms]) {
    if (/^[еи]/.test(f)) forms.add(`н${f}`)
  }
  return forms
}

/**
 * Every normalised surface form a word can appear as in a phrase: its headword
 * and bare key form plus all of its inflected forms.
 * @param {object} word   a normalised word record (from buildWords)
 * @param {(t: string) => string} [norm]  token normaliser (default {@link normToken})
 * @returns {Set<string>}
 */
export function wordForms(word, norm = normToken) {
  return addPronounForms(word, normForms(rawWordForms(word), norm))
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
  return normForms(rawBaseForms(word), norm)
}

/**
 * The plain (stress-stripped) key of a form already keyed by
 * {@link normTokenStress} — the two normalisers are the same pipeline one step
 * apart, so
 *
 * ```js
 * normToken(s) === plainForm(normTokenStress(s))
 * ```
 *
 * for every string: both lowercase, fold ё→е and drop everything that is not a
 * letter; the stress-keeping one merely canonicalises the acute variants to a
 * combining acute and keeps it, which this removes. Deriving beats re-running
 * the pipeline over all ~47k raw forms (#697), and `phraseHint.test.js` holds
 * the identity over the whole corpus so a change to either normaliser can't
 * break the derivation silently.
 * @param {string} form  a form keyed by {@link normTokenStress}
 * @returns {string}
 */
export function plainForm(form) {
  return String(form ?? '').replace(/\u0301/g, '')
}

/** {@link plainForm} over a whole set, dropping any form that empties out. */
function plainForms(forms) {
  const out = new Set()
  for (const f of forms) {
    const p = plainForm(f)
    if (p) out.add(p)
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
 * @param {Array<{word: object, base: Set<string>, forms: Set<string>}>} prepared
 *   word records in dictionary order, each with its forms already keyed by the
 *   normaliser this index uses (see {@link buildFormIndex})
 * @param {(t: string) => string} norm  the normaliser those forms were keyed with
 * @returns {{index: Map<string, {key: string, ru: string, en: string, senses: object[]}>,
 *   candidates: Map<string, string[]>}} the display index, and beside it the
 *   full claim list for every form more than one word can surface as — which is
 *   the question the collision rules above *answer* rather than record, and the
 *   one `lib/phraseAlign.js` has to re-ask (#706)
 */
function buildIndex(prepared, norm) {
  const index = new Map()
  // Every word that can surface as each form, regardless of which one the
  // collision rules below hand the entry to. The entry answers "what do we
  // show"; this answers "what could this token be", which is the question
  // alignment (lib/phraseAlign.js) has to settle. Only genuinely contested
  // forms are kept — a form claimed by one word needs no candidate list, and
  // keeping all ~47k of them would cost memory to say nothing.
  //
  // Read off the forms `prepared` already carries rather than re-deriving them:
  // walking a record for its forms is the expensive half of building an index,
  // and doing it again here would put back the second walk #697 removed.
  const claims = new Map()
  for (const { word: w, forms } of prepared) {
    for (const form of forms) {
      const seen = claims.get(form)
      if (seen) seen.push(w.key)
      else claims.set(form, [w.key])
    }
  }
  /** @type {Map<string, string[]>} */
  const candidates = new Map()
  for (const [form, keys] of claims) if (keys.length > 1) candidates.set(form, keys)
  // Gloss-only entries are keyed on a surface form, not on a lemma, so the entries
  // they hold are the ones a real lemma is allowed to join in pass 2.
  const glossOnly = new Set(
    prepared.filter((p) => p.word.learnable === false).map((p) => p.word.key),
  )

  /** Is every sense on this entry a gloss-only stub? */
  const heldOnlyByStubs = (entry) => entry.senses.every((s) => glossOnly.has(s.key))

  // Pass 1: base (dictionary) forms — a word whose lemma *is* the surface form
  // always beats another word for which the token is merely an oblique form.
  for (const { word: w, base } of prepared) {
    const sense = { key: w.key, ru: w.headword || w.ru, en: w.meaning || w.en }
    if (!sense.en) continue
    for (const form of base) addSense(index, form, sense)
  }

  // Pass 2: inflected forms. When a word has heteronym annotations, use the
  // per-form gloss (e.g. "it stands" for стои́т vs "it costs" for сто́ит) instead
  // of the generic headword meaning. When two heteronymic inflected forms collapse
  // to the same normalised string (stress stripped + ё→е), combine both glosses
  // so the hint shows both possibilities.
  for (const { word: w, forms } of prepared) {
    const baseEn = w.meaning || w.en
    if (!baseEn) continue
    for (const form of forms) {
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

  return { index, candidates }
}

/**
 * The surface-form index: a Map from normalised token to its entry, carrying a
 * second Map on the side for stress-exact lookups.
 *
 * The side-channel is deliberate — a heteronym is only distinguishable when the
 * token carries its stress mark, so the stress-exact pass needs its own index,
 * and hanging it off the main one keeps the pair inseparable. It is why the
 * assignments below are cast: `buildIndex` returns a plain Map and this is the
 * moment it becomes the richer shape (#666).
 *
 * `candidates` is the other side of the same coin: for the forms more than one
 * word can surface as, *every* word that can — not just the one the collision
 * rules gave the entry to. The entry says what to show; the candidate list says
 * what the token could be, which is the question `lib/phraseAlign.js` settles.
 * Forms only one word claims are absent, so a miss means "unambiguous".
 *
 * @typedef {Map<string, {key: string, ru: string, en: string, senses: object[]}>
 *   & {stressIndex: FormIndex, candidates: Map<string, string[]>}} FormIndex
 */

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
 *
 * Both indexes also carry `.candidates`, the full claim list for every contested
 * form (see the typedef); `lib/phraseAlign.js` reads it to decide which word a
 * token actually is, rather than inheriting the display entry's guess.
 * @param {object[]} words   normalised word records (from buildWords)
 * @returns {FormIndex}
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
        Number(a.learnable === false) - Number(b.learnable === false) ||
        String(a.key ?? '').localeCompare(String(b.key ?? ''), 'ru'),
    )

  // Two indexes, one walk. Collecting a word's raw forms means recursing its
  // whole record — form tables, participles, the derived participle grids — and
  // doing that once per normaliser walked all ~47k of them twice for the same
  // strings (#697). Collect once, then key the strings twice.
  const prepared = sorted.map((word) => ({
    word,
    base: baseForms(word, normTokenStress),
    forms: wordForms(word, normTokenStress),
  }))
  const stressed = buildIndex(prepared, normTokenStress)

  // …and the second keying is a derivation, not a second run of the pipeline:
  // the plain form of a stress-keyed one is that form with its acute removed
  // (see {@link plainForm}). Derived in place so each word's stress sets can be
  // collected as we go rather than both keyings being held at once.
  for (const p of prepared) {
    p.base = plainForms(p.base)
    p.forms = plainForms(p.forms)
  }
  const bare = buildIndex(prepared, normToken)

  // Each index carries the candidate lists built from its own keying, so a
  // stress-exact lookup and a stress-blind one disagree about what a token
  // could be exactly where the forms themselves do (#706).
  const index = /** @type {FormIndex} */ (bare.index)
  index.candidates = bare.candidates
  const stressIndex = /** @type {FormIndex} */ (stressed.index)
  stressIndex.candidates = stressed.candidates
  index.stressIndex = stressIndex
  return index
}

/**
 * Split a phrase into display tokens, each tagged with the matching hint entry
 * (or null when the token isn't a known word). The raw token is preserved for
 * display (stress marks, capitalisation and punctuation intact); only the lookup
 * is normalised.
 * @param {string} phrase
 * @param {FormIndex} index   from {@link buildFormIndex}
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
