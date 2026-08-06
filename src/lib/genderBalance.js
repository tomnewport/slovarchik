// Gender-balance oracle for first-person phrases (issue #525).
//
// Russian marks the speaker's gender on past-tense verbs (я сде́лал vs я
// сде́лала) and on predicate short adjectives (я рад vs я ра́да). Because the
// usage corpus was seeded from a mostly-masculine source, first-person examples
// skew heavily male — "I was at work" is masculine, and the handful of feminine
// sentences cluster on stereotyped topics. That is a data-integrity problem: the
// speaker's gender is arbitrary, so the distribution should be even.
//
// This module is the framework-free half of the fix. It:
//   • recognises the gendered tokens in a phrase (past-tense verbs via the
//     verbs' own conjugation tables, plus a curated set of predicate forms),
//   • decides whether a first-person masculine phrase can be *safely* rendered
//     in the feminine — only when «я» is the subject and the phrase carries
//     exactly one gendered token, so flipping it can't disagree with anything
//     else — and produces that feminine rendering from the verb's stored,
//     correctly-stressed `past_f` form (never by mutating letters, which would
//     get the mobile-stress class была́/взяла́/начала́ wrong), and
//   • measures the first-person gender distribution across the corpus.
//
// The audit script (scripts/gender-audit.mjs) reports the distribution; the
// data migration (scripts/rebalance-gender.mjs) uses feminizeFirstPerson to
// even it out; genderBalance.test.js pins both the behaviour and a regression
// floor on the corpus.

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
 * Curated first-person predicate forms whose ending marks the speaker's gender:
 * short adjectives (рад/ра́да, до́лжен/должна́) and a few gendered pronouns
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

/** Whether «я» is a standalone subject token in the phrase (not part of a word). */
export function isFirstPersonSingular(ru) {
  return /(^|[\s"«„(–—-])[яЯ](?=[\s,.!?…:;»")]|$)/u.test(String(ru ?? ''))
}

/**
 * The speaker's gender in a first-person phrase, or null when the phrase is not
 * first-person or carries no gendered token. Returns `'mixed'` when both a
 * masculine and a feminine marker appear (rare, e.g. reported speech).
 * @returns {'m'|'f'|'mixed'|null}
 */
export function firstPersonGender(ru, pastIndex) {
  if (!isFirstPersonSingular(ru)) return null
  const toks = genderedTokens(ru, pastIndex)
  const hasM = toks.some((t) => t.gender === 'm')
  const hasF = toks.some((t) => t.gender === 'f')
  if (hasM && hasF) return 'mixed'
  if (hasM) return 'm'
  if (hasF) return 'f'
  return null
}

/** Re-attach `original`'s surrounding punctuation and leading capital to `form`. */
function reclothe(original, form) {
  const lead = original.match(/^[^\p{L}\p{M}]*/u)[0]
  const tail = original.match(/[^\p{L}\p{M}]*$/u)[0]
  const capitalised = /^\p{Lu}/u.test(original.replace(/^[^\p{L}\p{M}]*/u, ''))
  const body = capitalised ? form.charAt(0).toUpperCase() + form.slice(1) : form
  return lead + body + tail
}

/**
 * A feminine rendering of a first-person masculine phrase, or null when it
 * can't be produced *safely*. Safe means: «я» is the subject, and the phrase
 * has exactly one gendered token, and that token is a masculine past-tense verb
 * with a known feminine form. Anything with a second gendered word (я был рад,
 * two clauses), a predicate-only gender, or an already-feminine subject returns
 * null — the switcher never touches a form it can't derive from stored data.
 *
 * @param {string} ru
 * @param {{ mToF: Map, fem: Set }} pastIndex from {@link buildPastIndex}
 * @returns {{ ru: string, index: number } | null} the feminised phrase and the
 *   token index that changed (for updating an `inflect` annotation), or null
 */
export function feminizeFirstPerson(ru, pastIndex) {
  if (!isFirstPersonSingular(ru)) return null
  const toks = genderedTokens(ru, pastIndex)
  if (toks.length !== 1) return null
  const t = toks[0]
  if (t.gender !== 'm' || t.kind !== 'verb' || !t.feminine) return null
  const tokens = tokenize(ru)
  tokens[t.index] = reclothe(tokens[t.index], t.feminine)
  return { ru: tokens.join(' '), index: t.index }
}

/**
 * First-person gender distribution across a set of word records' usage
 * examples. `switchable` counts the masculine phrases {@link feminizeFirstPerson}
 * can safely flip — the pool the migration draws from.
 * @param {Array} words normalised word records (vocabBuild)
 * @returns {{ masculine: number, feminine: number, mixed: number,
 *   firstPerson: number, switchable: number }}
 */
export function firstPersonGenderStats(words) {
  const pastIndex = buildPastIndex(words)
  const stat = { masculine: 0, feminine: 0, mixed: 0, firstPerson: 0, switchable: 0 }
  for (const w of words ?? []) {
    if (w?.learnable === false) continue
    for (const ex of w.usage ?? []) {
      const ru = ex?.ru
      if (!isFirstPersonSingular(ru)) continue
      stat.firstPerson++
      const g = firstPersonGender(ru, pastIndex)
      if (g === 'm') stat.masculine++
      else if (g === 'f') stat.feminine++
      else if (g === 'mixed') stat.mixed++
      if (feminizeFirstPerson(ru, pastIndex)) stat.switchable++
    }
  }
  return stat
}
