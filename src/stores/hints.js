// Reactive glue for in-phrase word hints (#131).
//
// Combines the pure surface-form index (phraseHint) with the learner's progress
// so the UI can ask, for any Russian word in a phrase, "should this be
// hintable, and if so what does it mean?". A word is hintable when it maps to a
// known dictionary entry that the learner has **not** yet learned and that
// **isn't** in the batch they're currently learning/mastering — i.e. words they
// can't be expected to know yet and aren't actively drilling.
import { computed } from 'vue'

import { state as vocabState } from './vocab.js'
import { state as progressState, stateOf } from './progress.js'
import { buildFormIndex, phraseHintTokens, senseGloss } from '../lib/phraseHint.js'
import { diagnose } from '../lib/confusables.js'
import { STATES } from '../lib/progression.js'

const LEARNED_RANK = STATES.indexOf('learned')

/** Surface-form → hint entry, rebuilt only when the vocabulary changes. */
const formIndex = computed(() => buildFormIndex(vocabState.words))

/** Keys belonging to a currently committed learning or mastery batch. */
const currentBatchKeys = computed(() => {
  const keys = new Set()
  for (const level of ['learning', 'mastery']) {
    const batch = progressState[level]
    if (batch) for (const key of batch.words) keys.add(key)
  }
  return keys
})

/** Has the learner already learned (or mastered) this word? */
function isLearned(key) {
  return STATES.indexOf(stateOf(key)) >= LEARNED_RANK
}

/** Is this sense one the learner still needs spelling out? */
function isSenseShowable(sense) {
  return !currentBatchKeys.value.has(sense.key) && !isLearned(sense.key)
}

/**
 * The hint to show for a single form-index entry, or null when the learner is
 * expected to know it (already learned) or is actively drilling it (in the
 * current batch).
 *
 * A homograph carries one sense per dictionary entry that spells itself that way
 * (#568), and they're weighed one at a time: knowing «есть» "to eat" says nothing
 * about the existential «есть» "there is", so the meaning the learner is missing
 * still shows. The hint is dropped only once every sense is known.
 */
function hintIfShowable(entry) {
  if (!entry) return null
  const senses = entry.senses.filter(isSenseShowable)
  if (!senses.length) return null
  if (senses.length === entry.senses.length) return entry
  return {
    ...entry,
    key: senses[0].key,
    ru: senses[0].ru,
    en: senseGloss(senses),
    senses,
  }
}

/**
 * Split a phrase into display tokens, each tagged with the hint to reveal for it
 * (or null when it's a plain, non-hintable word). Stress marks, capitalisation
 * and punctuation in the source phrase are preserved for display.
 * @param {string} phrase
 * @returns {Array<{text: string, hint: object|null}>}
 */
export function hintTokensFor(phrase) {
  return phraseHintTokens(phrase, formIndex.value).map(({ text, hint }) => ({
    text,
    hint: hintIfShowable(hint),
  }))
}

/** key → word record, for the diagnosis of a wrong answer. */
const wordsByKey = computed(() => new Map(vocabState.words.map((w) => [w.key, w])))

/**
 * Diagnose a wrong answer: what word did the learner actually write, and how
 * does it relate to the one being asked for? Returns null when the answer isn't
 * a recognisable Russian word — an ordinary spelling slip, which the drills
 * handle as they always have. See lib/confusables.js.
 *
 * The wiring lives here because this store already builds (and caches) the
 * surface-form index the diagnosis looks words up in; rebuilding it per drill
 * would be pure waste.
 *
 * @param {string} typed the learner's answer
 * @param {{targetKey: string, target: string}} about the word being drilled and
 *   the surface form wanted (a single word, or the whole phrase)
 */
export function diagnoseAnswer(typed, { targetKey, target } = {}) {
  return diagnose(typed, {
    targetKey,
    target,
    formIndex: formIndex.value,
    byKey: wordsByKey.value,
  })
}
