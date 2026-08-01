// Pure eligible-pool gating for the hands-free spoken practice (issue #25),
// extracted from PracticeView.vue so the "which words/phrases may each activity
// draw from" rules are unit-testable in isolation.
//
// Framework-free (no Vue, no store): the view passes in the loaded vocab/phrases
// and the progress accessors (stateOf / hasBeenCorrect) plus the current
// learning-batch key set; these functions return plain arrays keyed by activity.

import { STATES } from './progression.js'

// Recognition errors that won't fix themselves — pause the loop rather than
// auto-retrying on silence (a blocked mic mustn't spin forever).
export const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'network',
  'unsupported',
])

const rank = (s) => STATES.indexOf(s)

/**
 * "New words" come from the current learning batch (which includes never-seen
 * words); fall back to anything actively being learned if no batch is set.
 */
export function newWordsPool(vocab, learningKeys, stateOf) {
  const inBatch = vocab.filter((w) => learningKeys.has(w.id))
  if (inBatch.length) return inBatch
  return vocab.filter((w) => stateOf(w.id) === 'learning')
}

/** Words the learner has got right at least once are eligible to be *tested*. */
export function knownWordsPool(vocab, hasBeenCorrect) {
  return vocab.filter((w) => hasBeenCorrect(w.id))
}

/**
 * English→Russian phrase production is only offered once the owning word is
 * learned (a stand-in for "translated a few times and spoken aloud").
 */
export function phraseToRuPool(phrases, stateOf) {
  return phrases.filter((p) => rank(stateOf(p.source)) >= rank('learned'))
}

/**
 * Phrase listening/repetition practice is gated to phrases whose source word is
 * in the current learning batch or has been answered correctly at least once —
 * prevents drilling completely unknown vocabulary.
 */
export function phrasePool(phrases, learningKeys, hasBeenCorrect) {
  return phrases.filter((p) => learningKeys.has(p.source) || hasBeenCorrect(p.source))
}

/**
 * Build the full activity→pool map the hands-free loop draws from.
 * @param ctx `{ vocab, phrases, learningKeys, stateOf, hasBeenCorrect }`
 */
export function buildPools({ vocab, phrases, learningKeys, stateOf, hasBeenCorrect }) {
  const known = knownWordsPool(vocab, hasBeenCorrect)
  const phraseP = phrasePool(phrases, learningKeys, hasBeenCorrect)
  return {
    'new-words': newWordsPool(vocab, learningKeys, stateOf),
    'word-test': known,
    'translate-word': known,
    'repeat-phrase': phraseP,
    'translate-phrase': phraseP,
    'phrase-to-russian': phraseToRuPool(phrases, stateOf),
  }
}
