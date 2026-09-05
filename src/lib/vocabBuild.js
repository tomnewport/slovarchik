// Pure functions that turn parsed vocab documents into the normalised, queryable
// word records used across the app. No I/O and no parsing here (no fetch, no
// IndexedDB, no YAML/JSON decode) so it stays trivially testable and — crucially
// — carries no parser into the runtime bundle. The store layer feeds it the
// already-parsed document object (`{ words: {...} }`); at build time the YAML is
// converted to JSON, and the browser only ever `JSON.parse`s (see issue #324).
import { CASES, LOCATIVE, NUMBERS } from './declension.js'
import { buildAmbiguityIndex, phraseAmbiguities } from './phraseAmbiguity.js'
import { promptHints } from './promptDisambiguation.js'
import { foldYo, stripStress } from './text.js'
import { normalizeGoverns } from './verbGovernment.js'

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

/**
 * The closed set of `facts:` kinds, in the order a panel shows them. A word's
 * facts are optional notes about *the word itself* rather than about a drill:
 *  - `build`   — the morpheme breakdown (пере‧вод‧и́ть), optionally as `parts`;
 *  - `root`    — the shared root that ties it to words already known;
 *  - `origin`  — etymology, borrowings, calques;
 *  - `region`  — where in the Russian-speaking world the word is used, or used
 *                differently. Carries a `where` (the place) beside its prose,
 *                because a regional claim that cannot name a place is a `note`;
 *  - `memory`  — a mnemonic;
 *  - `note`    — anything else worth saying once.
 * A closed set means the renderer maps kind → icon/label and never guesses;
 * adding a kind is a one-line change here plus an icon.
 */
export const FACT_KINDS = ['build', 'root', 'origin', 'region', 'memory', 'note']

/** Normalise the morpheme breakdown of a `build` fact into {ru, en} chips. */
function normalizeParts(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p) => ({ ru: String(p?.ru ?? '').trim(), en: String(p?.en ?? p?.gloss ?? '').trim() }))
    .filter((p) => p.ru)
}

/** Natural keys of related entries, trimmed and de-duplicated. */
function normalizeKeys(raw) {
  const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return [...new Set(arr.map((k) => String(k ?? '').trim()).filter(Boolean))]
}

/**
 * Normalise the optional `facts:` list — typed notes about the word (see
 * {@link FACT_KINDS}). An unknown `kind` or a blank `text` drops the fact rather
 * than failing the build; `factIssues` (wordFacts.js) is what turns an authoring
 * slip into a red CI run. `parts` is `build`-only; the `see:` keys are resolved
 * into full links by linkFacts once every word exists.
 */
function normalizeFacts(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((f) => {
      const kind = String(f?.kind ?? '').trim()
      const text = String(f?.text ?? '').trim()
      if (!FACT_KINDS.includes(kind) || !text) return null
      return {
        kind,
        text,
        parts: kind === 'build' ? normalizeParts(f.parts) : [],
        // The place a `region` fact is about, kept apart from its prose so a
        // correction message and a panel row can name it without parsing a
        // sentence. Blank here is an authoring slip, reported by `factIssues`.
        where: kind === 'region' ? String(f.where ?? '').trim() : '',
        seeKeys: normalizeKeys(f.see),
        see: [], // resolved by linkFacts
      }
    })
    .filter(Boolean)
}

/**
 * Normalise the optional `confusable_with:` list into {key, why} entries. This
 * is for confusions the shaped record cannot already see — sound-alikes
 * (звони́ть/звене́ть) and false friends. Aspect pairs, motion pairs, participle
 * origins, heteronyms and same-gloss words are derived elsewhere and must not be
 * re-authored here.
 */
function normalizeConfusableWith(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const c of raw) {
    const key = String(c?.key ?? '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key, why: String(c?.why ?? '').trim() })
  }
  return out
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

/**
 * Convert a flat per-cell notes map (`declension_notes`, same cell keys as
 * `declension` — sg_nom, pl_gen, …) into the same nested number → case shape as
 * {@link nestForms}. A note is a short explanation surfaced as a tooltip on that
 * one cell of the declension table — e.g. why год's genitive plural is the
 * suppletive лет rather than the regular годо́в. Cells without a note are absent.
 */
function nestNotes(notes, numbers) {
  const out = {}
  if (!notes) return out
  for (const num of numbers) {
    const slot = {}
    for (const c of [...CASES, LOCATIVE]) {
      const key = `${num}_${c}`
      if (notes[key] != null) slot[c] = String(notes[key]).trim()
    }
    if (Object.keys(slot).length) out[num] = slot
  }
  return out
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
  const formNotes = pos === 'noun' ? nestNotes(word.declension_notes, numbers) : {}
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
    // Per-cell declension notes (nested number → case, mirroring `forms`), each
    // a short tooltip explaining an irregular/suppletive cell (год → лет). Empty
    // for the overwhelming majority of nouns.
    formNotes,
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
    // Non-finite verb forms — причастия and деепричастия (#564). `participles`
    // holds one accented nominative per long slot (`act_pres`, `act_past`,
    // `pass_pres`, `pass_past`) plus the per-gender `pass_short` block; `gerund`
    // is a single scalar (a verb forms the gerund of its own aspect, and
    // `aspect:` already says which). Both are optional and gappy on purpose —
    // an intransitive has no passive, many imperfectives have no gerund. The
    // long participles' oblique cells are derived, not stored: see
    // src/lib/participles.js and docs/participles-and-gerunds.md.
    participles: word.participles ?? null,
    gerund: word.gerund ?? null,
    // A participle that has also been lexicalised as its own adjective entry
    // (закры́тый, при́нятый) links back to the verb it came from, so the word
    // card can explain the origin instead of teaching an unrelated item.
    // buildWords resolves it into `participleOf`. Adjective-only.
    fromVerb: word.from_verb ?? null,
    participleOf: null,
    // Verbal aspect (impf | pf) and the natural key of the aspect partner, as
    // authored. buildWords resolves `pairKey` into the full `aspectPair` link.
    aspect: word.aspect ?? null,
    pairKey: word.pair ?? null,
    aspectPair: null,
    // Directionality of a verb of motion (`det` — one trip in one direction:
    // идти́, е́хать; `indet` — habitual, repeated or round-trip: ходи́ть,
    // е́здить) and the natural key of the other member of the pair. Both
    // members are imperfective, so `pair:`/aspect can't express the contrast —
    // it needs its own link. buildWords resolves `motionPairKey` into
    // `motionPair`, exactly as it does for the aspect partner.
    motion: word.motion ?? null,
    motionPairKey: word.motion_pair ?? null,
    motionPair: null,
    // The adjective an adverb is made from, or the adverb made from an
    // adjective — derived by linkManner, never authored.
    mannerPair: null,
    // A numeral's family: the unit it is built on, and everything built on it —
    // derived by linkNumerals from `type` + `value`, never authored.
    numeralKin: [],
    // The government frames a verb imposes on its object when it isn't the
    // plain accusative — a list of `{ prep, case }`, with `prep: null` for a
    // bare case (помога́ть + dative, ждать + genitive, горди́ться +
    // instrumental) and a preposition for a prepositional frame (зави́сеть от +
    // genitive). Powers the verb-government drill; null for ordinary
    // accusative/intransitive verbs. Verb-only: prepositions carry their own
    // array-valued `governs` in `extra`.
    governs: pos === 'verb' ? normalizeGoverns(word.governs) : null,
    // Confusable same-spelling forms whose stress carries the meaning. An
    // explicit annotation wins; otherwise buildWords fills this in for headword
    // collisions (за́мок "castle" vs замо́к "lock").
    heteronyms: normalizeHeteronyms(word.heteronyms),
    // Other learnable words that share the same base English meaning — filled in
    // by linkAmbiguousEn after all words are built.
    ambiguousEn: [],
    // Optional authored notes about the word itself — how it is built, its root,
    // its origin, a mnemonic (#585). Each fact's `see:` keys are resolved into
    // full links by linkFacts. Empty for the overwhelming majority of words:
    // facts are optional content and nothing in the app requires them.
    facts: normalizeFacts(word.facts),
    // Authored sound-alikes and false friends, as {key, why}. linkFacts resolves
    // these into `confusables` and mirrors them onto the other member, so an
    // author writes the pair once.
    confusableWith: normalizeConfusableWith(word.confusable_with),
    confusables: [],
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

/** Stem for matching a derivation: no stress, no case, ё folded onto е. */
function matchStem(word) {
  return foldYo(stripStress(word.headword || word.ru || '').toLowerCase())
}

/**
 * Link an adverb to the adjective it is made from — бы́стро ← бы́стрый (#628).
 *
 * One word in two parts of speech, and until this existed the app knew nothing
 * about it: бы́стро showed an empty facts panel, and the sound-alike shortlist
 * proposed пло́хо / плохо́й as a pair to keep *apart* — the opposite of the
 * truth. Deriving it costs nothing and fills both ends.
 *
 * The match is deliberately narrow, because `-о` is a common ending and a wrong
 * link teaches a relationship that does not exist (#614): the adverb must end
 * in `-о`, the adjective must be an entry in its own right, and the two stems
 * must be equal once stress and ё are folded away. That fold is what catches
 * легко́ ← лёгкий and тепло́ ← тёплый, where the vowel is the only difference.
 * A predicative with no adjective behind it — мо́жно, ну́жно's neighbours — finds
 * nothing and gains nothing, which is the intended outcome rather than a gap.
 *
 * Both ends are gloss-only-free: a `learn: false` entry is a hint record, and
 * in glossary.yml its key may be an inflected surface form, so linking one
 * would point the learner at something that is not a headword.
 */
function linkManner(words) {
  // stem → the adjective, or null where more than one claims it: an ambiguous
  // stem is one for a human to author, not for the build to guess at.
  const byStem = new Map()
  for (const w of words) {
    if (w.pos !== 'adjective' || w.learnable === false) continue
    const stem = matchStem(w).replace(/(ый|ий|ой)$/, '')
    if (!stem || stem === matchStem(w)) continue
    byStem.set(stem, byStem.has(stem) ? null : w)
  }

  const link = (w) => ({ key: w.key, ru: w.headword || w.ru, gloss: w.meaning || w.en })
  for (const w of words) {
    if (w.pos !== 'adverb' || w.learnable === false) continue
    const form = matchStem(w)
    if (!form.endsWith('о')) continue
    const adjective = byStem.get(form.slice(0, -1))
    if (!adjective || adjective.mannerPair) continue
    w.mannerPair = link(adjective)
    adjective.mannerPair = link(w)
  }
}

// Tens built by multiplying a unit: два́дцать, три́дцать, пятьдеся́т … девяно́сто.
// **40 is missing on purpose.** со́рок is not четы́ре times anything — it is a
// word of its own (a bundle of forty furs), and the resemblance to the pattern
// is what makes the false link tempting.
const COMPOSED_TENS = new Set([20, 30, 50, 60, 70, 80, 90])

/**
 * Link a numeral to the number it is built on, and back (#629).
 *
 * 31 of the 40 A1 numerals had nothing to show, which is absurd for the most
 * systematic set in the language: де́вять → девя́тый → девятна́дцать → девяно́сто
 * is one root four times over, and a learner drilling семна́дцать against
 * се́мьдесят is being asked to keep apart two words nobody has told them are
 * relatives.
 *
 * Derived from `type` + `value` in numerals.yml rather than from the letters,
 * which is what makes it safe: the ordinal of nine is девя́тый because both say
 * 9, not because the strings look alike.
 *
 * Four relations, three of them morphological and one functional:
 *  - `ordinal`   — девя́тый ↔ де́вять, matched on value. Functional: пе́рвый is
 *    not built out of оди́н, but it *is* the ordinal of one, and saying so is
 *    both true and the thing a learner needs;
 *  - `teen`      — девятна́дцать ↔ де́вять, nine sat on ten;
 *  - `tens`      — девяно́сто ↔ де́вять, nine tens (see COMPOSED_TENS);
 *  - `hundreds`  — две́сти ↔ два, two hundreds.
 *
 * Each entry describes the *other* word: `role: 'base'` means the other word is
 * what this one is built on, `role: 'derived'` the reverse.
 */
function linkNumerals(words) {
  const cardinals = new Map()
  const ordinals = []
  for (const w of words) {
    if (w.pos !== 'numeral' || w.learnable === false) continue
    const { type, value } = w.extra ?? {}
    if (!Number.isInteger(value)) continue
    if (type === 'cardinal') {
      if (!cardinals.has(value)) cardinals.set(value, w)
    } else if (type === 'ordinal') {
      ordinals.push([value, w])
    }
  }

  const link = (w) => ({ key: w.key, ru: w.headword || w.ru, gloss: w.meaning || w.en })
  const join = (base, derived, via) => {
    if (!base || !derived || base === derived) return
    base.numeralKin.push({ ...link(derived), via, role: 'derived' })
    derived.numeralKin.push({ ...link(base), via, role: 'base' })
  }

  for (const [value, w] of ordinals.sort((a, b) => a[0] - b[0])) {
    join(cardinals.get(value), w, 'ordinal')
  }
  for (const value of [...cardinals.keys()].sort((a, b) => a - b)) {
    const w = cardinals.get(value)
    if (value > 10 && value < 20) join(cardinals.get(value - 10), w, 'teen')
    else if (COMPOSED_TENS.has(value)) join(cardinals.get(value / 10), w, 'tens')
    else if (value > 100 && value < 1000 && value % 100 === 0) {
      join(cardinals.get(value / 100), w, 'hundreds')
    }
  }
}

/**
 * Resolve verbs' partner annotations into display-ready links: the partner's
 * accented headword, its aspect (and, for a motion pair, its directionality)
 * and its gloss. Two independent links, authored the same way:
 *   - `pair:` → `aspectPair`, the imperfective/perfective partner;
 *   - `motion_pair:` → `motionPair`, the determinate/indeterminate partner of a
 *     verb of motion (идти́ ↔ ходи́ть) — a contrast between two imperfectives,
 *     which `pair:` cannot express.
 * A dangling key resolves to nothing — the data tests enforce that partners
 * exist and are reciprocal, so silence here only ever hides an authoring typo
 * from the runtime, not from CI.
 */
function linkPartners(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const link = (partner) => ({
    key: partner.key,
    ru: partner.headword || partner.ru,
    aspect: partner.aspect,
    motion: partner.motion,
    gloss: partner.meaning || partner.en,
  })
  for (const w of words) {
    const aspect = w.pairKey ? byKey.get(w.pairKey) : null
    if (aspect) w.aspectPair = link(aspect)
    const motion = w.motionPairKey ? byKey.get(w.motionPairKey) : null
    if (motion) w.motionPair = link(motion)
    // A lexicalised participle's back-link to its verb (закры́тый → закры́ть).
    // Only the slot the adjective *is* travels with it — the word card renders
    // "past passive participle of закры́ть" from the pair.
    const verb = w.fromVerb?.key ? byKey.get(w.fromVerb.key) : null
    if (verb) {
      w.participleOf = {
        key: verb.key,
        ru: verb.headword || verb.ru,
        aspect: verb.aspect,
        gloss: verb.meaning || verb.en,
        form: w.fromVerb.form ?? null,
      }
    }
  }
}

/**
 * Resolve the authored fact links (#585) once every word exists:
 *  - each fact's `see:` keys become full `{key, ru, en, note}` links;
 *  - `confusable_with:` becomes `confusables`, **symmetrically** — an author
 *    writes the pair on one word and both ends carry it, exactly as
 *    linkHeteronyms does for stress pairs. A `why` authored on the near side
 *    wins over one mirrored from the far side.
 * A dangling key resolves to nothing; `factIssues` (wordFacts.js) is the guard
 * that fails CI on it, so silence here only ever hides a typo from the runtime.
 */
function linkFacts(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const link = (t) => ({
    key: t.key,
    ru: t.headword || t.ru,
    en: t.meaning || t.en,
    note: t.meaningNote || '',
  })

  // key → (other key → why), collected before anything is resolved so the
  // mirrored half of a pair can never be lost to iteration order.
  const pairs = new Map()
  const add = (from, to, why) => {
    if (!from || !to || from === to) return
    if (!byKey.has(from) || !byKey.has(to)) return
    if (!pairs.has(from)) pairs.set(from, new Map())
    const near = pairs.get(from)
    if (!near.get(to)) near.set(to, why)
  }
  for (const w of words) for (const c of w.confusableWith) add(w.key, c.key, c.why)
  for (const w of words) for (const c of w.confusableWith) add(c.key, w.key, c.why)

  for (const w of words) {
    for (const f of w.facts) {
      f.see = f.seeKeys
        .map((k) => byKey.get(k))
        .filter((t) => t && t !== w)
        .map(link)
    }
    w.confusables = [...(pairs.get(w.key) ?? [])].map(([k, why]) => ({
      ...link(byKey.get(k)),
      why,
    }))
  }
}

/**
 * Build the full, sorted word list from parsed vocab documents.
 * @param {Array<{pos: string, doc: object}>} files each `doc` is the parsed
 *   file object (`{ words: {...} }`), already decoded from JSON by the caller.
 * @returns {object[]}
 */
export function buildWords(files) {
  const out = []
  for (const { pos, doc } of files) {
    if (!pos) continue
    for (const [key, word] of Object.entries(doc?.words ?? {})) {
      out.push(normalizeWord(pos, key, word ?? {}))
    }
  }
  linkHeteronyms(out)
  linkAmbiguousEn(out)
  linkPartners(out)
  linkManner(out)
  linkNumerals(out)
  linkFacts(out)
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
    // Authored word facts and the resolved confusable links (#585), carried on
    // the shaped word so the drills and word panels reach them without
    // re-deriving anything. Both are empty unless the entry authors them.
    facts: w.facts ?? [],
    confusables: w.confusables ?? [],
    aspect: w.aspect ?? null,
    aspectPair: w.aspectPair ?? null,
    // Verb-of-motion directionality and its determinate/indeterminate partner
    // (идти́ ↔ ходи́ть) — shown beside the headword like the aspect pair, so the
    // two members are learned as one contrast rather than as near-synonyms.
    motion: w.motion ?? null,
    motionPair: w.motionPair ?? null,
    // For a lexicalised participle (закры́тый, при́нятый), the verb it is a
    // participle of — shown beside the headword like the aspect pair, so the
    // learner meets it as one productive pattern rather than as a stray word.
    participleOf: w.participleOf ?? null,
    // The adjective an adverb is made from, and back (бы́стро ↔ бы́стрый): one
    // word in two parts of speech, so it is learned once rather than twice.
    mannerPair: w.mannerPair ?? null,
    // A numeral's family — the unit it is built on, and everything built on it.
    numeralKin: w.numeralKin ?? [],
    // Government frames (звони́ть + dative, зави́сеть от + genitive) — shown
    // beside the headword so the frame is learned with the word rather than
    // only in the dedicated drill.
    governs: w.governs ?? null,
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
 *
 * Each phrase also carries `enNotes` — the distinctions its Russian makes that
 * its English can't (informal vs formal "you", the speaker's gender), so a
 * prompt that shows only the English can annotate the ambiguous word instead of
 * asking for a form the learner has no way to choose. See `phraseAmbiguity.js`.
 */
export function shapePhrases(words) {
  const seen = new Set()
  const out = []
  // Built from *every* word (gloss-only entries included): a surface form is
  // only evidence of person/gender if nothing else in the dictionary shares it.
  const ambiguity = buildAmbiguityIndex(words)
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
      const enNotes = phraseAmbiguities(ru, ambiguity, en)
      out.push({ id, ru, en, enAlt, source: w.key, cefr: w.cefr, enNotes })
    }
  }
  // English→Russian prompts are only answerable when the English picks out one
  // Russian sentence. Where two sentences share a prompt, `enHint` carries the
  // gloss note that tells them apart — computed here rather than per drill,
  // because whether a prompt is ambiguous is a property of the whole corpus and
  // no single phrase can know it. See lib/promptDisambiguation.js.
  const byId = new Map(out.map((p) => [p.id, p]))
  for (const [id, hint] of promptHints(out, words)) {
    const p = byId.get(id)
    if (p) p.enHint = hint
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
          // Which non-finite verb form the slot is, for a participle or gerund
          // (`act_pres`, `pass_short`, `gerund`, … — see participles.js
          // FORM_SLOTS). This is the dimension that makes a stored participle
          // reachable: without it the form is inert data, visible only as a
          // phrase hint. A long participle also carries case/gender/animate,
          // the short passive carries gender only, and the gerund is invariable.
          form: a.form ?? null,
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
