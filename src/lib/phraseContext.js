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

/** Grammar-rule ids that mark a verb-government slot. */
export const GOVERNMENT_RULES = Object.freeze(
  new Set(['verb-gov-dative', 'verb-gov-genitive', 'verb-gov-instrumental']),
)

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

/** The two members of a verb's aspect pair, imperfective first. */
function aspectPairMembers(word) {
  const self = { ru: word.headword || word.ru, aspect: word.aspect, key: word.key, correct: true }
  const partner = { ...word.aspectPair, correct: false }
  return [self, partner].sort((a) => (a.aspect === 'impf' ? -1 : 1))
}

/** An option button for one member of an aspect pair (its infinitive + cue). */
function aspectOption(member) {
  return {
    id: member.aspect,
    label: member.ru,
    hint: `${ASPECT_LABEL[member.aspect] ?? member.aspect} — ${ASPECT_HINT[member.aspect] ?? ''}`,
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
  return {
    kind: 'aspect',
    prompt: 'Which verb does this sentence need?',
    options: aspectPairMembers(word).map((m) => ({ ...aspectOption(m), correct: m.correct })),
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

  const origToken = tokens[idx]
  const core = wordCore(origToken)
  if (!core) return null

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
  // Aspect cannot be selected in the one-token board for an analytic future:
  // its imperfective and perfective alternatives have different structures
  // (бу́дет чита́ть vs прочита́ет), not interchangeable forms of this slot.
  const selectSteps = analyticFuture ? [] : buildSelectSteps(target, word)
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

// --- Verb aspect drill (usage · mastery) -----------------------------------
//
// How the usage dimension is mastered for a verb with an aspect partner: the
// learner reads a batch of English sentences that use the pair in different
// tenses and aspects and picks, per sentence, which member (imperfective or
// perfective infinitive) the Russian would need — then spells one conjugated
// form. Every usage example is hand-authored around the verb that owns it, so
// (exactly as for the single-sentence aspect step above) the correct answer for
// a sentence is simply its owner's aspect. The pick stage needs no `inflect:`
// annotation, so it draws from ALL usage examples of both partners; only the
// spelling stage needs an annotated phrase.

/** Sentences an aspect drill aims to show. */
export const ASPECT_DRILL_ITEMS = 6

/** Fewest sentences a drill may run with (else fall back to the table drill). */
export const ASPECT_DRILL_MIN_ITEMS = 4

/** English text key for de-duplicating / collision-testing drill sentences. */
function enKey(p) {
  return String(p?.en ?? '').trim().toLowerCase()
}

/**
 * The candidate sentence pools for a pair's drill: each side de-duplicated by
 * its English text, then any English that appears on BOTH sides removed from
 * both. The pair's sentences are sometimes authored as translations of the
 * same English ("She thanked the teacher." for both благодари́ла and
 * поблагодари́ла); such a sentence cannot discriminate the aspect, so it is
 * unanswerable and must not be asked.
 */
function aspectDrillPools(word, phrasesBySource) {
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
  const partner = dedupe(phrasesBySource.get(word.aspectPair.key))
  const ownEn = new Set(own.map(enKey))
  const partnerEn = new Set(partner.map(enKey))
  return {
    own: own.filter((p) => !partnerEn.has(enKey(p))),
    partner: partner.filter((p) => !ownEn.has(enKey(p))),
  }
}

/**
 * Whether the aspect drill can be built for a word (deterministic): a verb with
 * a linked aspect partner, at least one annotated phrase to spell, at least one
 * unambiguous usage sentence on each side of the pair beyond the spelling one,
 * and enough sentences overall.
 * @param {object} word normalised word record
 * @param {object} ctx
 * @param {Map} ctx.phrasesByKey    key → annotated phrases (see indexPhrases)
 * @param {Map} ctx.phrasesBySource key → shaped usage phrases (vocabBuild.shapePhrases)
 */
export function canBuildAspectDrill(word, { phrasesByKey, phrasesBySource } = {}) {
  if (!word || word.pos !== 'verb' || !word.aspectPair?.key || !phrasesBySource) return false
  if (!canBuildContext(word, { phrasesByKey })) return false
  const pools = aspectDrillPools(word, phrasesBySource)
  // One of the word's own sentences is (conservatively) reserved for spelling.
  const own = pools.own.length - 1
  const partner = pools.partner.length
  return own >= 1 && partner >= 1 && own + partner >= ASPECT_DRILL_MIN_ITEMS
}

/**
 * Build the aspect drill descriptor for a verb, or null if it can't be made.
 * The pick stage balances the two aspects as evenly as the data allows and
 * shuffles the result; the spelling stage reuses the single-sentence context
 * exercise (its aspect step stripped — the aspect was the pick stage's skill).
 * @returns {{kind: 'aspect-drill', options, items, spell, targets}|null}
 */
export function buildAspectDrill(
  word,
  { phrasesByKey, phrasesBySource, rules = {}, rng = Math.random, items = ASPECT_DRILL_ITEMS } = {},
) {
  if (!canBuildAspectDrill(word, { phrasesByKey, phrasesBySource })) return null
  const spell = buildContextExercise(word, { phrasesByKey, rules, rng })
  if (!spell) return null
  // The aspect was already exercised across the pick stage; spelling assesses
  // the conjugation only. The generic aspect explanation still shows at the end.
  spell.selectSteps = []
  spell.lemmaOptions = null

  // The spelling sentence must not appear among the picks — its revealed form
  // would leak the answer (and its aspect answer would be a repeat).
  const pools = aspectDrillPools(word, phrasesBySource)
  const own = pools.own.filter((p) => p.ru !== spell.ru)
  const partner = pools.partner.filter((p) => p.ru !== spell.ru)

  // Half from each side where possible; whichever side is short, the other tops up.
  const nPartner = Math.min(partner.length, items - Math.min(own.length, Math.ceil(items / 2)))
  const nOwn = Math.min(own.length, items - nPartner)
  const picked = [
    ...sample(own, nOwn, rng).map((p) => ({ ru: p.ru, en: p.en, answer: word.aspect })),
    ...sample(partner, nPartner, rng).map((p) => ({ ru: p.ru, en: p.en, answer: word.aspectPair.aspect })),
  ]
  if (picked.length < ASPECT_DRILL_MIN_ITEMS) return null

  return {
    kind: 'aspect-drill',
    // The two infinitives (imperfective first), shown as the answer buttons for
    // every sentence.
    options: aspectPairMembers(word).map(aspectOption),
    items: shuffle(picked, rng).map((it, i) => ({ id: `a${i}`, ...it })),
    spell,
    aspectRule:
      rules['verb-aspect'] ? { id: 'verb-aspect', ...rules['verb-aspect'] } : null,
    targets: [word.key],
  }
}
