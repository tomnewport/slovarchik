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
import { sample, shuffle } from './quiz.js'
import { CASES, LOCATIVE, CASE_LABELS, CASE_HINTS, NUMBERS, NUMBER_LABELS } from './declension.js'
import { GOVERNMENT_RULES } from './verbGovernment.js'
import {
  FORM_HINT,
  FORM_LABEL,
  FORM_SLOTS,
  PASSIVE_SLOTS,
  plausibleSlots,
  shortPassiveCell,
  storedSlots,
} from './participles.js'

/** Parts of speech that carry a context drill. */
export const CONTEXT_POS = Object.freeze(['noun', 'verb', 'adjective', 'pronoun'])

const GENDER_LABEL = { m: 'Masculine', n: 'Neuter', f: 'Feminine', pl: 'Plural' }
/** Degrees of comparison, in the order the board offers them. */
const DEGREES = ['positive', 'comparative', 'superlative']
const DEGREE_LABEL = {
  positive: 'Positive',
  comparative: 'Comparative',
  superlative: 'Superlative',
}
const DEGREE_HINT = {
  positive: 'the plain quality — big, quietly',
  comparative: '"more / -er" — bigger, more quietly',
  superlative: '"the most / -est" — the biggest',
}
const PERSON_LABEL = {
  '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it',
  '1pl': 'we', '2pl': 'you (pl)', '3pl': 'they',
}
const PAST_LABEL = { past_m: 'he (past)', past_f: 'she (past)', past_n: 'it (past)', past_pl: 'they (past)' }
const IMPERATIVE_LABEL = { imp_sg: 'ты (command)', imp_pl: 'вы (command)' }
const TENSE_LABEL = { present: 'Present', future: 'Future', past: 'Past', imperative: 'Imperative' }

/**
 * The natural key of «са́мый», the word that forms the analytic superlative.
 * A superlative slot spans са́мый + the adjective, so resolving its stored form
 * needs this entry's declension alongside the adjective's own.
 */
export const SUPERLATIVE_MARKER_KEY = 'самый=the most'

// An imperfective future is analytic: the finite form belongs to быть and the
// lexical verb stays in the infinitive (я бу́ду чита́ть). Usage annotations
// point at this auxiliary so the context drill can ask for the part that
// actually carries person and number.
export const ANALYTIC_FUTURE_FORMS = Object.freeze({
  '1sg': 'бу́ду',
  '2sg': 'бу́дешь',
  '3sg': 'бу́дет',
  '1pl': 'бу́дем',
  '2pl': 'бу́дете',
  '3pl': 'бу́дут',
})

/** Aspect display names and the short usage cue shown on each aspect option. */
export const ASPECT_LABEL = Object.freeze({ impf: 'imperfective', pf: 'perfective' })
/**
 * Each aspect said as a *sense* rather than as its name. "Perfective" names the
 * distinction; it doesn't explain it, and for an identical-gloss pair (уби́ть /
 * убива́ть) the name is all the learner has. Exported so the correction
 * messages, the intro card and the facts panel all say the same thing.
 */
export const ASPECT_HINT = Object.freeze({
  impf: 'a process, habit or repeated action',
  pf: 'a single completed action or its result',
})

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

/** Whether a context phrase drills a verb-governed object case. */
export function isGovernmentPhrase(phrase) {
  return GOVERNMENT_RULES.has(phrase?.target?.rule)
}

/**
 * Every verb-government phrase in the bank, flattened across owner keys. Feeds
 * the dedicated government drill, which is phrase-centric (organised by the
 * governed object) rather than word-centric like the general phrase-fix drill.
 * @param {Map<string, object[]>} phrasesByKey from {@link indexPhrases}
 * @returns {object[]}
 */
export function governmentPhrases(phrasesByKey) {
  const out = []
  for (const list of phrasesByKey?.values() ?? []) {
    for (const p of list) if (isGovernmentPhrase(p)) out.push(p)
  }
  return out
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
  if (target.degree === 'short') {
    return `Short form · ${GENDER_LABEL[target.gender] ?? target.gender}`
  }
  // A non-finite verb form. The gerund is invariable, so its name is the whole
  // label; the participles agree, so the agreement follows the form's name.
  if (target.form) {
    const name = FORM_LABEL[target.form] ?? target.form
    if (target.form === 'gerund') return name
    if (target.case) return `${name} · ${agreementLabel(target.gender, target.case)}`
    return target.gender ? `${name} · ${GENDER_LABEL[target.gender] ?? target.gender}` : name
  }
  // The comparative is invariable, so it is the whole label. The superlative
  // agrees (са́мый + adjective), so it carries the agreement after it.
  if (target.degree === 'comparative') return DEGREE_LABEL.comparative
  if (target.degree === 'superlative') {
    return target.case
      ? `${DEGREE_LABEL.superlative} · ${agreementLabel(target.gender, target.case)}`
      : DEGREE_LABEL.superlative
  }
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

/**
 * Selection step: pick the case. The six core cases are always offered; the
 * second locative (в лесу́, на берегу́) is added as a seventh option only for
 * nouns that actually have one — mirroring how genderStep offers only the
 * genders a word declines for, so the option set reflects the real paradigm.
 */
function caseStep(target, word) {
  const cases = word?.forms?.sg?.loc ? [...CASES, LOCATIVE] : CASES
  return {
    kind: 'case',
    prompt: 'Which case does the highlighted word need?',
    options: cases.map((c) => ({
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
 * Selection step: pick the gender + number a short-form (predicate) adjective
 * agrees with (закры́т / закры́та / закры́то / закры́ты). Like genderStep, but the
 * options come from the word's `short` block rather than the case declension.
 */
function shortGenderStep(target, word) {
  const short = word?.short ?? {}
  const present = GENDERS.filter((g) => short[g])
  const genders = present.length ? present : GENDERS
  return {
    kind: 'gender',
    prompt: 'Which gender / number must the short form agree with?',
    options: genders.map((g) => ({
      id: g,
      label: GENDER_LABEL[g] ?? g,
      correct: g === target.gender,
    })),
  }
}

/**
 * Selection step: pick the degree of comparison the sentence needs. The English
 * carries the answer ("colder", "the coldest"), so this is the step that teaches
 * a learner to *notice* a comparison rather than reach for the dictionary form.
 *
 * Like genderStep, the options are the degrees the word really has: the positive
 * always, the comparative only where one is stored, and the superlative only for
 * adjectives — «са́мый» modifies an adjective, not an adverb, so offering it on
 * ти́хо would be an option that can never be right.
 */
function degreeStep(target, word) {
  const has = {
    positive: true,
    comparative: !!word?.extra?.forms?.comparative,
    superlative: word?.pos === 'adjective',
  }
  // The annotated degree is always offered, even if the word's own data is thin.
  const degrees = DEGREES.filter((d) => has[d] || d === target.degree)
  return {
    kind: 'degree',
    prompt: 'Which degree does the sentence need?',
    options: degrees.map((d) => ({
      id: d,
      label: DEGREE_LABEL[d],
      hint: DEGREE_HINT[d],
      correct: d === target.degree,
    })),
  }
}

/**
 * How many options the "which form?" step aims to offer. Most verbs store only
 * the one or two non-finite forms their own sentences drill, so a step built
 * from stored slots alone is usually a single button — nothing to choose.
 */
const FORM_OPTIONS = 4

/**
 * Selection step: pick which non-finite form of the verb the sentence needs —
 * a participle (and which one) or the gerund. This is the step that carries the
 * *meaning*: the formation drill lives in the `#nonfinite` paradigm, but knowing
 * that "the crying child" wants a present active participle while "without
 * thinking" wants a gerund is what the sentence teaches.
 *
 * The forms the verb stores are always offered (the annotated one included, even
 * when the word's data is thin), then padded up to {@link FORM_OPTIONS} from the
 * slots its aspect and government frame allow it — see participles.plausibleSlots.
 * Unlike genderStep and degreeStep, "the word stores it" is the wrong bar here:
 * the corpus stores only the forms it drills, so услы́шать carries its gerund
 * alone and a stored-only step would ask a question with one answer. Padding
 * with unstored-but-formable slots keeps every option one the sentence could
 * plausibly have wanted; the impossible ones (a present participle of a
 * perfective) stay out.
 *
 * Actives and the gerund pad first, passives after: nearly every verb of the
 * right aspect has the former, while the latter needs a transitive verb, and
 * `governs` catches only the frames that make that explicit.
 */
function formStep(target, word) {
  const chosen = new Set(storedSlots(word))
  if (target.form) chosen.add(target.form)
  const pad = plausibleSlots(word)
  const passive = (slot) => PASSIVE_SLOTS.includes(slot)
  for (const slot of [...pad.filter((s) => !passive(s)), ...pad.filter(passive)]) {
    if (chosen.size >= FORM_OPTIONS) break
    chosen.add(slot)
  }
  const forms = FORM_SLOTS.filter((f) => chosen.has(f))
  return {
    kind: 'form',
    prompt: 'Which form of the verb does the sentence need?',
    options: forms.map((f) => ({
      id: f,
      label: FORM_LABEL[f],
      hint: FORM_HINT[f],
      correct: f === target.form,
    })),
  }
}

/**
 * Selection step: pick the gender + number a short passive participle agrees
 * with (закры́т / закры́та / закры́то / закры́ты). The short-form twin of
 * {@link shortGenderStep}, reading the verb's `pass_short` cells rather than an
 * adjective's `short` block.
 */
function passiveShortGenderStep(target, word) {
  const present = GENDERS.filter((g) => shortPassiveCell(word, g))
  const genders = present.length ? present : GENDERS
  return {
    kind: 'gender',
    prompt: 'Which gender / number must the short form agree with?',
    options: genders.map((g) => ({
      id: g,
      label: GENDER_LABEL[g] ?? g,
      correct: g === target.gender,
    })),
  }
}

/**
 * The ordered steps for a non-finite slot, per docs/participles-and-gerunds.md:
 * the gerund is invariable so the form is the whole choice; the short passive
 * agrees by gender/number; a long participle agrees like an adjective, so a
 * nominative needs the gender and an oblique one needs the case first.
 */
function nonFiniteSteps(target, word) {
  const first = formStep(target, word)
  if (target.form === 'gerund') return [first]
  if (target.form === 'pass_short') return [first, passiveShortGenderStep(target, word)]
  return target.case
    ? [first, caseStep(target, word), genderStep(target, word)]
    : [first, genderStep(target, word)]
}

/**
 * The two verb contrasts a linked pair can teach. Both are "two verbs, one
 * gloss, and the sentence decides which" — the same drill shape over a
 * different dimension:
 *
 *  - `aspect` — imperfective vs perfective (говори́ть ↔ сказа́ть), linked by
 *    `pair:` and resolved into `aspectPair`;
 *  - `motion` — determinate vs indeterminate (идти́ ↔ ходи́ть), linked by
 *    `motion_pair:` and resolved into `motionPair`. Both members are
 *    imperfective, so aspect cannot express it and #538 gave it its own link.
 *
 * `dimension` is the descriptor's own name, `value` reads a word's position on
 * it, `first` is the value that sorts to the left in the option list, and
 * `rule` names the grammar rule that explains the contrast.
 */
export const MOTION_LABEL = Object.freeze({ det: 'determinate', indet: 'indeterminate' })
/** The same, for the directionality of a verb of motion. See {@link ASPECT_HINT}. */
export const MOTION_HINT = Object.freeze({
  det: 'one trip, under way in one direction',
  indet: 'habitual, repeated, or there and back',
})

const CONTRASTS = Object.freeze({
  aspect: Object.freeze({
    dimension: 'aspect',
    partnerOf: (w) => w?.aspectPair ?? null,
    value: (w) => w?.aspect ?? null,
    label: ASPECT_LABEL,
    hint: ASPECT_HINT,
    first: 'impf',
    rule: 'verb-aspect',
    stepLabel: 'aspect',
  }),
  motion: Object.freeze({
    dimension: 'motion',
    partnerOf: (w) => w?.motionPair ?? null,
    value: (w) => w?.motion ?? null,
    label: MOTION_LABEL,
    hint: MOTION_HINT,
    first: 'det',
    rule: 'verb-motion-pair',
    stepLabel: 'direction',
  }),
})

/**
 * Which contrast a verb drills, or null for an unpaired verb. Aspect wins when
 * a verb has both links (идти́ has the perfective пойти́ *and* the indeterminate
 * ходи́ть): it is the contrast every other verb in the lexicon drills, so
 * keeping it primary keeps the drill's meaning stable. The motion contrast is
 * still taught from the other side — ходи́ть has no aspect partner, so its
 * drill is the directional one.
 */
export function verbContrast(word) {
  if (!word || word.pos !== 'verb') return null
  for (const c of [CONTRASTS.aspect, CONTRASTS.motion]) {
    if (c.partnerOf(word)?.key && c.value(word)) return c
  }
  return null
}

/** The two members of a verb's pair, the contrast's `first` value leading. */
function pairMembers(word, contrast) {
  const self = {
    ru: word.headword || word.ru,
    key: word.key,
    aspect: word.aspect,
    motion: word.motion,
    correct: true,
  }
  const partner = { ...contrast.partnerOf(word), correct: false }
  return [self, partner].sort((a) => (contrast.value(a) === contrast.first ? -1 : 1))
}

/** An option button for one member of a pair (its infinitive + usage cue). */
function pairOption(member, contrast) {
  const v = contrast.value(member)
  return {
    id: v,
    label: member.ru,
    hint: `${contrast.label[v] ?? v} — ${contrast.hint[v] ?? ''}`,
  }
}

/** The grammar rule explaining a contrast, resolved out of the rules map. */
function contrastRuleFor(contrast, rules) {
  const rule = contrast ? (rules?.[contrast.rule] ?? null) : null
  return rule ? { id: contrast.rule, ...rule } : null
}

/**
 * Selection step: choose between the two members of a linked pair — the drill
 * from #315, generalised to the motion pairs by #538. The sentence context
 * (habit vs. single completed action; one trip vs. a round trip) determines
 * which verb fits; the options are the two infinitives, each with a one-line
 * usage cue. The correct option is always the word that owns the phrase (its
 * usage examples are hand-authored around it).
 */
function contrastStep(word, contrast) {
  return {
    kind: 'contrast',
    // Which dimension the pick is on ('aspect' | 'motion') and how to name it
    // in feedback — the other steps are named by their `kind`, but "contrast"
    // means nothing to a learner ("you picked the wrong direction" does).
    dimension: contrast.dimension,
    label: contrast.stepLabel,
    prompt: 'Which verb does this sentence need?',
    options: pairMembers(word, contrast).map((m) => ({
      ...pairOption(m, contrast),
      correct: m.correct,
    })),
  }
}

/**
 * The ordered selection steps the learner works through before spelling — case
 * always first, then the other dimension:
 *   - a non-finite verb form (participle / gerund): which form first, since that
 *     is the choice the sentence teaches, then its agreement — none for the
 *     invariable gerund, gender + number for the short passive, and case →
 *     gender + number for a long participle in an oblique case
 *   - adjectives / possessive pronouns (gender-bearing): case → gender + number
 *   - a comparative (adjective or adverb): degree only — the form is invariable,
 *     so there is no case, number or gender left to choose
 *   - a superlative: degree → case → gender + number, because «са́мый» agrees
 *   - nouns: case → number (singular / plural)
 *   - personal pronouns: case only (number is fixed by the lemma — я is always
 *     singular, so there's nothing to choose)
 *   - verbs (no case): a pair choice when the verb has a linked partner —
 *     aspect (говори́ть vs сказа́ть) or, for a verb of motion with no aspect
 *     partner, direction (ходи́ть vs идти́) — otherwise straight to spelling
 * Each step is `{ kind, prompt, options: [{ id, label, hint?, correct }] }`; the
 * component grades each clicked option's `correct` flag.
 */
export function buildSelectSteps(target, word) {
  // A step whose option set collapsed to one button asks nothing — the single
  // answer is right by construction — so it is dropped rather than shown as a
  // free tap. Every step type above offers at least two options on real data;
  // this is the backstop for a word whose record is too thin to fill one.
  return selectStepsFor(target, word).filter((step) => step.options.length > 1)
}

function selectStepsFor(target, word) {
  if (target?.form) return nonFiniteSteps(target, word)
  if (target?.degree === 'short') return [shortGenderStep(target, word)]
  if (target?.degree === 'comparative') return [degreeStep(target, word)]
  if (target?.degree === 'superlative') {
    return target.case
      ? [degreeStep(target, word), caseStep(target, word), genderStep(target, word)]
      : [degreeStep(target, word)]
  }
  if (!target?.case) {
    const contrast = target?.person ? verbContrast(word) : null
    return contrast ? [contrastStep(word, contrast)] : []
  }
  if (target.gender) return [caseStep(target, word), genderStep(target, word)]
  if (word?.pos === 'noun') return [caseStep(target, word), numberStep(target)]
  return [caseStep(target, word)]
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

  // A multi-word lemma (день рожде́ния, горя́чий шокола́д) inflects as a unit, so
  // the slot spans `span` consecutive tokens and the answer is their join.
  const span = Math.max(1, Number(target.span) || 1)
  if (idx + span > tokens.length) return null
  const cores = tokens.slice(idx, idx + span).map(wordCore)
  if (cores.some((c) => !c)) return null
  const core = cores.join(' ')

  const analyticFuture =
    word?.pos === 'verb' &&
    word?.aspect === 'impf' &&
    target.tense === 'future' &&
    ANALYTIC_FUTURE_FORMS[target.person] != null

  // The slot shows the dictionary form before answering; the component
  // (PhraseFixExercise) re-attaches the token's surrounding punctuation around
  // the lemma / answer when it renders, so we only need the lemma here. In an
  // analytic future the annotated finite word is the auxiliary, not the
  // lexical verb that owns the example.
  const lemma = analyticFuture ? 'быть' : word?.headword || word?.ru || core

  const rule = target.rule ? (rules[target.rule] ?? null) : null
  // A rule may name a sibling it is best read against (#592): the genitive after
  // два is only intelligible beside the genitive after мно́го, and the word that
  // decides between them is never the word being highlighted. Resolved here so
  // the reveal can offer both without the component knowing the rules map.
  const sibling = rule?.contrast ? (rules[rule.contrast] ?? null) : null
  // Aspect cannot be selected in the one-token board for an analytic future:
  // its imperfective and perfective alternatives have different structures
  // (бу́дет чита́ть vs прочита́ет), not interchangeable forms of this slot.
  const selectSteps = analyticFuture ? [] : buildSelectSteps(target, word)
  const contrastSelect = selectSteps.find((s) => s.kind === 'contrast')

  return {
    kind: 'phrase-fix',
    tokens, // the correct sentence tokens
    targetIndex: idx,
    // Number of consecutive tokens the slot covers (>1 for multi-word lemmas).
    span,
    lemma,
    // With a pair step the slot must not reveal which partner is correct, so
    // the component shows every candidate lemma until it's chosen.
    lemmaOptions: contrastSelect ? contrastSelect.options.map((o) => o.label) : null,
    answerAccented: core,
    answer: normalize(core),
    // The ordered selection steps (the aspect/direction contrast for paired
    // verbs; otherwise case first, then number / gender + number). The
    // component grades each clicked option's `correct`.
    selectSteps,
    number: target.number ?? null,
    slotLabel: slotLabelFor(target),
    // The full, correct sentence — safe to speak only after a correct answer.
    ru: phrase.ru,
    en: phrase.en,
    rule: rule ? { id: target.rule, ...rule } : null,
    // The sibling rule, collapsed in the reveal: there to be opened, not read.
    siblingRule: sibling ? { id: rule.contrast, ...sibling } : null,
    // The generic pair-choice explanation, shown whenever the exercise opened
    // with a contrast step (alongside any slot-specific rule).
    contrastRule: contrastRuleFor(contrastSelect ? verbContrast(word) : null, rules),
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

/** Sample up to `n` distinct items, weighted by `weightOf` (no replacement). */
function sampleWeighted(list, n, weightOf, rng) {
  const pool = list.slice()
  const out = []
  while (out.length < n && pool.length) {
    const pick = weightedPick(pool, weightOf, rng)
    out.push(pick)
    pool.splice(pool.indexOf(pick), 1)
  }
  return out
}

/**
 * Build a SET of context exercises that all drill the same lexical item: up to
 * `items` distinct annotated sentences of `word`, extended — for a verb with a
 * linked aspect partner (pass its resolved record as `partner`) — by the
 * partner's sentences. Keeping a set to one root / aspect pair, rather than
 * hopping between unrelated words, lets the learner contrast how English and
 * Russian each use that word across several sentences. A set shrinks to the
 * sentences the item actually has (most words carry a single annotated phrase
 * today, so non-verb sets are often a single sentence).
 *
 * For a pair, a sentence whose English is authored on both sides cannot
 * discriminate the aspect (its choose-the-verb step would be unanswerable), so
 * it is dropped from both — unless that would empty the word's own side, in
 * which case the set stays own-only instead of pairing a duplicate English.
 *
 * @param {object} word normalised word record (the drawn word)
 * @param {object} ctx
 * @param {Map}    ctx.phrasesByKey key → annotated phrases (see indexPhrases)
 * @param {object} [ctx.rules]      parsed grammar-rules.yml `rules` map
 * @param {object} [ctx.partner]    resolved word record of `word.aspectPair`
 * @param {number} [ctx.items]      max sentences in the set
 * @param {() => number} [ctx.rng]
 * @returns {object[]} phrase-fix descriptors, each targeting its own owner
 */
export function buildContextSet(
  word,
  { phrasesByKey, rules = {}, rng = Math.random, items = 3, partner = null } = {},
) {
  if (!word || !phrasesByKey) return []
  const weightOf = (p) => (isException(p, rules) ? EXCEPTION_WEIGHT : 1)
  const dedupe = (list) => {
    const seen = new Set()
    return (list ?? []).filter((p) => {
      if (!p?.ru || seen.has(p.ru)) return false
      seen.add(p.ru)
      return true
    })
  }
  let own = dedupe(phrasesByKey.get(word.key))
  const paired = partner && word.aspectPair?.key === partner.key
  let partners = paired ? dedupe(phrasesByKey.get(partner.key)) : []
  if (partners.length) {
    const ownEn = new Set(own.map(enKey))
    const partnerEn = new Set(partners.map(enKey))
    const unambiguous = own.filter((p) => !partnerEn.has(enKey(p)))
    if (unambiguous.length) {
      own = unambiguous
      partners = partners.filter((p) => !ownEn.has(enKey(p)))
    } else {
      partners = []
    }
  }
  // The word's own sentences take at least half the set; the partner fills
  // whatever room is left (the same balance as the aspect drill).
  const nPartner = Math.min(partners.length, items - Math.min(own.length, Math.ceil(items / 2)))
  const nOwn = Math.min(own.length, items - nPartner)
  const picked = [
    ...sampleWeighted(own, nOwn, weightOf, rng).map((p) => ({ p, owner: word })),
    ...sampleWeighted(partners, nPartner, weightOf, rng).map((p) => ({ p, owner: partner })),
  ]
  return shuffle(picked, rng)
    .map(({ p, owner }) => buildFromPhrase(p, owner, { rules }))
    .filter(Boolean)
}

// --- Verb contrast drill (usage · mastery) ---------------------------------
//
// How the usage dimension is mastered for a verb with a linked partner: the
// learner reads a batch of English sentences that use the pair in different
// tenses and picks, per sentence, which member the Russian would need — then
// spells one conjugated form. Every usage example is hand-authored around the
// verb that owns it, so (exactly as for the single-sentence contrast step
// above) the correct answer for a sentence is simply its owner's value on the
// contrast. The pick stage needs no `inflect:` annotation, so it draws from ALL
// usage examples of both partners; only the spelling stage needs an annotated
// phrase.
//
// The contrast is aspect for most verbs (#315) and direction for a verb of
// motion whose partner is the other imperfective of its pair (#538) — see
// `verbContrast`.

/** Sentences a contrast drill aims to show. */
export const CONTRAST_DRILL_ITEMS = 6

/** Fewest sentences a drill may run with (else fall back to the table drill). */
export const CONTRAST_DRILL_MIN_ITEMS = 4

/** English text key for de-duplicating / collision-testing drill sentences. */
function enKey(p) {
  return String(p?.en ?? '').trim().toLowerCase()
}

/**
 * The candidate sentence pools for a pair's drill: each side de-duplicated by
 * its English text, then any English that appears on BOTH sides removed from
 * both. The pair's sentences are sometimes authored as translations of the
 * same English ("She thanked the teacher." for both благодари́ла and
 * поблагодари́ла); such a sentence cannot discriminate the pair, so it is
 * unanswerable and must not be asked.
 */
function contrastDrillPools(word, contrast, phrasesBySource) {
  const dedupe = (list) => {
    const seen = new Set()
    return (list ?? []).filter((p) => {
      const k = enKey(p)
      if (!k || !p?.ru || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const own = dedupe(phrasesBySource.get(word.key))
  const partner = dedupe(phrasesBySource.get(contrast.partnerOf(word).key))
  const ownEn = new Set(own.map(enKey))
  const partnerEn = new Set(partner.map(enKey))
  return {
    own: own.filter((p) => !partnerEn.has(enKey(p))),
    partner: partner.filter((p) => !ownEn.has(enKey(p))),
  }
}

/**
 * Whether the contrast drill can be built for a word (deterministic): a verb
 * with a linked partner, at least one annotated phrase to spell, at least one
 * unambiguous usage sentence on each side of the pair beyond the spelling one,
 * and enough sentences overall.
 * @param {object} word normalised word record
 * @param {object} ctx
 * @param {Map} ctx.phrasesByKey    key → annotated phrases (see indexPhrases)
 * @param {Map} ctx.phrasesBySource key → shaped usage phrases (vocabBuild.shapePhrases)
 */
export function canBuildContrastDrill(word, { phrasesByKey, phrasesBySource } = {}) {
  const contrast = verbContrast(word)
  if (!contrast || !phrasesBySource) return false
  if (!canBuildContext(word, { phrasesByKey })) return false
  const pools = contrastDrillPools(word, contrast, phrasesBySource)
  // One of the word's own sentences is (conservatively) reserved for spelling.
  const own = pools.own.length - 1
  const partner = pools.partner.length
  return own >= 1 && partner >= 1 && own + partner >= CONTRAST_DRILL_MIN_ITEMS
}

/**
 * Build the contrast drill descriptor for a verb, or null if it can't be made.
 * The pick stage balances the two members as evenly as the data allows and
 * shuffles the result; the spelling stage reuses the single-sentence context
 * exercise (its contrast step stripped — that was the pick stage's skill).
 * @returns {{kind: 'verb-contrast', contrast, options, items, spell, targets}|null}
 */
export function buildContrastDrill(
  word,
  { phrasesByKey, phrasesBySource, rules = {}, rng = Math.random, items = CONTRAST_DRILL_ITEMS } = {},
) {
  if (!canBuildContrastDrill(word, { phrasesByKey, phrasesBySource })) return null
  const contrast = verbContrast(word)
  const spell = buildContextExercise(word, { phrasesByKey, rules, rng })
  if (!spell) return null
  // The contrast was already exercised across the pick stage; spelling assesses
  // the conjugation only. The generic explanation still shows at the end.
  spell.selectSteps = []
  spell.lemmaOptions = null

  // The spelling sentence must not appear among the picks — its revealed form
  // would leak the answer (and its pick answer would be a repeat).
  const pools = contrastDrillPools(word, contrast, phrasesBySource)
  const own = pools.own.filter((p) => p.ru !== spell.ru)
  const partner = pools.partner.filter((p) => p.ru !== spell.ru)

  // Half from each side where possible; whichever side is short, the other tops up.
  const nPartner = Math.min(partner.length, items - Math.min(own.length, Math.ceil(items / 2)))
  const nOwn = Math.min(own.length, items - nPartner)
  const partnerValue = contrast.value(contrast.partnerOf(word))
  const picked = [
    ...sample(own, nOwn, rng).map((p) => ({ ru: p.ru, en: p.en, answer: contrast.value(word) })),
    ...sample(partner, nPartner, rng).map((p) => ({ ru: p.ru, en: p.en, answer: partnerValue })),
  ]
  if (picked.length < CONTRAST_DRILL_MIN_ITEMS) return null

  return {
    kind: 'verb-contrast',
    // Which contrast this drill teaches ('aspect' | 'motion'). Not `dimension`:
    // an exercise descriptor already carries the practice dimension (usage /
    // identification / …) and the drill is spread over it.
    contrast: contrast.dimension,
    // The two infinitives (the contrast's leading value first), shown as the
    // answer buttons for every sentence.
    options: pairMembers(word, contrast).map((m) => pairOption(m, contrast)),
    items: shuffle(picked, rng).map((it, i) => ({ id: `a${i}`, ...it })),
    spell,
    contrastRule: contrastRuleFor(contrast, rules),
    targets: [word.key],
  }
}
