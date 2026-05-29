// Skills: measurable patterns over the attempt history (issue #12). A skill rolls
// up every relevant attempt into one strength/error/mastery reading, and knows
// its *breadth* — how many vocab words it covers (a single word = 1, a collection
// = its members, a gender = every such noun). Breadth lets the UI group skills
// into broad / medium / narrow bands. Pure: it reads described stats (see
// lib/progress.js) and the normalised word list; no I/O.
import { CASES, CASE_LABELS, NUMBER_LABELS, NUMBERS } from './declension.js'

/** Word types we surface as "skill" groups, e.g. "Masculine nouns". */
const GENDER_LABELS = { m: 'Masculine', f: 'Feminine', n: 'Neuter' }
const ANIMACY_LABELS = { a: 'Animate', i: 'Inanimate' }

/**
 * Breadth bands, widest first. A skill lands in the first band whose `min` it
 * meets, so the thresholds 100 / 10 / 1 give "100+ words", "10–99" and "1–9"
 * (single-word skills always fall in the narrowest band). Tweak the thresholds
 * to taste; the UI reads `label`.
 */
export const BREADTH_TIERS = Object.freeze([
  { id: 'broad', label: '100+ words', min: 100 },
  { id: 'medium', label: '10+ words', min: 10 },
  { id: 'narrow', label: '1+ words', min: 1 },
])

/** The breadth band a relevant-word count falls into. */
export function breadthTier(count, tiers = BREADTH_TIERS) {
  return tiers.find((t) => count >= t.min) ?? tiers[tiers.length - 1]
}

/** Sum the attempt metrics of a set of described stats into one reading. */
function rollUp(stats) {
  let attempts = 0
  let incorrect = 0
  let easy = 0
  let correct = 0
  const words = new Set()
  for (const s of stats) {
    attempts += s.attempts
    incorrect += s.incorrect
    easy += s.easy
    correct += s.correct
    if (s.attempts > 0) words.add(s.key)
  }
  return {
    attempts,
    incorrect,
    easy,
    correct,
    errorRate: attempts ? incorrect / attempts : 0,
    strength: attempts ? 1 - incorrect / attempts : null, // null = never attempted
    wordsAttempted: words.size,
  }
}

/**
 * Turn a skill definition into a full skill: roll up its relevant stats and
 * average the per-word mastery of the words it covers.
 * @param {object} def {id, kind, label, facet?, value?, stats, wordKeys, masteryByWord}
 * @param {object} tiers breadth bands
 */
function finalize(def, tiers) {
  const breadth = def.wordKeys.length
  const masteries = def.wordKeys.map((k) => def.masteryByWord.get(k) ?? 0)
  const mastery = masteries.length ? masteries.reduce((a, b) => a + b, 0) / masteries.length : 0
  return {
    id: def.id,
    kind: def.kind,
    label: def.label,
    breadth,
    tier: breadthTier(breadth, tiers).id,
    mastery,
    wordsMastered: masteries.filter((m) => m >= 1).length,
    wordKeys: def.wordKeys,
    ...rollUp(def.stats),
  }
}

/**
 * Enumerate every skill from the current history and vocab.
 * @param {object[]} stats described stats (with `.mastery`, `.facets`, …)
 * @param {object[]} words normalised vocab records (with `.forms`, `.gender`, …)
 * @param {object} [opts] `tiers` to override the breadth bands
 * @returns {object[]} skills (word, form, type and collection)
 */
export function buildSkills(stats, words, { tiers = BREADTH_TIERS } = {}) {
  // Per-word mastery comes from each word's translation ('word') subject.
  const masteryByWord = new Map()
  for (const s of stats) if (s.kind === 'word') masteryByWord.set(s.key, s.mastery ?? 0)

  // Index stats so each skill's relevant slice is cheap to gather.
  const byKey = new Map() // word key -> stats touching that word (word + its forms)
  const bySlot = new Map() // 'pl.gen' -> form stats
  for (const s of stats) {
    if (!byKey.has(s.key)) byKey.set(s.key, [])
    byKey.get(s.key).push(s)
    if (s.kind === 'form' && s.facets?.slot) {
      if (!bySlot.has(s.facets.slot)) bySlot.set(s.facets.slot, [])
      bySlot.get(s.facets.slot).push(s)
    }
  }
  const statsForWords = (keys) => keys.flatMap((k) => byKey.get(k) ?? [])

  const skills = []
  const mk = (def) => skills.push(finalize({ masteryByWord, ...def }, tiers))

  // 1. Individual words (breadth 1).
  for (const w of words) {
    mk({
      id: `word:${w.key}`,
      kind: 'word',
      label: w.headword || w.ru,
      stats: byKey.get(w.key) ?? [],
      wordKeys: [w.key],
    })
  }

  // 2. Grammatical forms — one per declension slot a noun in the vocab has.
  for (const num of NUMBERS) {
    for (const c of CASES) {
      const slot = `${num}.${c}`
      const wordKeys = words.filter((w) => w.forms?.[num]?.[c]).map((w) => w.key)
      if (!wordKeys.length) continue
      mk({
        id: `form:${slot}`,
        kind: 'form',
        label: `${CASE_LABELS[c]} ${NUMBER_LABELS[num].toLowerCase()}`,
        stats: bySlot.get(slot) ?? [],
        wordKeys,
      })
    }
  }

  // 3. Word types — gender and animacy groups, e.g. "Masculine nouns".
  const typeGroup = (facet, value, label) => {
    const wordKeys = words.filter((w) => w[facet] === value).map((w) => w.key)
    if (!wordKeys.length) return
    mk({ id: `type:${facet}:${value}`, kind: 'type', label, stats: statsForWords(wordKeys), wordKeys })
  }
  for (const [value, label] of Object.entries(GENDER_LABELS)) typeGroup('gender', value, `${label} nouns`)
  for (const [value, label] of Object.entries(ANIMACY_LABELS)) typeGroup('animacy', value, `${label} nouns`)

  // 4. Collections.
  const collections = new Set()
  for (const w of words) for (const c of w.collections ?? []) collections.add(c)
  for (const c of [...collections].sort()) {
    const wordKeys = words.filter((w) => (w.collections ?? []).includes(c)).map((w) => w.key)
    mk({ id: `collection:${c}`, kind: 'collection', label: c, stats: statsForWords(wordKeys), wordKeys })
  }

  return skills
}

/** Group skills into the breadth bands, widest first. */
export function groupByBreadth(skills, tiers = BREADTH_TIERS) {
  const groups = tiers.map((t) => ({ ...t, skills: [] }))
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const skill of skills) byId.get(skill.tier)?.skills.push(skill)
  return groups
}

/**
 * The weakest fraction (default 25%) of *attempted* skills — what a practice
 * session should target. Weakest = highest error rate, ties broken by attempts.
 * @param {object[]} skills
 * @param {object} [opts] `fraction` (0–1), `minAttempts`, `kinds` to restrict
 */
export function weakestSkills(skills, { fraction = 0.25, minAttempts = 1, kinds } = {}) {
  const pool = skills.filter(
    (s) => s.attempts >= minAttempts && (!kinds || kinds.includes(s.kind)),
  )
  pool.sort((a, b) => b.errorRate - a.errorRate || b.attempts - a.attempts || a.id.localeCompare(b.id))
  return pool.slice(0, Math.max(1, Math.ceil(pool.length * fraction)))
}

/**
 * Exam readiness for a collection (issue #12): the icon fills with the average
 * per-word mastery, and the exam unlocks once every word is mastered.
 * @returns {{collection, words, mastered, readiness, eligible}}
 */
export function collectionReadiness(stats, words, collection) {
  const members = words.filter((w) => (w.collections ?? []).includes(collection))
  const masteryByWord = new Map()
  for (const s of stats) if (s.kind === 'word') masteryByWord.set(s.key, s.mastery ?? 0)
  const masteries = members.map((w) => masteryByWord.get(w.key) ?? 0)
  const mastered = masteries.filter((m) => m >= 1).length
  return {
    collection,
    words: members.length,
    mastered,
    readiness: members.length ? masteries.reduce((a, b) => a + b, 0) / members.length : 0,
    eligible: members.length > 0 && mastered === members.length,
  }
}
