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
 * @param {object[]} words  normalised word records (from buildWords)
 * @returns {Map<string, string|null>}  normalised form → tag, or null if ambiguous
 */
export function buildAmbiguityIndex(words) {
  const index = new Map()
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
    }
    for (const [form, tag] of marked) claim(index, form, tag)
    for (const form of wordForms(w)) {
      if (!marked.has(form)) claim(index, form, OTHER)
    }
  }
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
 * Which distinctions a Russian phrase makes that its English translation can't.
 * Returns note ids (see {@link NOTES}) in display order, or an empty array when
 * the Russian commits to nothing the English hides.
 *
 * @param {string} ru                        the Russian phrase
 * @param {Map<string, string|null>} index   from {@link buildAmbiguityIndex}
 * @returns {string[]}
 */
export function phraseAmbiguities(ru, index) {
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
