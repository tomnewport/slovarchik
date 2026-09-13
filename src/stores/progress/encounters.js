// Words the learner has *met* but not been taught (#675).
//
// A drill grades one word; the sentence around it carries a dozen more. The
// CEFR bars used to start a word's life the day its batch came up, which
// undersold how much of a level a learner had already seen. This module is the
// log of that head start: word key → when it was first met.
//
// Why a single meta blob rather than a field on the per-word record:
//
//   * a record is a heavyweight thing (events, schedule, aggregates,
//     confirmation state) and `ensureRecord` would mint thousands of them for
//     words nobody has drilled;
//   * `lost`, `atRisk`, `recentlyLearned` and the analytics history all walk
//     `Object.keys(state.records)`, so every record minted for an encounter
//     would be a word those computeds now have to consider and reject;
//   * an encounter is not an attempt. Writing one as an event would flip the
//     word's state to `learning` and put it in the scheduler's hands.
//
// So it stays out of `records` entirely, and the blob is bounded by the
// learnable corpus (~4,250 keys) rather than by how much drilling happens.

import { computed } from 'vue'

import { phraseProvesEncounter, encounteredKeys } from '../../lib/encounters.js'
import { formIndex } from '../vocab.js'

import { state, learnableVocab } from './state.js'
import { saveMeta } from './persistence.js'

/** Keys the curriculum can actually teach — gloss-only entries are excluded. */
const learnableKeys = computed(() => new Set(learnableVocab.value.map((w) => w.key)))

/** Has the learner met this word in a phrase they got right? */
export function hasMet(key) {
  return key != null && key in state.metWords
}

/** How many distinct words have been met this way. */
export const metCount = computed(() => Object.keys(state.metWords).length)

/**
 * Stamp words as met, keeping the first timestamp for any already logged.
 * Persists in the background — like the activity log and the achievement
 * stamp, this is bookkeeping alongside an answer, not something the answer
 * should wait on — and writes nothing at all when every key is already known,
 * which is the common case once a learner is a few weeks in.
 * @param {string[]} keys
 * @param {number} [ts]
 * @returns {string[]} the keys that were new
 */
export function markMet(keys, ts = Date.now()) {
  const added = (keys ?? []).filter((k) => k && !(k in state.metWords))
  if (!added.length) return []
  const next = { ...state.metWords }
  for (const k of added) next[k] = ts
  state.metWords = next
  saveMeta('metWords', next)
  return added
}

/**
 * Log whatever an exercise result proves the learner has met. Safe to call for
 * every result: it decides for itself whether this one proves anything (see
 * `phraseProvesEncounter`), and does nothing when it doesn't.
 * @param {PlainObject} ex the exercise descriptor
 * @param {PlainObject} result what the exercise component reported
 * @param {number} [ts]
 * @returns {string[]} the keys newly logged
 */
export function recordEncounter(ex, result, ts = Date.now()) {
  if (!phraseProvesEncounter(ex, result)) return []
  const known = learnableKeys.value
  return markMet(encounteredKeys(ex.ru, formIndex.value, (k) => known.has(k)), ts)
}
