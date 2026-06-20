// Pure resolver for the phrase-completion (context) mastery drill.
//
// Given a word, the loaded phrase-battery config (public/vocab/phrase-batteries.yml)
// and an index of all word records, this builds a single "fix the inflection in a
// natural sentence" exercise: a carrier phrase with the target word collapsed to
// its dictionary form, plus the inflected form the learner must restore.
//
// The carrier sentence fixes everything except the target, so the required form
// is fully determined and read straight from the word's stored forms — no
// agreement engine. Adjective batteries borrow a carrier noun (referenced by its
// vocab key) and reuse its declension for agreement.
//
// Framework-free; randomness is injectable for deterministic tests.

import { normalize, stripStress } from './text.js'
import { CASES, CASE_LABELS, NUMBER_LABELS } from './declension.js'

/** Parts of speech that carry a context drill. */
export const CONTEXT_POS = Object.freeze(['noun', 'verb', 'adjective'])

const GENDER_LABEL = { m: 'Masculine', n: 'Neuter', f: 'Feminine', pl: 'Plural' }
const GENDER_NUMBER = { m: 'sg', n: 'sg', f: 'sg', pl: 'pl' }
const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']
const PAST_KEYS = ['past_m', 'past_f', 'past_n', 'past_pl']

function pickOne(arr, rng) {
  return arr.length ? arr[Math.floor(rng() * arr.length)] : null
}

/** The ids a word is tagged with, plus the universal `everyday` fallback. */
function batteriesFor(word, group) {
  const all = group?.batteries ?? []
  const tagged = new Set(word.extra?.batteries ?? [])
  const matched = all.filter((b) => tagged.has(b.id))
  if (matched.length) return matched
  const fallback = all.filter((b) => b.id === 'everyday')
  return fallback.length ? fallback : all
}

/**
 * Assemble the common exercise shape from a resolved Russian template.
 * `slotToken` marks the blank; `ruReplace` substitutes any carrier placeholders.
 */
function assemble({ ruTemplate, slotToken, ruReplace = {}, lemma, answerAccented, en, slotLabel, wordKey }) {
  let ru = ruTemplate
  for (const [k, v] of Object.entries(ruReplace)) ru = ru.split(k).join(v)
  const tokens = ru.trim().split(/\s+/).filter(Boolean)
  const idx = tokens.findIndex((t) => t.includes(slotToken))
  if (idx === -1) return null
  const displayTokens = tokens.map((t, i) => (i === idx ? t.split(slotToken).join(lemma) : t))
  return {
    kind: 'phrase-fix',
    tokens: displayTokens,
    targetIndex: idx,
    lemma,
    answerAccented,
    answer: normalize(answerAccented),
    slotLabel,
    en,
    ru: displayTokens.join(' '),
    targets: [wordKey],
  }
}

function buildNoun(word, group, rng) {
  if (!group || !word.forms) return null
  const battery = pickOne(batteriesFor(word, group), rng)
  if (!battery?.frames) return null
  const cases = Object.keys(battery.frames)
  const numbers = word.numbers?.length ? word.numbers : Object.keys(word.forms)
  const candidates = []
  for (const num of numbers) {
    for (const c of cases) {
      if (c === 'nom') continue // nominative singular is the lemma — trivial
      const form = word.forms?.[num]?.[c]
      if (form) candidates.push({ num, c, form })
    }
  }
  const pick = pickOne(candidates, rng)
  if (!pick) return null
  const lemma = word.forms?.sg?.nom ?? word.forms?.pl?.nom ?? word.headword ?? word.ru
  const enWord = word.meaning || word.en || ''
  const en = String(battery.en?.[pick.c] ?? '').split('___').join(enWord)
  return assemble({
    ruTemplate: battery.frames[pick.c],
    slotToken: '___',
    lemma,
    answerAccented: pick.form,
    en,
    slotLabel: `${NUMBER_LABELS[pick.num] ?? pick.num} · ${CASE_LABELS[pick.c] ?? pick.c}`,
    wordKey: word.key,
  })
}

function buildAdjective(word, group, wordByKey, rng) {
  const decl = word.extra?.declension
  if (!group?.shared_frames || !decl || !Object.keys(decl).length) return null
  const battery = pickOne(batteriesFor(word, group), rng)
  if (!battery?.carriers) return null
  const genders = ['m', 'n', 'f', 'pl']
  const candidates = []
  for (const g of genders) {
    for (const c of CASES) {
      if (g === 'm' && c === 'nom') continue // masculine nominative is the lemma
      // Adjective data stores only the inanimate accusative (= nominative), so an
      // animate carrier's accusative (= genitive) can't agree — skip it.
      if (battery.animate && c === 'acc') continue
      const adjForm = decl[`${g}_${c}`]
      if (!adjForm) continue
      const carrier = wordByKey.get(stripStress(battery.carriers[g] ?? ''))
      const num = GENDER_NUMBER[g]
      const carrierForm = carrier?.forms?.[num]?.[c]
      if (!carrierForm) continue
      candidates.push({ g, c, adjForm, carrierForm, carrierEn: carrier.meaning || carrier.en || '' })
    }
  }
  const pick = pickOne(candidates, rng)
  if (!pick) return null
  const frame = group.shared_frames[pick.c]
  if (!frame) return null
  const lemma = decl.m_nom ?? word.extra?.forms?.m ?? word.headword ?? word.ru
  const adjEn = word.meaning || word.en || ''
  const en = String(frame.en ?? '').split('{adj}').join(adjEn).split('{N}').join(pick.carrierEn)
  return assemble({
    ruTemplate: frame.ru,
    slotToken: '{adj}',
    ruReplace: { [`{N.${pick.c}}`]: pick.carrierForm },
    lemma,
    answerAccented: pick.adjForm,
    en,
    slotLabel: `${GENDER_LABEL[pick.g] ?? pick.g} · ${CASE_LABELS[pick.c] ?? pick.c}`,
    wordKey: word.key,
  })
}

function buildVerb(word, group, rng) {
  const conj = word.extra?.conjugation
  if (!group || !conj) return null
  const battery = pickOne(batteriesFor(word, group), rng)
  if (!battery?.tail) return null
  const finite = conj.present ?? conj.future ?? null
  const tense = conj.present ? 'present' : conj.future ? 'future' : null
  const subjects = group.subjects ?? {}
  const candidates = []
  if (finite && tense) {
    const subjectSet = subjects[tense] ?? {}
    for (const p of PERSONS) {
      if (finite[p] && subjectSet[p]) {
        candidates.push({ subject: subjectSet[p], answer: finite[p], label: tense === 'present' ? 'Present' : 'Future' })
      }
    }
  }
  const pastSubjects = subjects.past ?? {}
  for (const k of PAST_KEYS) {
    if (conj[k] && pastSubjects[k]) candidates.push({ subject: pastSubjects[k], answer: conj[k], label: 'Past' })
  }
  const pick = pickOne(candidates, rng)
  if (!pick) return null
  const lemma = word.headword || word.ru
  return assemble({
    ruTemplate: `${pick.subject} ${battery.tail}`,
    slotToken: '___',
    lemma,
    answerAccented: pick.answer,
    en: word.meaning || word.en || '',
    slotLabel: `${pick.subject} · ${pick.label}`,
    wordKey: word.key,
  })
}

/**
 * Build a context exercise descriptor for a word, or null if none can be made.
 * @param {object} word          a normalised word record (vocabBuild)
 * @param {object} ctx
 * @param {object} ctx.batteries parsed phrase-batteries.yml
 * @param {Map}    ctx.wordByKey key → word record (for adjective carriers)
 * @param {() => number} [ctx.rng]
 */
export function buildContextExercise(word, { batteries, wordByKey, rng = Math.random } = {}) {
  if (!word || !batteries) return null
  switch (word.pos) {
    case 'noun':
      return buildNoun(word, batteries.nouns, rng)
    case 'adjective':
      return buildAdjective(word, batteries.adjectives, wordByKey ?? new Map(), rng)
    case 'verb':
      return buildVerb(word, batteries.verbs, rng)
    default:
      return null
  }
}

/** Whether a context exercise can be constructed for a word (deterministic). */
export function canBuildContext(word, ctx) {
  return buildContextExercise(word, { ...ctx, rng: () => 0 }) != null
}
