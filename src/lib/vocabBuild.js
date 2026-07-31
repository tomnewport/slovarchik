// Pure functions that turn raw YAML file contents into the normalised, queryable
// word records used across the app. No I/O here (no fetch, no IndexedDB) so it
// stays trivially testable; the store layer feeds it raw text.
import yaml from 'js-yaml'

import { CASES, LOCATIVE, NUMBERS } from './declension.js'
import { stripStress } from './text.js'

/** Map a vocab filename (without extension) to its part of speech. */
export const POS_BY_FILE = {
  nouns: 'noun',
  calendar: 'noun', // days, months and festivals — nouns grouped by topic
  pronouns: 'pronoun',
  numerals: 'numeral',
  verbs: 'verb',
  adjectives: 'adjective',
  adverbs: 'adverb',
  prepositions: 'preposition',
  conjunctions: 'conjunction',
  interjections: 'interjection',
  // Auto-generated gloss-only entries (all `learn: false`). Not a real part of
  // speech and deliberately absent from `partsOfSpeech`: these words exist only
  // so phrase hints can translate every tappable word, and are filtered out of
  // every drill by learnableWords.
  glossary: 'glossary',
}

/** Parts of speech in a stable display order. */
export const partsOfSpeech = [
  'noun',
  'pronoun',
  'numeral',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'interjection',
]

/** Split the "<russian>=<english>" natural key. */
export function parseKey(key) {
  const i = key.indexOf('=')
  if (i === -1) return { ru: key.trim(), en: '' }
  return { ru: key.slice(0, i).trim(), en: key.slice(i + 1).trim() }
}

/** The short gloss before any parenthetical clarification. */
function shortGloss(text) {
  return String(text ?? '')
    .split('(')[0]
    .trim()
}

/** The clarification inside parentheses, if any. */
function glossNote(text) {
  const m = String(text ?? '').match(/\(([^)]*)\)/)
  return m ? m[1].trim() : ''
}

/**
 * Accepted English answers for an explicit plural-display gloss (`en_pl`). A
 * string or a list; each is reduced to its short gloss (dropping any
 * parenthetical note, like `en_gb`) and de-duplicated.
 */
function normalizeEnList(raw) {
  const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return [...new Set(arr.map(shortGloss).filter(Boolean))]
}

/**
 * Normalise an explicit `heteronyms` annotation into {ru, gloss} entries.
 *
 * Heteronyms link at two levels and an author picks one per word:
 *  - Headword level (за́мок "castle" vs замо́к "lock") is detected automatically
 *    by linkHeteronyms — no annotation needed.
 *  - Inflected level, where only a conjugated/declined form collides while the
 *    dictionary forms differ (стоить → сто́ит vs стоять → стои́т), can't be
 *    auto-detected, so the author writes the contrasting forms out explicitly:
 *      heteronyms:
 *        - { ru: сто́ит, gloss: it costs }
 *        - { ru: стои́т, gloss: it stands }
 */
function normalizeHeteronyms(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h) => ({
      ru: String(h?.ru ?? h?.form ?? '').trim(),
      gloss: String(h?.gloss ?? h?.en ?? '').trim(),
    }))
    .filter((h) => h.ru)
}

/** Convert a flat declension map (sg_nom, pl_gen, …) into nested forms. */
function nestForms(declension, numbers) {
  const forms = {}
  // The optional second locative (`sg_loc`) rides alongside the six core cases.
  for (const num of numbers) {
    const slot = {}
    for (const c of [...CASES, LOCATIVE]) {
      const key = `${num}_${c}`
      if (declension && declension[key] != null) slot[c] = declension[key]
    }
    if (Object.keys(slot).length) forms[num] = slot
  }
  return forms
}

/** Pick the accented dictionary form to display. */
function headwordOf(pos, word, forms, bareRu) {
  if (word.accented) return word.accented
  if (pos === 'noun') {
    const num = NUMBERS.find((n) => forms[n]?.nom)
    if (num) return forms[num].nom
  }
  if (word.forms?.m) return word.forms.m // adjectives
  if (word.forms?.nom) return word.forms.nom // pronouns
  return bareRu
}

function normalizeWord(pos, key, word) {
  const { ru, en } = parseKey(key)
  const std = word.en_gb?.standard ?? en
  const alts = word.en_gb?.alt ?? []

  const numbers = pos === 'noun' ? (word.number ?? ['sg', 'pl']) : []
  const forms = pos === 'noun' ? nestForms(word.declension, numbers) : {}
  const headword = headwordOf(pos, word, forms, ru)

  // Display-number preference for the vocabulary word-drills (match/spell/speak
  // and the /vocab browser). Some nouns are stored singular (their dictionary
  // form) yet are used almost always in the plural — перчатки, сапоги, боти́нки.
  // `display_number: pl` shows the plural form and gloss there; `mixed` alternates
  // singular/plural at random; the default `sg` is the historical behaviour. Only
  // the vocab word-drills honour it — the inflection and phrase drills keep the
  // singular headword and the full paradigm. Noun-only.
  const displayNumber = pos === 'noun' ? (word.display_number ?? 'sg') : 'sg'
  // The plural nominative (from the declension table) and the explicit plural
  // gloss(es), used only when a plural display is resolved. Stored, not derived
  // (English plurals aren't reliably regular): `en_pl` is authored.
  const displayRuPl = forms.pl?.nom ?? null
  const displayEnPl = normalizeEnList(word.en_pl)

  // Accepted English answers: the key gloss plus the short form of the standard
  // and alternate meanings.
  const english = [...new Set([en, shortGloss(std), ...alts.map(shortGloss)].filter(Boolean))]

  return {
    key,
    pos,
    ru, // bare Russian (no stress marks) — the key's identity
    en, // bare English from the key
    headword, // accented dictionary form for display
    // Gloss-only entries (`learn: false`) stay in the dictionary so their forms
    // can be hinted inside phrases, but are kept out of every drill and the
    // learning curriculum. Default true.
    learnable: word.learn !== false,
    cefr: word.cefr_level ?? null,
    meaning: shortGloss(std),
    meaningNote: glossNote(std),
    meaningFull: std,
    meaningsAlt: alts,
    english,
    // Alternative Russian spellings accepted as correct answers (synonyms, e.g.
    // маши́на and автомоби́ль both mean "car"). Graded the same as the primary.
    alsoRu: (word.also_ru ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
    usage: word.usage ?? [],
    collections: word.collections ?? [],
    gender: word.gender ?? null,
    animacy: word.animacy ?? null,
    animate: word.animacy === 'a',
    numbers,
    forms,
    // Vocab word-drill display preference (see above). Both surface forms are
    // carried so the consumer resolves the shown number per-instance (see
    // `vocabDisplay`); `mixed` needs both, `pl` needs the plural, `sg` neither.
    displayNumber,
    displayRuPl,
    displayEnPl,
    // Short-form (predicate) adjective agreement: { m, f, n, pl } accented, as
    // authored. Present only where the short form is actually used; hand-curated
    // (stress shifts stored, not derived) and left untouched by the declension
    // generator. Powers the short-form inflection paradigm.
    short: word.short ?? null,
    // Verbal aspect (impf | pf) and the natural key of the aspect partner, as
    // authored. buildWords resolves `pairKey` into the full `aspectPair` link.
    aspect: word.aspect ?? null,
    pairKey: word.pair ?? null,
    aspectPair: null,
    // The case a verb governs on its object when it isn't the plain accusative
    // (помога́ть + dative, ждать + genitive, горди́ться + instrumental). Powers
    // the verb-government drill; null for ordinary accusative/intransitive verbs.
    // Verb-only: prepositions carry their own array-valued `governs` in `extra`.
    governs: pos === 'verb' ? (word.governs ?? null) : null,
    // Confusable same-spelling forms whose stress carries the meaning. An
    // explicit annotation wins; otherwise buildWords fills this in for headword
    // collisions (за́мок "castle" vs замо́к "lock").
    heteronyms: normalizeHeteronyms(word.heteronyms),
    // Other learnable words that share the same base English meaning — filled in
    // by linkAmbiguousEn after all words are built.
    ambiguousEn: [],
    extra: word,
  }
}

/**
 * Link heteronyms across the word list: entries whose accented headwords share
 * the same letters but differ in stress. Each unannotated member inherits a
 * contrast set listing every spelling (itself first) so a drill can remind the
 * learner which stress goes with which meaning.
 */
function linkHeteronyms(words) {
  const byBare = new Map()
  for (const w of words) {
    const k = stripStress(w.headword).toLowerCase()
    if (!byBare.has(k)) byBare.set(k, [])
    byBare.get(k).push(w)
  }
  for (const group of byBare.values()) {
    // A real heteronym needs ≥2 entries whose *stressed* forms actually differ;
    // matching stress is just a homonym and stress can't tell them apart.
    if (group.length < 2 || new Set(group.map((w) => w.headword)).size < 2) continue
    for (const w of group) {
      if (w.heteronyms.length) continue
      w.heteronyms = [w, ...group.filter((m) => m !== w)].map((m) => ({
        ru: m.headword,
        gloss: m.meaning ?? '',
      }))
    }
  }
}

/**
 * Mark learnable words that share the same base English meaning so drills can
 * surface a disambiguation note. Entries whose `meaning` collides with at least
 * one other learnable word get an `ambiguousEn` array listing the other members
 * of the group (Russian headword + distinguishing note, if any).
 */
function linkAmbiguousEn(words) {
  const byMeaning = new Map()
  for (const w of words) {
    if (!w.learnable || !w.meaning) continue
    const key = w.meaning.toLowerCase()
    if (!byMeaning.has(key)) byMeaning.set(key, [])
    byMeaning.get(key).push(w)
  }
  for (const group of byMeaning.values()) {
    if (group.length < 2) continue
    for (const w of group) {
      w.ambiguousEn = group
        .filter((m) => m !== w)
        .map((m) => ({ ru: m.headword || m.ru, note: m.meaningNote || '' }))
    }
  }
}

/**
 * Resolve verbs' `pair:` annotations (the natural key of the aspect partner)
 * into a display-ready link: the partner's accented headword, aspect and gloss.
 * A dangling key resolves to nothing — the data tests enforce that pairs exist
 * and are reciprocal, so silence here only ever hides an authoring typo from
 * the runtime, not from CI.
 */
function linkAspectPairs(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  for (const w of words) {
    if (!w.pairKey) continue
    const partner = byKey.get(w.pairKey)
    if (!partner) continue
    w.aspectPair = {
      key: partner.key,
      ru: partner.headword || partner.ru,
      aspect: partner.aspect,
      gloss: partner.meaning || partner.en,
    }
  }
}

/**
 * Build the full, sorted word list from raw file contents.
 * @param {Array<{pos: string, text: string}>} files
 * @returns {object[]}
 */
export function buildWords(files) {
  const out = []
  for (const { pos, text } of files) {
    if (!pos) continue
    const doc = yaml.load(text) ?? {}
    for (const [key, word] of Object.entries(doc.words ?? {})) {
      out.push(normalizeWord(pos, key, word ?? {}))
    }
  }
  linkHeteronyms(out)
  linkAmbiguousEn(out)
  linkAspectPairs(out)
  // Sort alphabetically by Russian headword, ignoring stress marks.
  return out.sort((a, b) => stripStress(a.ru).localeCompare(stripStress(b.ru), 'ru'))
}

/**
 * Keep only words that are part of the learning curriculum. Gloss-only entries
 * (`learn: false`) are filtered out of every drill, the phrase bank, and the
 * batch/progress engine — but remain in the full word list so {@link
 * buildFormIndex} can still hint their forms inside phrases.
 */
export function learnableWords(words) {
  return (words ?? []).filter((w) => w.learnable !== false)
}

/** Shape words for the vocabulary (translation) drill. */
export function shapeVocab(words) {
  return learnableWords(words).map((w) => ({
    id: w.key,
    ru: w.headword || w.ru,
    en: w.english,
    pos: w.pos,
    cefr: w.cefr,
    note: w.meaningNote,
    heteronyms: w.heteronyms,
    alsoRu: w.alsoRu,
    ambiguousEn: w.ambiguousEn ?? [],
    aspect: w.aspect ?? null,
    aspectPair: w.aspectPair ?? null,
    // Display-number preference + the plural surface form/gloss, so the vocab
    // word-drills can show a usually-plural noun in the plural. `vocabDisplay`
    // turns these into the single shown `{ ru, en }` per exercise instance.
    displayNumber: w.displayNumber ?? 'sg',
    ruPl: w.displayRuPl ?? null,
    enPl: w.displayEnPl ?? [],
  }))
}

/**
 * Resolve which surface form a shaped vocab word shows in the word-drills.
 * `display_number: pl` returns the plural nominative and plural gloss; `mixed`
 * flips a coin (per call, via `rng`); anything else — the default — returns the
 * singular headword. Falls back to the singular whenever the plural data is
 * absent, so a mis-annotation never renders a blank prompt.
 *
 * @param {object} v shaped vocab word (from {@link shapeVocab})
 * @param {() => number} [rng] randomness source for the `mixed` coin-flip
 * @returns {{ ru: string, en: string[], number: 'sg' | 'pl' }}
 */
export function vocabDisplay(v, rng = Math.random) {
  const wantPl = v?.displayNumber === 'pl' || (v?.displayNumber === 'mixed' && rng() < 0.5)
  if (wantPl && v.ruPl && v.enPl?.length) {
    return { ru: v.ruPl, en: v.enPl, number: 'pl' }
  }
  return { ru: v.ru, en: v.en, number: 'sg' }
}

/**
 * Shape usage examples into a phrase bank for the phrase drill. Every word may
 * carry example sentences as `{ ru, en_gb }` pairs; we flatten them all into a
 * single deduplicated list of translatable phrases.
 */
export function shapePhrases(words) {
  const seen = new Set()
  const out = []
  for (const w of learnableWords(words)) {
    for (const ex of w.usage ?? []) {
      const ru = String(ex?.ru ?? '').trim()
      const en = String(ex?.en_gb ?? '').trim()
      if (!ru || !en) continue
      const id = `${ru}=${en}`
      if (seen.has(id)) continue
      seen.add(id)
      // Extra accepted English renderings (word order / optional words) so the
      // word-bank drill credits a valid translation it doesn't shape the tiles
      // from. Russian has no articles, so word order often varies in English.
      const enAlt = Array.isArray(ex?.en_alt)
        ? ex.en_alt.map((s) => String(s ?? '').trim()).filter(Boolean)
        : []
      out.push({ id, ru, en, enAlt, source: w.key, cefr: w.cefr })
    }
  }
  return out
}

/**
 * Shape the in-context inflection drill bank from the `inflect:` annotations on
 * words' usage examples. Every usage example may carry an `inflect` block naming
 * the token being taught and its grammatical slot; here we turn each annotated
 * example into a phrase descriptor the context resolver (lib/phraseContext.js)
 * understands — the target word is the example's owner, so its key is implicit.
 */
export function shapeContextPhrases(words) {
  const out = []
  for (const w of learnableWords(words)) {
    w.usage?.forEach((ex, i) => {
      const a = ex?.inflect
      const ru = String(ex?.ru ?? '').trim()
      if (!a || !ru || !a.token) return
      out.push({
        id: `${w.key}#${i}`,
        ru,
        en: String(ex?.en_gb ?? '').trim(),
        subject: w.collections?.[0] ?? null,
        target: {
          key: w.key,
          token: a.token,
          // Consecutive tokens the slot spans — a multi-word lemma inflects as a
          // unit (день рожде́ния, горя́чий шокола́д). Defaults to a single token.
          span: a.span ?? null,
          case: a.case ?? null,
          number: a.number ?? null,
          gender: a.gender ?? null,
          // Short-form (predicate) adjective agreement: «degree: short» + gender,
          // no case (закры́т, ра́да). Graded by gender/number against `short`.
          degree: a.degree ?? null,
          // Third-person pronoun with the post-preposition н- prefix (у него́,
          // с ни́ми): the answer form is «н» + the stored oblique form.
          prep: a.prep ?? null,
          // Marks an adjective/pronoun accusative that agrees with an animate
          // noun, so it takes the genitive form (ви́жу хоро́шего дру́га). The slot
          // is still graded as the accusative — animacy only selects the form.
          animate: a.animate ?? null,
          tense: a.tense ?? null,
          person: a.person ?? null,
          rule: a.rule ?? null,
        },
      })
    })
  }
  return out
}

/** Shape declinable nouns for the declension drill. */
export function shapeNouns(words) {
  return learnableWords(words)
    .filter((w) => w.pos === 'noun' && Object.keys(w.forms).length > 0)
    .map((w) => ({
      id: w.key,
      lemma: w.headword || w.ru,
      en: w.meaning,
      cefr: w.cefr,
      gender: w.gender,
      animacy: w.animacy,
      animate: w.animate,
      numbers: w.numbers,
      forms: w.forms,
    }))
}
