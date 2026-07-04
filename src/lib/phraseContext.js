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
import { CASES, CASE_LABELS, CASE_HINTS, NUMBERS, NUMBER_LABELS } from './declension.js'

/** Parts of speech that carry a context drill. */
export const CONTEXT_POS = Object.freeze(['noun', 'verb', 'adjective', 'pronoun'])

const GENDER_LABEL = { m: 'Masculine', n: 'Neuter', f: 'Feminine', pl: 'Plural' }
const PERSON_LABEL = {
  '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it',
  '1pl': 'we', '2pl': 'you (pl)', '3pl': 'they',
}
const PAST_LABEL = { past_m: 'he (past)', past_f: 'she (past)', past_n: 'it (past)', past_pl: 'they (past)' }
const IMPERATIVE_LABEL = { imp_sg: 'ты (command)', imp_pl: 'вы (command)' }
const TENSE_LABEL = { present: 'Present', future: 'Future', past: 'Past', imperative: 'Imperative' }

/** Aspect display names and the short usage cue shown on each aspect option. */
export const ASPECT_LABEL = Object.freeze({ impf: 'imperfective', pf: 'perfective' })
const ASPECT_HINT = {
  impf: 'a process, habit or repeated action',
  pf: 'a single completed action or its result',
}

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
    const who =
      PERSON_LABEL[target.person] ??
      PAST_LABEL[target.person] ??
      IMPERATIVE_LABEL[target.person] ??
      target.person
    return `${tense ? tense + ' · ' : ''}${who}`
  }
  return ''
}

/** Genders an adjective/possessive can agree with (gender already encodes number). */
const GENDERS = ['m', 'n', 'f', 'pl']

/** Selection step: pick the case (six options + hints). */
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

/** Selection step: pick the number (Singular / Plural) — nouns. */
function numberStep(target) {
  return {
    kind: 'number',
    prompt: 'Is it singular or plural?',
    options: NUMBERS.map((n) => ({
      id: n,
      label: NUMBER_LABELS[n],
      correct: n === target.number,
    })),
  }
}

/**
 * Selection step: pick the gender + number the adjective/possessive must agree
 * with (its `pl` value carries the plural, so this single choice covers number
 * too). Offers the genders the word actually declines for, falling back to all
 * four when the paradigm isn't available.
 */
function genderStep(target, word) {
  const decl = word?.extra?.declension ?? {}
  const present = GENDERS.filter((g) => CASES.some((c) => decl[`${g}_${c}`]))
  const genders = present.length ? present : GENDERS
  return {
    kind: 'gender',
    prompt: 'Which gender / number must it agree with?',
    options: genders.map((g) => ({
      id: g,
      label: GENDER_LABEL[g] ?? g,
      correct: g === target.gender,
    })),
  }
}

/**
 * Selection step: choose between the two members of an aspect pair — the drill
 * from #315. The sentence context (habit vs. single completed action, …)
 * determines which verb fits; the options are the two infinitives, imperfective
 * first, each with a one-line usage cue. The correct option is always the word
 * that owns the phrase (its usage examples are hand-authored around it).
 */
function aspectStep(word) {
  const self = { ru: word.headword || word.ru, aspect: word.aspect, correct: true }
  const partner = { ru: word.aspectPair.ru, aspect: word.aspectPair.aspect, correct: false }
  const options = [self, partner].sort((a) => (a.aspect === 'impf' ? -1 : 1))
  return {
    kind: 'aspect',
    prompt: 'Which verb does this sentence need?',
    options: options.map((o) => ({
      id: o.aspect,
      label: o.ru,
      hint: `${ASPECT_LABEL[o.aspect] ?? o.aspect} — ${ASPECT_HINT[o.aspect] ?? ''}`,
      correct: o.correct,
    })),
  }
}

/**
 * The ordered selection steps the learner works through before spelling — case
 * always first, then the other dimension:
 *   - adjectives / possessive pronouns (gender-bearing): case → gender + number
 *   - nouns: case → number (singular / plural)
 *   - personal pronouns: case only (number is fixed by the lemma — я is always
 *     singular, so there's nothing to choose)
 *   - verbs (no case): an aspect choice when the verb has a linked aspect
 *     partner (говори́ть vs сказа́ть), otherwise straight to spelling
 * Each step is `{ kind, prompt, options: [{ id, label, hint?, correct }] }`; the
 * component grades each clicked option's `correct` flag.
 */
export function buildSelectSteps(target, word) {
  if (!target?.case) {
    return target?.person && word?.aspectPair ? [aspectStep(word)] : []
  }
  if (target.gender) return [caseStep(target), genderStep(target, word)]
  if (word?.pos === 'noun') return [caseStep(target), numberStep(target)]
  return [caseStep(target)]
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

  // The slot shows the dictionary form before answering; the component
  // (PhraseFixExercise) re-attaches the token's surrounding punctuation around
  // the lemma / answer when it renders, so we only need the lemma here.
  const lemma = word?.headword || word?.ru || core

  const rule = target.rule ? (rules[target.rule] ?? null) : null
  const selectSteps = buildSelectSteps(target, word)
  const aspectSelect = selectSteps.find((s) => s.kind === 'aspect')

  return {
    kind: 'phrase-fix',
    tokens, // the correct sentence tokens
    targetIndex: idx,
    lemma,
    // With an aspect step the slot must not reveal which partner is correct, so
    // the component shows every candidate lemma (impf first) until it's chosen.
    lemmaOptions: aspectSelect ? aspectSelect.options.map((o) => o.label) : null,
    answerAccented: core,
    answer: normalize(core),
    // The ordered selection steps (aspect for paired verbs; otherwise case
    // first, then number / gender + number). The component grades each clicked
    // option's `correct`.
    selectSteps,
    number: target.number ?? null,
    slotLabel: slotLabelFor(target),
    // The full, correct sentence — safe to speak only after a correct answer.
    ru: phrase.ru,
    en: phrase.en,
    rule: rule ? { id: target.rule, ...rule } : null,
    // The generic aspect-choice explanation, shown whenever the exercise opened
    // with an aspect step (alongside any slot-specific rule).
    aspectRule:
      aspectSelect && rules['verb-aspect'] ? { id: 'verb-aspect', ...rules['verb-aspect'] } : null,
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
