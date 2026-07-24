// Practice-type catalogue — the stripped-down set of exercise groups from #79.
//
// A *practice* is a group of same-type exercises; a *session* is a group of
// practices. Each catalogue entry records which learning dimension it trains,
// whether it is a learning- or mastery-level practice, what kind of content it
// uses (a single word, a phrase, or a full inflection table) and how many
// exercises the practice contains. The leading "5x"/"2x"/"3x" counts in #79 are
// the per-practice exercise counts here.
//
// Pure data + tiny pure filters; no Vue, no I/O.

/** @typedef {'identification'|'usage'|'hearing'|'speaking'} Dimension */
/** @typedef {'learning'|'mastery'} Level */
/** @typedef {'word'|'phrase'|'inflection'} Content */

/** Every practice type the app can assemble a session from. */
export const PRACTICE_TYPES = Object.freeze([
  // Identification — learning
  {
    id: 'match-vocab',
    dimension: 'identification',
    level: 'learning',
    content: 'word',
    exercises: 5,
    items: 12, // twelve flashcards per exercise (#412)
    label: 'Match vocabulary',
  },
  {
    id: 'translate-phrase',
    dimension: 'identification',
    level: 'learning',
    content: 'phrase',
    exercises: 5,
    label: 'Translate the phrase',
  },
  // Usage — learning
  {
    id: 'spell-word',
    dimension: 'usage',
    level: 'learning',
    content: 'word',
    exercises: 5,
    label: 'Spell the word',
  },
  {
    id: 'spell-phrase',
    dimension: 'usage',
    level: 'learning',
    content: 'phrase',
    exercises: 2,
    label: 'Spell the phrase',
  },
  // Hearing — learning
  {
    id: 'listen-match',
    dimension: 'hearing',
    level: 'learning',
    content: 'word',
    exercises: 5,
    items: 12, // twelve heard-word flashcards per exercise (#412)
    label: 'Match what you hear',
  },
  {
    id: 'listen-translate',
    dimension: 'hearing',
    level: 'learning',
    content: 'phrase',
    exercises: 5,
    label: 'Translate what you hear',
  },
  {
    id: 'dictation',
    dimension: 'hearing',
    level: 'learning',
    content: 'phrase',
    exercises: 2,
    label: 'Dictation',
  },
  // Speaking — learning
  {
    id: 'repeat-phrase',
    dimension: 'speaking',
    level: 'learning',
    content: 'phrase',
    exercises: 2,
    label: 'Repeat the phrase',
  },
  {
    id: 'repeat-word',
    dimension: 'speaking',
    level: 'learning',
    content: 'word',
    exercises: 5,
    label: 'Repeat the word',
  },
  // Identification — mastering
  {
    id: 'inflect-bank',
    dimension: 'identification',
    level: 'mastery',
    content: 'inflection',
    exercises: 3,
    label: 'Fill the table (word bank)',
  },
  // Usage — mastering
  {
    id: 'inflect-keyboard',
    dimension: 'usage',
    level: 'mastery',
    content: 'inflection',
    exercises: 2,
    label: 'Type the table',
  },
  // Context — mastering (restore the right inflection inside natural phrases).
  // Each exercise bundles a SET of sentences that all drill the same lexical
  // item — the drawn word or, for a verb, its aspect pair — so the learner can
  // contrast the English and Russian uses of that word. See
  // exerciseBuild.CONTEXT_SET_ITEMS.
  {
    id: 'inflect-context',
    dimension: 'context',
    level: 'mastery',
    content: 'inflection',
    exercises: 2,
    items: 3, // max sentences per set, all of one word / aspect pair
    label: 'Use it in phrases',
  },
])

/** Fast lookup by id. */
export const PRACTICE_BY_ID = Object.freeze(
  Object.fromEntries(PRACTICE_TYPES.map((p) => [p.id, p])),
)

/**
 * Which practice types each session type may draw from. A focused session is
 * "a standard session using words matching the filter", so the only difference
 * between session types here is the eligible practice set.
 */
export const SESSION_PRACTICE_FILTERS = Object.freeze({
  standard: () => true,
  speaking: (p) => p.dimension === 'speaking',
  listening: (p) => p.dimension === 'hearing',
  words: (p) => p.content === 'word' && (p.dimension === 'identification' || p.dimension === 'usage'),
  phrases: (p) =>
    p.content === 'phrase' && (p.dimension === 'identification' || p.dimension === 'usage'),
  grammar: (p) => p.content === 'inflection',
})

/** The practice types available for a given session type. */
export function practicesForSession(type) {
  const filter = SESSION_PRACTICE_FILTERS[type] ?? SESSION_PRACTICE_FILTERS.standard
  return PRACTICE_TYPES.filter(filter)
}
