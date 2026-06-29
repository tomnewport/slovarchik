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
import { shuffle } from './quiz.js'

/** Parts of speech that carry a context drill. */
export const CONTEXT_POS = Object.freeze(['noun', 'verb', 'adjective', 'pronoun'])

const GENDER_LABEL = { m: 'Masculine', n: 'Neuter', f: 'Feminine', pl: 'Plural' }
const PERSON_LABEL = {
  '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it',
  '1pl': 'we', '2pl': 'you (pl)', '3pl': 'they',
}
const PAST_LABEL = { past_m: 'he (past)', past_f: 'she (past)', past_n: 'it (past)', past_pl: 'they (past)' }
const TENSE_LABEL = { present: 'Present', future: 'Future', past: 'Past' }

/**
 * Strip leading/trailing punctuation from a token, keeping inner letters and any
 * combining marks (notably the U+0301 stress accent, which is \p{M} not \p{L}, so
 * an end-stressed form like `беру́` must not lose its mark here).
 */
function wordCore(token) {
  return String(token ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '')
}

/** Split a phrase into whitespace tokens (punctuation stays attached to its word). */
function tokenize(ru) {
  return String(ru ?? '').trim().split(/\s+/).filter(Boolean)
}

/**
 * How much more likely an exception phrase is to be drawn than a regular one.
 * Exceptions are the hard, easily-forgotten forms, so once a word carries one we
 * want it to surface more often — but not exclusively, so regular forms still
 * appear.
 */
export const EXCEPTION_WEIGHT = 4

/** Weighted pick: each item's weight comes from `weightOf(item)` (min 1). */
function weightedPick(items, weightOf, rng) {
  if (!items.length) return null
  const weights = items.map((it) => Math.max(1, weightOf(it)))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
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

/**
 * Case · gender label for an adjective slot (gender already encodes number).
 * Case leads — it's the dimension the learner picks first — with the agreeing
 * gender·number after it.
 */
function agreementLabel(gender, c) {
  return `${CASE_LABELS[c] ?? c} · ${GENDER_LABEL[gender] ?? gender}`
}

/** Human-readable label for the grammatical slot a phrase drills. */
function slotLabelFor(target) {
  if (target.case) {
    if (target.gender) return agreementLabel(target.gender, target.case)
    // Case first, then number — the order the learner reasons in.
    const num = NUMBER_LABELS[target.number] ?? target.number
    return `${CASE_LABELS[target.case] ?? target.case}${num ? ' · ' + num : ''}`
  }
  if (target.person) {
    const tense = TENSE_LABEL[target.tense] ?? target.tense ?? ''
    const who = PERSON_LABEL[target.person] ?? PAST_LABEL[target.person] ?? target.person
    return `${tense ? tense + ' · ' : ''}${who}`
  }
  return ''
}

/** Step-1 options for a noun/pronoun: pick the case (six options + hints). */
function caseStep(target) {
  return {
    kind: 'case',
    prompt: 'Which case does the highlighted word need?',
    options: CASES.map((c) => ({
      id: c,
      label: CASE_LABELS[c],
      hint: CASE_HINTS[c],
      correct: c === target.case,
    })),
  }
}

/**
 * Step-1 options for an adjective: pick the agreement (gender · case) the slot
 * demands. The correct slot plus up to three decoys drawn from the adjective's
 * own paradigm — prioritising instructive near-misses (same case other gender,
 * same gender other case) so the choice tests reading gender + case off the
 * carrier noun, not surface-form recognition.
 */
function agreementStep(target, word, rng) {
  const decl = word?.extra?.declension ?? {}
  const has = (g, c) => Boolean(decl[`${g}_${c}`])
  const all = []
  for (const g of ['m', 'n', 'f', 'pl']) {
    for (const c of CASES) {
      if (g === target.gender && c === target.case) continue
      if (!has(g, c)) continue
      all.push({ g, c })
    }
  }
  const sameCase = all.filter((s) => s.c === target.case)
  const sameGender = all.filter((s) => s.g === target.gender)
  const rest = all.filter((s) => s.c !== target.case && s.g !== target.gender)
  const ordered = [...shuffle(sameCase, rng), ...shuffle(sameGender, rng), ...shuffle(rest, rng)]
  const decoys = ordered.slice(0, 3)
  const options = [
    { id: `${target.gender}.${target.case}`, label: agreementLabel(target.gender, target.case), correct: true },
    ...decoys.map((s) => ({ id: `${s.g}.${s.c}`, label: agreementLabel(s.g, s.c), correct: false })),
  ]
  const what = word?.pos === 'pronoun' ? 'pronoun' : 'adjective'
  return { kind: 'agreement', prompt: `Which form does the ${what} need to agree with?`, options: shuffle(options, rng) }
}

/**
 * The clickable step-1 options. Nouns/pronouns pick the case; adjectives pick
 * the gender · case agreement; verbs have no step 1 (null).
 */
export function buildStep1(target, word, rng = Math.random) {
  if (!target?.case) return null
  return target.gender ? agreementStep(target, word, rng) : caseStep(target)
}

/**
 * Build a context exercise descriptor from a single annotated phrase + the word
 * record it teaches. Returns null if the annotation is malformed (token out of
 * range or empty).
 */
export function buildFromPhrase(phrase, word, { rules = {}, rng = Math.random } = {}) {
  const target = phrase?.target
  if (!target) return null
  const tokens = tokenize(phrase.ru)
  const idx = Number(target.token) - 1 // annotations are 1-based
  if (!Number.isInteger(idx) || idx < 0 || idx >= tokens.length) return null

  const origToken = tokens[idx]
  const core = wordCore(origToken)
  if (!core) return null

  // The slot shows the dictionary form before answering; the component
  // (PhraseFixExercise) re-attaches the token's surrounding punctuation around
  // the lemma / answer when it renders, so we only need the lemma here.
  const lemma = word?.headword || word?.ru || core

  const rule = target.rule ? (rules[target.rule] ?? null) : null

  return {
    kind: 'phrase-fix',
    tokens, // the correct sentence tokens
    targetIndex: idx,
    lemma,
    answerAccented: core,
    answer: normalize(core),
    // Step 1 — pick the case (noun) or the gender·case agreement (adjective);
    // null for verbs (no selection step). The component grades option.correct.
    step1: buildStep1(target, word, rng),
    number: target.number ?? null,
    slotLabel: slotLabelFor(target),
    // The full, correct sentence — safe to speak only after a correct answer.
    ru: phrase.ru,
    en: phrase.en,
    rule: rule ? { id: target.rule, ...rule } : null,
    exception: rule?.exception === true,
    subject: phrase.subject ?? null,
    targets: [target.key],
  }
}

/** Whether an annotated phrase teaches an exception/irregular form. */
function isException(phrase, rules) {
  const id = phrase?.target?.rule
  return !!id && rules[id]?.exception === true
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
  const candidates = phrasesByKey.get(word.key) ?? []
  // Bias toward exception/irregular phrases so the hard forms surface more often.
  const phrase = weightedPick(
    candidates,
    (p) => (isException(p, rules) ? EXCEPTION_WEIGHT : 1),
    rng,
  )
  if (!phrase) return null
  return buildFromPhrase(phrase, word, { rules, rng })
}

/** Whether a context exercise can be built for a word (deterministic). */
export function canBuildContext(word, { phrasesByKey } = {}) {
  if (!word || !phrasesByKey) return false
  return (phrasesByKey.get(word.key) ?? []).length > 0
}
