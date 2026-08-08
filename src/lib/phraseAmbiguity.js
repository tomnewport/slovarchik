// Pure, framework-free detection of what a Russian phrase says that its English
// translation cannot. English collapses distinctions Russian marks, so a learner
// asked to translate "Do you want tea?" into Russian has no way of knowing
// whether the answer wants ты or вы — and "I was tired" gives no clue whether to
// write уста́л or уста́ла. The prompt has to say. This module works out, from the
// Russian side of a phrase, which of those distinctions it commits to, so the
// English prompt can carry a small annotation on the ambiguous word:
//
//   Do you (informal) want tea?        ← хо́чешь, not хоти́те
//   I (male speaker) bought a ticket.  ← я купи́л, not купи́ла
//
// Detection is **marker-driven**: a note is produced only when the Russian
// actually commits to a reading. A generic English "you" with no ты/вы marker
// behind it («Здесь мо́жно комфо́ртно рабо́тать» — "You can work comfortably
// here") gets nothing, which is right: nothing is being hidden from the learner.
//
// Two evidence sources feed it:
//
//  1. The **closed class** of 2nd-person pronouns and possessives (ты/вы and
//     твой/ваш with all their case forms). Closed-class means the list below is
//     the whole of Russian — it can be written out and never goes stale.
//  2. The **corpus itself**: verbs carry full conjugation tables and adjectives
//     carry short forms, so every 2sg/2pl/imperative/past-masculine/past-feminine
//     surface form in the dictionary is known. A surface form only counts as
//     evidence when it is *unambiguous across the whole dictionary* — «мой» is
//     both "my" and the imperative of мыть, so it proves nothing and is ignored.
//
// Russian also drops the subject freely, and a dropped «я» still leaves its
// gender behind on the predicate — «Ра́да была́ помо́чь» is a woman speaking with
// no pronoun anywhere to hang that on. {@link ellipticalSpeaker} recovers those,
// but only under conditions narrow enough that nothing else in the sentence
// could own the agreement instead. See its comment for why the bar is so high.
//
// `genderBalance.js` also reads gender out of a phrase, but for the opposite
// job and with the opposite bias, so the two deliberately stay separate. That
// one is a build-time oracle deciding whether a masculine sentence is safe to
// flip to feminine, so it *over*-detects — any token ending in -л/-ла counts,
// «стол» and «шко́ла» included — because a false positive there only blocks a
// flip. This one writes on the learner's screen, so it must *under*-detect: only
// forms the dictionary confirms, and only where nothing else can claim them.
import { normToken, wordForms } from './phraseHint.js'
import { phraseTokens } from './phrases.js'

/**
 * Every case form of ты and твой — the informal ("T") side of the T–V
 * distinction. A closed class: this is the complete list.
 */
const TY_FORMS = new Set([
  'ты', 'тебя', 'тебе', 'тобой', 'тобою',
  'твой', 'твоя', 'твое', 'твои', 'твоего', 'твоей', 'твоему', 'твоим',
  'твоих', 'твоими', 'твою', 'твоем', 'твоею',
])

/**
 * Every case form of вы and ваш — the formal/plural ("V") side. Note вы is
 * itself two-ways ambiguous (one person politely, or several people), which is
 * why its note says "formal or plural" rather than picking one.
 */
const VY_FORMS = new Set([
  'вы', 'вас', 'вам', 'вами',
  'ваш', 'ваша', 'ваше', 'ваши', 'вашего', 'вашей', 'вашему', 'вашим',
  'ваших', 'вашими', 'вашу', 'вашем',
])

/** The nominative subject pronouns whose agreement reveals a person's gender. */
const YA = 'я'
const TY = 'ты'

/**
 * Nominative pronouns that can stand alone as the subject of a singular
 * masculine or feminine predicate — i.e. that could own the gender agreement a
 * dropped «я» would otherwise explain. Plurals (мы, вы, они) are left out
 * because they take the plural short form («мы гото́вы»), never the m/f one, and
 * neuters (оно́, э́то, всё, что) for the same reason.
 */
const THIRD_PERSON_NOM = new Set(['он', 'она', 'кто', 'ктото', 'никто', 'некто'])

/**
 * The first person as an English *subject*. Deliberately only the nominative
 * pronoun: it is what an elided Russian subject corresponds to, and it is the
 * word the resulting note gets pinned to. Case-sensitive — a lowercase "i" is
 * not the pronoun.
 */
const FIRST_PERSON_SUBJECT = /\bI\b/

// Tags a surface form can carry in the ambiguity index. A form that could be
// two different things across the dictionary is stored as `null` (ambiguous)
// and never used as evidence.
const SECOND_SG = '2sg' // a ты-form: 2nd person singular, or the sg imperative
const SECOND_PL = '2pl' // a вы-form: 2nd person plural, or the pl imperative
const MASC = 'm' // masculine agreement: past masculine, or a short adjective
const FEM = 'f' // feminine agreement
const OTHER = 'other' // a form that proves nothing about person or gender

/** Note ids, in the order they read best when several apply to one word. */
const NOTES = {
  'you-informal': { anchor: 'you', short: 'informal', long: 'informal “you”' },
  'you-formal': { anchor: 'you', short: 'formal or plural', long: 'formal or plural “you”' },
  'addressee-m': { anchor: 'you', short: 'to a man', long: 'speaking to a man' },
  'addressee-f': { anchor: 'you', short: 'to a woman', long: 'speaking to a woman' },
  'speaker-m': { anchor: 'i', short: 'male speaker', long: 'a man speaking' },
  'speaker-f': { anchor: 'i', short: 'female speaker', long: 'a woman speaking' },
}

/**
 * The English words an annotation can attach itself to, per anchor, in order of
 * preference: the bare pronoun reads best ("You (informal) chose…"), so a
 * possessive or object form is only used when the pronoun itself is absent
 * ("Enter your (formal or plural) password."). "I" is matched case-sensitively —
 * a lowercase "i" is not the pronoun.
 */
const ANCHORS = {
  you: [/\byou\b/i, /\b(your|yours|yourself|yourselves)\b/i],
  i: [/\bI\b/, /\b(me|my|mine|myself)\b/i],
}

/** Note ids in display order, so annotations read consistently. */
const NOTE_ORDER = Object.keys(NOTES)

/**
 * Record `tag` for a surface form, degrading to `null` (ambiguous) as soon as
 * two different tags claim the same form anywhere in the dictionary.
 */
function claim(index, form, tag) {
  if (!form) return
  const prev = index.get(form)
  if (prev === undefined) index.set(form, tag)
  else if (prev !== tag) index.set(form, null)
}

/**
 * Index every surface form in the dictionary by what it proves about person or
 * gender. Built once from the whole word list (all parts of speech), because a
 * form is only usable evidence if *nothing else* in Russian shares it.
 *
 * Two companion sets ride along on the returned Map, both needed only by
 * {@link ellipticalSpeaker}:
 *
 *  - `.shortPredicates` — the forms that came from an adjective's `short` block
 *    and survived as unambiguous evidence. A short form *is* a predicate on its
 *    own, so it can carry the agreement of a subject that was never uttered;
 *    a past-tense verb can too, but only these are safe enough to act on.
 *  - `.subjects` — the forms that could be the nominative subject some other
 *    reading of the sentence hangs its agreement on: every masculine or
 *    feminine noun's nominative singular, plus {@link THIRD_PERSON_NOM}.
 *
 * Membership of the index itself doubles as "the dictionary knows this word",
 * since `glossary.yml` (a harvest of surface forms, see below) never enters it.
 *
 * @param {object[]} words  normalised word records (from buildWords)
 * @returns {Map<string, string|null> & {shortPredicates: Set<string>, subjects: Set<string>}}
 *   normalised form → tag, or null if ambiguous
 */
export function buildAmbiguityIndex(words) {
  const index = new Map()
  const shortCandidates = new Set()
  const subjects = new Set(THIRD_PERSON_NOM)
  for (const w of words ?? []) {
    // `glossary.yml` is a harvest of *surface forms* taken from the phrases
    // themselves ("беги́=run", "прочита́йте=read"), not a list of independent
    // words. Counting them would have every imperative collide with its own
    // gloss entry and cancel itself out, so they never lay a claim.
    if (w?.pos === 'glossary') continue
    // The slots this word fills that carry person/gender information. Collected
    // per word first so a word's own other forms can't shout them down: only
    // *another* word laying a different claim makes a form ambiguous.
    const marked = new Map()
    const mark = (form, tag) => {
      const key = normToken(form)
      // Multi-word cells (some imperatives are written as a phrase) can never
      // match a single phrase token — skip them rather than index a fragment.
      if (!key || /\s/.test(String(form).trim())) return
      if (!marked.has(key)) marked.set(key, tag)
    }
    if (w?.pos === 'verb') {
      const c = w.extra?.conjugation ?? {}
      for (const tense of ['present', 'future']) {
        mark(c[tense]?.['2sg'], SECOND_SG)
        mark(c[tense]?.['2pl'], SECOND_PL)
      }
      mark(c.imperative?.sg, SECOND_SG)
      mark(c.imperative?.pl, SECOND_PL)
      mark(c.past_m, MASC)
      mark(c.past_f, FEM)
    } else if (w?.pos === 'adjective') {
      // Only the *short* (predicate) forms mark the subject's gender in a way
      // English drops — «я гото́в» / «я гото́ва». Long forms agree with a noun
      // that the English names anyway.
      mark(w.extra?.short?.m, MASC)
      mark(w.extra?.short?.f, FEM)
      for (const [form, tag] of marked) {
        if (tag === MASC || tag === FEM) shortCandidates.add(form)
      }
    } else if (w?.pos === 'noun' && (w.gender === 'm' || w.gender === 'f')) {
      // The nominative singular is the slot a subject stands in; anything else
      // in the paradigm is an object or an adverbial and agrees with nothing.
      const nom = normToken(w.forms?.sg?.nom)
      if (nom) subjects.add(nom)
    }
    for (const [form, tag] of marked) claim(index, form, tag)
    for (const form of wordForms(w)) {
      if (!marked.has(form)) claim(index, form, OTHER)
    }
  }
  // A short form shared with anything else in the dictionary has already been
  // degraded to `null` above — «дорога́» is "dear" only until «доро́га» "road"
  // is added — so filtering by the surviving tag keeps the set honest.
  index.shortPredicates = new Set(
    [...shortCandidates].filter((f) => index.get(f) === MASC || index.get(f) === FEM),
  )
  index.subjects = subjects
  return index
}

/**
 * Split a phrase into clauses of normalised tokens. Gender agreement is only
 * evidence about the speaker when it sits in the *same clause* as «я» — in
 * «Е́сли бы дверь хло́пнула, я бы вздро́гнул» the feminine хло́пнула belongs to
 * the door, not the speaker — so clause boundaries are where the search stops.
 */
function clausesOf(ru) {
  return String(ru ?? '')
    .split(/[,;:.!?…()[\]«»"'—–]+/u)
    .map((clause) => phraseTokens(clause).map(normToken).filter(Boolean))
    .filter((clause) => clause.length > 0)
}

/** The single gender every gender-marked token in a clause agrees on, if any. */
function clauseGender(clause, index) {
  const seen = new Set()
  for (const token of clause) {
    const tag = index?.get(token)
    if (tag === MASC || tag === FEM) seen.add(tag)
  }
  return seen.size === 1 ? [...seen][0] : null
}

/**
 * The speaker's gender read off a clause whose subject was dropped — the case
 * «Не́ за что, ра́да была́ помо́чь» ("You're welcome, I was glad to help"), where
 * ра́да is the only thing saying a woman is speaking and there is no pronoun to
 * attach it to. Returns `MASC`/`FEM`, or null when the reading isn't safe.
 *
 * Everything here is a guard, because the failure mode is expensive: annotate a
 * phrase whose gendered word belongs to something else in the sentence and the
 * prompt teaches the wrong form. «Мне ну́жен слова́рь» is first-person, dative and
 * masculine, and none of that is about the speaker — ну́жен agrees with слова́рь.
 * So all of the following must hold:
 *
 *  - The gendered word is a **short adjective** (`.shortPredicates`). A short
 *    form is a complete predicate; a past-tense verb usually has a subject
 *    somewhere, and admitting those is what makes the дативные sentences leak.
 *  - The clause names **neither я nor ты** — those the pronoun rule above
 *    already reads, and better — and carries **no 2nd-person verb form**, which
 *    would make the dropped subject the addressee rather than the speaker.
 *  - **Nothing in the whole sentence could own the agreement instead**: no
 *    nominative m/f noun, no 3rd-person pronoun, and no word the dictionary
 *    doesn't know — an unknown token is most often exactly the noun that owns
 *    it («Сейча́с приёмная за́ла полна́»), so it counts against us too.
 *  - Every candidate clause agrees on one gender.
 *
 * The English is consulted for the same reason (see {@link phraseAmbiguities}):
 * an elided Russian subject that the English renders as "I" is the speaker.
 */
function ellipticalSpeaker(clauses, index) {
  const shorts = index?.shortPredicates
  if (!shorts?.size) return null
  const candidates = clauses.filter(
    (clause) =>
      !clause.includes(YA) &&
      !clause.includes(TY) &&
      !clause.some((t) => index.get(t) === SECOND_SG || index.get(t) === SECOND_PL) &&
      clause.some((t) => shorts.has(t)),
  )
  if (!candidates.length) return null
  const contested = (t) => !index.has(t) || index.subjects?.has(t)
  if (clauses.flat().some(contested)) return null
  const genders = new Set(candidates.map((clause) => clauseGender(clause, index)))
  return genders.size === 1 ? ([...genders][0] ?? null) : null
}

/**
 * Which distinctions a Russian phrase makes that its English translation can't.
 * Returns note ids (see {@link NOTES}) in display order, or an empty array when
 * the Russian commits to nothing the English hides.
 *
 * The English is read for one narrow purpose and never as evidence about
 * Russian grammar: a clause whose subject Russian dropped only tells us about
 * *the speaker* if the sentence is about the speaker, and an English "I" is
 * what says so. Omit `en` and that last rule simply doesn't fire; everything
 * else is decided on the Russian side alone.
 *
 * @param {string} ru                        the Russian phrase
 * @param {Map<string, string|null>} index   from {@link buildAmbiguityIndex}
 * @param {string} [en]                      its English translation
 * @returns {string[]}
 */
export function phraseAmbiguities(ru, index, en = '') {
  const clauses = clausesOf(ru)
  if (!clauses.length) return []
  const tokens = clauses.flat()
  const tagOf = (token) => index?.get(token)

  const ids = new Set()

  // T–V. A phrase that somehow marks both (reported speech, two addressees) is
  // left alone: we'd be guessing which one the answer needs.
  const informal = tokens.some((t) => TY_FORMS.has(t) || tagOf(t) === SECOND_SG)
  const formal = tokens.some((t) => VY_FORMS.has(t) || tagOf(t) === SECOND_PL)
  if (informal && !formal) ids.add('you-informal')
  if (formal && !informal) ids.add('you-formal')

  // Gender of the speaker (я …) and of the person addressed (ты …), read off
  // the agreement in whichever clause the pronoun stands in. Only the
  // nominative counts: «меня́»/«тебя́» are objects, and the past tense agrees
  // with the subject.
  let speaker = null
  let addressee = null
  for (const clause of clauses) {
    const gender = clauseGender(clause, index)
    if (!gender) continue
    if (clause.includes(YA)) speaker = speaker && speaker !== gender ? 'x' : gender
    if (clause.includes(TY)) addressee = addressee && addressee !== gender ? 'x' : gender
  }
  // …and, failing that, off a clause whose «я» was dropped — but only when the
  // English names the speaker as its subject. See {@link ellipticalSpeaker}.
  if (!speaker && FIRST_PERSON_SUBJECT.test(String(en ?? ''))) {
    speaker = ellipticalSpeaker(clauses, index)
  }

  if (speaker === MASC) ids.add('speaker-m')
  if (speaker === FEM) ids.add('speaker-f')
  if (addressee === MASC) ids.add('addressee-m')
  if (addressee === FEM) ids.add('addressee-f')

  return NOTE_ORDER.filter((id) => ids.has(id))
}

/**
 * Lay an English prompt out with its annotations attached: each note is pinned
 * to the English word it disambiguates ("you", "I", …) and notes that find no
 * word to pin to trail the phrase instead — a bare imperative («Прочита́йте
 * пе́рвый абза́ц» → "Read the first paragraph.") names no one, but the learner
 * still has to know the command is the вы one.
 *
 * @param {string} en        the English translation
 * @param {string[]} ids     note ids from {@link phraseAmbiguities}
 * @returns {{parts: Array<{text: string, note: string}>, trailing: string[]}}
 */
export function annotateEnglish(en, ids = []) {
  const text = String(en ?? '')
  const notes = (ids ?? []).map((id) => NOTES[id]).filter(Boolean)
  if (!notes.length || !text) return { parts: [{ text, note: '' }], trailing: [] }

  const trailing = []
  const hits = []
  for (const anchor of Object.keys(ANCHORS)) {
    const group = notes.filter((n) => n.anchor === anchor)
    if (!group.length) continue
    const match = ANCHORS[anchor].reduce((found, re) => found ?? re.exec(text), null)
    if (match) {
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        note: group.map((n) => n.short).join(', '),
      })
    } else {
      trailing.push(...group.map((n) => n.long))
    }
  }
  hits.sort((a, b) => a.start - b.start)

  const parts = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start), note: '' })
    parts.push({ text: text.slice(hit.start, hit.end), note: hit.note })
    cursor = hit.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), note: '' })
  return { parts, trailing }
}
