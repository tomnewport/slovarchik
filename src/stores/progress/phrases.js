// A phrase gets its teaching glosses on its first presentation, across every
// drill. An exercise result is too late: a learner can leave before answering,
// and a second drill can show the same sentence in another direction.
import { foldYo } from '../../lib/text.js'
import { typingSequence } from '../../lib/phrases.js'

import { state } from './state.js'
import { saveMeta } from './persistence.js'

/** The Russian sentence identifies the phrase, regardless of its English
 * rendering, stress marks or terminal punctuation. */
function phraseKey(ru) {
  return foldYo(typingSequence(ru))
}

/** Claim this presentation and return whether it is the first one. Call once
 * when a question appears, then keep the result for that entire question so
 * reactive progress updates do not remove its glosses mid-attempt.
 * @param {string} ru
 * @returns {boolean}
 */
export function firstPhraseEncounter(ru) {
  const key = phraseKey(ru)
  if (!key || state.seenPhrases.has(key)) return false
  state.seenPhrases = new Set([...state.seenPhrases, key])
  saveMeta('seenPhrases', [...state.seenPhrases])
  return true
}
