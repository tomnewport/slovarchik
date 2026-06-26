// Pure resolver for the in-context inflection drill.
//
// The drill is driven by annotated usage examples: an `inflect:` block on a
// word's usage sentence (in the vocab YAML), shaped into phrase descriptors by
// vocabBuild.shapeContextPhrases. Each is a correct, stress-marked sentence with
// one token annotated as the word being taught — its case/number (nouns,
// adjectives, pronouns) or tense/person (verbs) and an optional rule id linking
// to a grammar explanation.
//
// Because every phrase is hand-authored and correct, the required form is read
// straight off the sentence: the answer IS the annotated token. No agreement
// engine, no synthetic carriers, and the full sentence is safe to speak.
//
// Framework-free; randomness is injectable for deterministic tests.

import { normalize } from './text.js'
import { CASES, CASE_LABELS, CASE_HINTS, NUMBER_LABELS } from './declension.js'

/** Parts of speech that carry a context drill. */
export const CONTEXT_POS = Object.freeze(['noun', 'verb', 'adjective', 'pronoun'])

const GENDER_LABEL = { m: 'Masculine', n: 'Neuter', f: 'Feminine', pl: 'Plural' }
const PERSON_LABEL = {
  '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it',
  '1pl': 'we', '2pl': 'you (pl)', '3pl': 'they',
}
const PAST_LABEL = { past_m: 'he (past)', past_f: 'she (past)', past_n: 'it (past)', past_pl: 'they (past)' }
const TENSE_LABEL = { present: 'Present', future: 'Future', past: 'Past' }

/** Strip leading/trailing non-letter characters from a token (keeps inner letters). */
function wordCore(token) {
  return String(token ?? '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
}

/** Split a phrase into whitespace tokens (punctuation stays attached to its word). */
function tokenize(ru) {
  return String(ru ?? '').trim().split(/\s+/).filter(Boolean)
}

function pickOne(arr, rng) {
  return arr.length ? arr[Math.floor(rng() * arr.length)] : null
}

/**
 * Build an index from a word key to the list of phrases that teach it.
 * @param {Array} phrases context phrases (see vocabBuild.shapeContextPhrases)
 * @returns {Map<string, object[]>}
 */
export function indexPhrases(phrases) {
  const byKey = new Map()
  for (const p of phrases ?? []) {
    const key = p?.target?.key
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(p)
  }
  return byKey
}

/** Human-readable label for the grammatical slot a phrase drills. */
function slotLabelFor(target) {
  if (target.case) {
    const num = NUMBER_LABELS[target.number] ?? target.number
    const gen = target.gender ? `${GENDER_LABEL[target.gender] ?? target.gender} · ` : ''
    return `${gen}${num ? num + ' · ' : ''}${CASE_LABELS[target.case] ?? target.case}`
  }
  if (target.person) {
    const tense = TENSE_LABEL[target.tense] ?? target.tense ?? ''
    const who = PERSON_LABEL[target.person] ?? PAST_LABEL[target.person] ?? target.person
    return `${tense ? tense + ' · ' : ''}${who}`
  }
  return ''
}

/**
 * The clickable case options for step 1 (nouns / adjectives / pronouns). Each is
 * `{ case, label, hint, correct }`. Verbs return [] (no case to choose).
 */
export function caseOptions(target) {
  if (!target.case) return []
  return CASES.map((c) => ({
    case: c,
    label: CASE_LABELS[c],
    hint: CASE_HINTS[c],
    correct: c === target.case,
  }))
}

/**
 * Build a context exercise descriptor from a single annotated phrase + the word
 * record it teaches. Returns null if the annotation is malformed (token out of
 * range or empty).
 */
export function buildFromPhrase(phrase, word, { rules = {} } = {}) {
  const target = phrase?.target
  if (!target) return null
  const tokens = tokenize(phrase.ru)
  const idx = Number(target.token) - 1 // annotations are 1-based
  if (!Number.isInteger(idx) || idx < 0 || idx >= tokens.length) return null

  const origToken = tokens[idx]
  const core = wordCore(origToken)
  if (!core) return null

  // The slot shows the dictionary form before answering; surrounding punctuation
  // (e.g. a trailing full stop) is preserved.
  const lemma = word?.headword || word?.ru || core
  const leadPunct = origToken.match(/^[^\p{L}]*/u)?.[0] ?? ''
  const trailPunct = origToken.match(/[^\p{L}]*$/u)?.[0] ?? ''
  const displayToken = leadPunct + lemma + trailPunct

  const rule = target.rule ? (rules[target.rule] ?? null) : null

  return {
    kind: 'phrase-fix',
    tokens, // the correct sentence tokens
    displayTokens: tokens.map((t, i) => (i === idx ? displayToken : t)),
    targetIndex: idx,
    lemma,
    answerAccented: core,
    answer: normalize(core),
    // Step 1 (case) data — empty for verbs.
    caseOptions: caseOptions(target),
    correctCase: target.case ?? null,
    number: target.number ?? null,
    slotLabel: slotLabelFor(target),
    // The full, correct sentence — safe to speak only after a correct answer.
    ru: phrase.ru,
    en: phrase.en,
    rule: rule ? { id: target.rule, ...rule } : null,
    subject: phrase.subject ?? null,
    targets: [target.key],
  }
}

/**
 * Build a context exercise for a word, or null if none can be made.
 * @param {object} word           a normalised word record (vocabBuild)
 * @param {object} ctx
 * @param {Map}    ctx.phrasesByKey key → annotated phrases (see indexPhrases)
 * @param {object} [ctx.rules]     parsed grammar-rules.yml `rules` map
 * @param {() => number} [ctx.rng]
 */
export function buildContextExercise(word, { phrasesByKey, rules = {}, rng = Math.random } = {}) {
  if (!word || !phrasesByKey) return null
  const phrase = pickOne(phrasesByKey.get(word.key) ?? [], rng)
  if (!phrase) return null
  return buildFromPhrase(phrase, word, { rules })
}

/** Whether a context exercise can be built for a word (deterministic). */
export function canBuildContext(word, { phrasesByKey } = {}) {
  if (!word || !phrasesByKey) return false
  return (phrasesByKey.get(word.key) ?? []).length > 0
}
