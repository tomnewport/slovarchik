// Focused-session skills. A "skill" is a category of words (a part of speech,
// a sub-type within one, etc.) defined by a predicate over the normalised word
// record. The Progress screen ranks skills by how much the learner is
// struggling with them and offers a focused session over the matching words.
//
// Pure and framework-free. Weakness is derived purely from the Phase-1/2 model
// (each word's current state), not from any per-inflection bookkeeping.

import { stripStress } from './text.js'
import { STATES } from './progression.js'

const rank = (state) => STATES.indexOf(state)

/** Is this verb reflexive (its lemma ends in -ся / -сь)? */
function isReflexive(word) {
  return /(ся|сь)$/.test(stripStress(word.ru || ''))
}

/**
 * The skill catalogue. Each entry's `match(word)` decides membership; only
 * attributes that exist on the normalised record are used (pos, gender,
 * animacy, verb aspect via the conjugation it carries, reflexive ending).
 */
export const SKILLS = Object.freeze([
  { id: 'pos:noun', label: 'Nouns', match: (w) => w.pos === 'noun' },
  { id: 'noun:m', label: 'Masculine nouns', match: (w) => w.pos === 'noun' && w.gender === 'm' },
  { id: 'noun:f', label: 'Feminine nouns', match: (w) => w.pos === 'noun' && w.gender === 'f' },
  { id: 'noun:n', label: 'Neuter nouns', match: (w) => w.pos === 'noun' && w.gender === 'n' },
  { id: 'noun:animate', label: 'Animate nouns', match: (w) => w.pos === 'noun' && w.animate },
  { id: 'pos:verb', label: 'Verbs', match: (w) => w.pos === 'verb' },
  {
    id: 'verb:imperfective',
    label: 'Imperfective verbs',
    match: (w) => w.pos === 'verb' && !!w.extra?.conjugation?.present,
  },
  {
    id: 'verb:perfective',
    label: 'Perfective verbs',
    match: (w) => w.pos === 'verb' && !!w.extra?.conjugation?.future,
  },
  { id: 'verb:reflexive', label: 'Reflexive verbs', match: (w) => w.pos === 'verb' && isReflexive(w) },
  { id: 'pos:adjective', label: 'Adjectives', match: (w) => w.pos === 'adjective' },
  { id: 'pos:pronoun', label: 'Pronouns', match: (w) => w.pos === 'pronoun' },
  { id: 'pos:adverb', label: 'Adverbs', match: (w) => w.pos === 'adverb' },
])

/** Look up a skill by id. */
export function skillById(id) {
  return SKILLS.find((s) => s.id === id) ?? null
}

/** Keys of the non-unknown words that match a skill (the focused-session pool). */
export function focusedKeys(words, skill, stateOf) {
  if (!skill) return []
  return words.filter((w) => skill.match(w) && stateOf(w.key) !== 'unknown').map((w) => w.key)
}

/**
 * Rank skills by weakness — the fraction of the learner's attempted words in a
 * category that have not yet reached `learned`. Categories with fewer than
 * `minWords` attempted words (too little signal) or no weakness are dropped.
 * @returns {Array<{id, label, weakness, attempted, struggling}>} weakest first
 */
export function rankSkills(words, { stateOf, minWords = 3, limit = 6 } = {}) {
  const out = []
  for (const skill of SKILLS) {
    const attempted = words.filter((w) => skill.match(w) && stateOf(w.key) !== 'unknown')
    if (attempted.length < minWords) continue
    const struggling = attempted.filter((w) => rank(stateOf(w.key)) < rank('learned')).length
    const weakness = struggling / attempted.length
    if (weakness <= 0) continue
    out.push({ id: skill.id, label: skill.label, weakness, attempted: attempted.length, struggling })
  }
  return out.sort((a, b) => b.weakness - a.weakness || b.attempted - a.attempted).slice(0, limit)
}
