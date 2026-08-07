// Gender-balance oracle for phrases with a singular personal subject
// (issues #525 first person, #541 second person).
//
// Russian marks the subject's gender on past-tense verbs (я сде́лал vs я
// сде́лала, ты уста́л vs ты уста́ла) and on predicate short adjectives (я рад vs
// я ра́да). Because the usage corpus was seeded from a mostly-masculine source,
// those examples skew heavily male — "I was at work" is masculine, and the
// handful of feminine sentences cluster on stereotyped topics. That is a
// data-integrity problem: the subject's gender is arbitrary, so the
// distribution should be even. It matters most in the second person, where the
// subject *is* the learner: «ты» phrases are the one place the corpus tells
// them what gender they are.
//
// This module is the framework-free half of the fix. It:
//   • recognises the gendered tokens in a phrase (past-tense verbs via the
//     verbs' own conjugation tables, plus a curated set of predicate forms),
//   • decides whether a masculine phrase can be *safely* rendered in the
//     feminine — only when the subject pronoun («я» or «ты») is present and the
//     phrase carries exactly one gendered token, sitting in that pronoun's own
//     clause, so flipping it can't disagree with anything else or move somebody
//     else's gender — and produces that feminine rendering from the verb's
//     stored, correctly-stressed `past_f` form (never by mutating letters,
//     which would get the mobile-stress class была́/взяла́/начала́ wrong), and
//   • measures the gender distribution across the corpus, per person.
//
// Everything is parameterised by the subject pronoun: first and second person
// behave identically for agreement purposes, so `'я'` and `'ты'` are the same
// code path with a different pronoun. The `firstPerson*`/`secondPerson*`
// exports are thin, named wrappers over it.
//
// The audit script (scripts/gender-audit.mjs) reports the distribution; the
// data migration (scripts/rebalance-gender.mjs) uses feminizeSubject to even it
// out; genderBalance.test.js pins both the behaviour and a regression floor on
// the corpus.

import { stripStress, foldYo } from './text.js'

/** Fold a surface token to a comparison key: punctuation-stripped, stress-less,
 * lower-case, ё→е. Keeps letters and combining marks only. */
function tokenKey(token) {
  const core = String(token ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '')
  return foldYo(stripStress(core)).toLowerCase()
}

/** Split a phrase into whitespace tokens (punctuation stays attached). */
function tokenize(ru) {
  return String(ru ?? '').trim().split(/\s+/).filter(Boolean)
}

/**
 * Curated predicate forms whose ending marks the subject's gender: short
 * adjectives (рад/ра́да, до́лжен/должна́) and a few gendered pronouns
 * (сам/сама́, оди́н/одна́). They are recognised so a phrase that carries one
 * counts as gendered and — crucially — so a phrase carrying a predicate *and* a
 * verb is treated as two gendered tokens and left alone by the switcher (its
 * agreement can't be flipped from the verb's paradigm alone). The lists fold to
 * comparison keys, so ё-forms (влюблён) are written plainly.
 */
const MASC_PREDICATES = new Set(
  [
    'рад', 'готов', 'должен', 'занят', 'уверен', 'согласен', 'нужен', 'женат',
    'болен', 'здоров', 'голоден', 'свободен', 'влюблен', 'сердит', 'весел',
    'прав', 'виноват', 'сыт', 'доволен', 'счастлив', 'зол', 'жив', 'полон',
    'силен', 'слаб', 'честен', 'один', 'сам', 'готов',
  ].map((w) => foldYo(w)),
)
const FEM_PREDICATES = new Set(
  [
    'рада', 'готова', 'должна', 'занята', 'уверена', 'согласна', 'нужна',
    'замужем', 'больна', 'здорова', 'голодна', 'свободна', 'влюблена',
    'сердита', 'весела', 'права', 'виновата', 'сыта', 'довольна', 'счастлива',
    'зла', 'жива', 'полна', 'сильна', 'слаба', 'честна', 'одна', 'сама',
  ].map((w) => foldYo(w)),
)

/**
 * Index the past-tense forms of every verb so a masculine past token can be
 * mapped back to its correctly-stressed feminine twin. Keys are folded past_m
 * forms; a key whose past_m form is shared by two verbs with *different*
 * feminine forms is ambiguous and dropped, so the switcher never guesses.
 *
 * @param {Array} words normalised word records (vocabBuild); verbs carry
 *   `extra.conjugation.{past_m,past_f}`
 * @returns {{ mToF: Map<string,string>, fem: Set<string> }}
 *   mToF: folded past_m key → accented past_f form; fem: folded past_f keys
 */
export function buildPastIndex(words) {
  const mToF = new Map()
  const ambiguous = new Set()
  const fem = new Set()
  for (const w of words ?? []) {
    if (w?.pos !== 'verb') continue
    const conj = w.extra?.conjugation
    const m = conj?.past_m
    const f = conj?.past_f
    if (!m || !f) continue
    const mk = tokenKey(m)
    const fk = tokenKey(f)
    if (!mk || !fk || mk === fk) continue
    fem.add(fk)
    if (ambiguous.has(mk)) continue
    const prev = mToF.get(mk)
    if (prev && tokenKey(prev) !== fk) {
      mToF.delete(mk)
      ambiguous.add(mk)
      continue
    }
    mToF.set(mk, f)
  }
  return { mToF, fem }
}

// Past-tense endings that reveal a *singular* subject's gender (so they can
// disagree with a flipped я): masculine -л/-лся, feminine -ла/-лась. Neuter -ло
// and plural -ли are gender-neutral for a first-person singular and never block.
// Used as a morphological fallback so a past-tense verb whose imperfective
// isn't a curated headword (опа́здывал — only the perfective опозда́ть is an
// entry) is still recognised as a second gendered token, and the phrase left
// alone rather than half-flipped into disagreement.
const MASC_PAST = /(?:лся|л)$/u
const FEM_PAST = /(?:лась|ла)$/u

/**
 * The gender-revealing tokens in a phrase. Each entry is
 * `{ index, gender: 'm'|'f', kind: 'verb'|'predicate'|'past', feminine? }`.
 * A `kind: 'verb'` masculine token carries `feminine` — the verb's stored
 * feminine form, the only kind the switcher will flip. `kind: 'past'` is a
 * morphologically-detected past form with no known feminine (so it can block a
 * flip but never be one). Predicate forms come from the curated lists.
 * @param {string} ru
 * @param {{ mToF: Map, fem: Set }} pastIndex
 */
export function genderedTokens(ru, pastIndex) {
  const { mToF, fem } = pastIndex ?? { mToF: new Map(), fem: new Set() }
  const out = []
  tokenize(ru).forEach((tok, index) => {
    const k = tokenKey(tok)
    if (!k) return
    if (MASC_PREDICATES.has(k)) out.push({ index, gender: 'm', kind: 'predicate' })
    else if (FEM_PREDICATES.has(k)) out.push({ index, gender: 'f', kind: 'predicate' })
    else if (mToF.has(k)) out.push({ index, gender: 'm', kind: 'verb', feminine: mToF.get(k) })
    else if (fem.has(k)) out.push({ index, gender: 'f', kind: 'verb' })
    else if (k.length >= 3 && FEM_PAST.test(k)) out.push({ index, gender: 'f', kind: 'past' })
    else if (k.length >= 3 && MASC_PAST.test(k)) out.push({ index, gender: 'm', kind: 'past' })
  })
  return out
}

/**
 * The singular personal subject pronouns this module balances. Both agree the
 * same way — a past-tense verb after «ты» marks the addressee's gender exactly
 * as one after «я» marks the speaker's — so the pronoun is a parameter
 * everywhere rather than a second copy of the logic.
 */
export const FIRST_PERSON = 'я'
export const SECOND_PERSON = 'ты'
const PRONOUNS = [FIRST_PERSON, SECOND_PERSON]

/** Cache of the "standalone subject pronoun" matchers, keyed by pronoun. */
const subjectRes = new Map()

/**
 * A matcher for `pronoun` standing alone as a word: preceded by the start of
 * the phrase, whitespace or an opening quote/bracket/dash, and followed by
 * whitespace, punctuation or the end. Keeps «я» out of the middle of по-япо́нски
 * and «ты» out of the middle of ты́сяча.
 */
function subjectRe(pronoun) {
  let re = subjectRes.get(pronoun)
  if (!re) {
    const head = pronoun.charAt(0)
    const tail = pronoun.slice(1)
    re = new RegExp(
      `(?:^|[\\s"«„(–—-])[${head}${head.toUpperCase()}]${tail}(?=[\\s,.!?…:;»")]|$)`,
      'u',
    )
    subjectRes.set(pronoun, re)
  }
  return re
}

/** Whether `pronoun` («я» / «ты») stands alone as a subject token in the phrase. */
export function hasSubjectPronoun(ru, pronoun = FIRST_PERSON) {
  return subjectRe(pronoun).test(String(ru ?? ''))
}

/** Whether «я» is a standalone subject token in the phrase (not part of a word). */
export function isFirstPersonSingular(ru) {
  return hasSubjectPronoun(ru, FIRST_PERSON)
}

/** Whether «ты» is a standalone subject token in the phrase (not part of a word). */
export function isSecondPersonSingular(ru) {
  return hasSubjectPronoun(ru, SECOND_PERSON)
}

/**
 * The gender of `pronoun`'s referent in the phrase, or null when the pronoun is
 * not its subject or the phrase carries no gendered token. Returns `'mixed'`
 * when both a masculine and a feminine marker appear (rare, e.g. reported
 * speech).
 *
 * Deliberately whole-phrase rather than clause-scoped: this is the *counting*
 * side, where over-detection only ever makes the measured skew look worse than
 * it is. The flip side ({@link feminizeSubject}) is the strict one.
 *
 * @returns {'m'|'f'|'mixed'|null}
 */
export function subjectGender(ru, pastIndex, pronoun = FIRST_PERSON) {
  if (!hasSubjectPronoun(ru, pronoun)) return null
  const toks = genderedTokens(ru, pastIndex)
  const hasM = toks.some((t) => t.gender === 'm')
  const hasF = toks.some((t) => t.gender === 'f')
  if (hasM && hasF) return 'mixed'
  if (hasM) return 'm'
  if (hasF) return 'f'
  return null
}

/** The speaker's gender in a first-person («я …») phrase. @see subjectGender */
export function firstPersonGender(ru, pastIndex) {
  return subjectGender(ru, pastIndex, FIRST_PERSON)
}

/** The addressee's gender in a second-person («ты …») phrase. @see subjectGender */
export function secondPersonGender(ru, pastIndex) {
  return subjectGender(ru, pastIndex, SECOND_PERSON)
}

/** Re-attach `original`'s surrounding punctuation and leading capital to `form`. */
function reclothe(original, form) {
  const lead = original.match(/^[^\p{L}\p{M}]*/u)[0]
  const tail = original.match(/[^\p{L}\p{M}]*$/u)[0]
  const capitalised = /^\p{Lu}/u.test(original.replace(/^[^\p{L}\p{M}]*/u, ''))
  const body = capitalised ? form.charAt(0).toUpperCase() + form.slice(1) : form
  return lead + body + tail
}

// Punctuation that ends a clause when it trails a token, and that opens one
// when it leads a token. Used to keep a flip inside the clause its subject
// pronoun stands in: in «Ты зна́ешь, что он сде́лал?» the masculine сде́лал is
// the *third* person's, and flipping it would be a mistranslation rather than a
// rebalance. Mirrors the clause split in phraseAmbiguity.js, which annotates the
// same agreement for the learner.
const CLAUSE_END = /[,;:.!?…)\]»"'—–]$/u
const CLAUSE_START = /^[«"'([—–]/u

/** The token index ranges `[start, end)` of each clause of a tokenised phrase. */
function clauseSpans(tokens) {
  const spans = []
  let start = 0
  for (let i = 0; i < tokens.length; i++) {
    if (i > start && CLAUSE_START.test(tokens[i])) {
      spans.push([start, i])
      start = i
    }
    if (CLAUSE_END.test(tokens[i])) {
      spans.push([start, i + 1])
      start = i + 1
    }
  }
  if (start < tokens.length) spans.push([start, tokens.length])
  return spans
}

/**
 * A feminine rendering of a masculine phrase whose subject is `pronoun` («я» or
 * «ты»), or null when it can't be produced *safely*. Safe means all of:
 *
 *  - `pronoun` stands alone as a subject in the phrase;
 *  - the phrase has exactly one gendered token, and it is a masculine
 *    past-tense verb with a known feminine form (so nothing else can fall out
 *    of agreement, and the new form comes from stored data rather than a
 *    letter rule);
 *  - that token sits in the same clause as `pronoun`, and the *other* personal
 *    pronoun («ты» for a «я» flip, and vice versa) is not in that clause — so
 *    the gender being moved is demonstrably this subject's and no one else's.
 *
 * Anything with a second gendered word (я был рад), a predicate-only gender, or
 * an already-feminine subject returns null.
 *
 * @param {string} ru
 * @param {{ mToF: Map, fem: Set }} pastIndex from {@link buildPastIndex}
 * @param {string} pronoun the subject pronoun to feminise agreement for
 * @returns {{ ru: string, index: number } | null} the feminised phrase and the
 *   token index that changed (for updating an `inflect` annotation), or null
 */
export function feminizeSubject(ru, pastIndex, pronoun = FIRST_PERSON) {
  if (!hasSubjectPronoun(ru, pronoun)) return null
  const toks = genderedTokens(ru, pastIndex)
  if (toks.length !== 1) return null
  const t = toks[0]
  if (t.gender !== 'm' || t.kind !== 'verb' || !t.feminine) return null

  const tokens = tokenize(ru)
  // The verb and its subject must share a clause, and that clause must not also
  // hold the other person's pronoun (whose agreement we would be rewriting).
  const others = PRONOUNS.filter((p) => p !== pronoun)
  const span = clauseSpans(tokens).find(([from, to]) => t.index >= from && t.index < to)
  if (!span) return null
  const clause = tokens.slice(span[0], span[1]).join(' ')
  if (!hasSubjectPronoun(clause, pronoun)) return null
  if (others.some((p) => hasSubjectPronoun(clause, p))) return null

  tokens[t.index] = reclothe(tokens[t.index], t.feminine)
  return { ru: tokens.join(' '), index: t.index }
}

/** A feminine rendering of a masculine «я …» phrase. @see feminizeSubject */
export function feminizeFirstPerson(ru, pastIndex) {
  return feminizeSubject(ru, pastIndex, FIRST_PERSON)
}

/** A feminine rendering of a masculine «ты …» phrase. @see feminizeSubject */
export function feminizeSecondPerson(ru, pastIndex) {
  return feminizeSubject(ru, pastIndex, SECOND_PERSON)
}

/**
 * Gender distribution of `pronoun`'s referent across a set of word records'
 * usage examples. `switchable` counts the masculine phrases
 * {@link feminizeSubject} can safely flip — the pool the migration draws from.
 * `subject` is how many phrases have `pronoun` as a subject at all (gendered or
 * not).
 * @param {Array} words normalised word records (vocabBuild)
 * @param {string} pronoun the subject pronoun to measure
 * @returns {{ masculine: number, feminine: number, mixed: number,
 *   subject: number, switchable: number }}
 */
export function subjectGenderStats(words, pronoun = FIRST_PERSON) {
  const pastIndex = buildPastIndex(words)
  const stat = { masculine: 0, feminine: 0, mixed: 0, subject: 0, switchable: 0 }
  for (const w of words ?? []) {
    if (w?.learnable === false) continue
    for (const ex of w.usage ?? []) {
      const ru = ex?.ru
      if (!hasSubjectPronoun(ru, pronoun)) continue
      stat.subject++
      const g = subjectGender(ru, pastIndex, pronoun)
      if (g === 'm') stat.masculine++
      else if (g === 'f') stat.feminine++
      else if (g === 'mixed') stat.mixed++
      if (feminizeSubject(ru, pastIndex, pronoun)) stat.switchable++
    }
  }
  return stat
}

/**
 * First-person gender distribution. `firstPerson` is kept as an alias of
 * `subject` so existing callers keep reading.
 * @see subjectGenderStats
 */
export function firstPersonGenderStats(words) {
  const stat = subjectGenderStats(words, FIRST_PERSON)
  return { ...stat, firstPerson: stat.subject }
}

/**
 * Second-person gender distribution — the addressee's, i.e. the learner's.
 * `secondPerson` mirrors `firstPerson` above.
 * @see subjectGenderStats
 */
export function secondPersonGenderStats(words) {
  const stat = subjectGenderStats(words, SECOND_PERSON)
  return { ...stat, secondPerson: stat.subject }
}
