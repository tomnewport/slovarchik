// Pure view-model builders for the Home dashboard (HomeView.vue).
//
// Framework-free (no Vue, no store, no DOM) so the non-trivial derivation — which
// dimension pips a word shows, whether it's done/pending, how the rows sort — is
// unit-testable in isolation, mirroring the other `src/lib/*` modules. HomeView
// stays presentational: it feeds these functions the reactive records/batch data
// and renders the plain objects they return.

import { parseKey } from './vocabBuild.js'
import { ASPECT_LABEL, MOTION_LABEL } from './phraseContext.js'
import { dimensionProgress, lastAttemptAt } from './progression.js'

// Which dimensions each level tracks, and the emoji pip shown for each.
export const LEARNING_DIMS = ['identification', 'usage', 'hearing', 'speaking']
export const MASTERY_DIMS = ['identification', 'usage', 'context']
export const DIM_LABEL = {
  identification: '👁️',
  usage: '✍️',
  hearing: '👂',
  speaking: '🗣️',
  context: '🛠️',
}

/**
 * Add the smallest useful qualifier when a dashboard gloss would otherwise
 * hide a distinction the vocabulary already knows about. Ordinary words keep
 * their bare gloss; linked aspect/motion pairs show their grammatical contrast,
 * while same-gloss words use their authored meaning note.
 */
export function disambiguatedGloss(en, word) {
  if (!word) return en

  const note = String(word.note ?? '').trim()
  if (word.ambiguousEn?.length && note) return `${en} (${note})`

  const aspect = word.aspectPair ? ASPECT_LABEL[word.aspect] : null
  if (aspect) return `${en} (${aspect})`

  const motion = word.motionPair ? MOTION_LABEL[word.motion] : null
  if (motion) return `${en} (${motion})`

  return en
}

function rowIdentity(key, vocabByKey) {
  const { ru, en } = parseKey(key)
  return { ru, en: disambiguatedGloss(en, vocabByKey?.get(key)) }
}

/**
 * Drop dimensions a word isn't actually graded on, so "done" words stay tidy:
 * context, at the mastery level, only applies to words with a phrase-completion
 * drill. `hasContextDrill(key)` is injected so this stays free of the store.
 */
export function dimsFor(key, level, dims, hasContextDrill) {
  if (level !== 'mastery') return dims
  return dims.filter((d) => d !== 'context' || hasContextDrill(key))
}

/** Build the per-dimension pip descriptors for one word's events. */
function dimPips(events, level, dims, key, { known, hasContextDrill }) {
  return dimsFor(key, level, dims, hasContextDrill).map((d) => ({
    label: DIM_LABEL[d],
    name: d,
    ...dimensionProgress(events, level, d, { known }),
  }))
}

/**
 * Build the word rows for a current batch (learning or mastery). Each row carries
 * the parsed ru/en, done/pending flags, last-attempt time and dimension pips.
 * Sorted not-done first, then most-recently-attempted first.
 *
 * @param batchWords array of `{ word, done }` (from `batchProgress(level)`)
 * @param ctx `{ records, vocabByKey, hasContextDrill, isPendingConfirmation }`
 */
export function buildWordList(batchWords, level, dims, ctx) {
  const { records, vocabByKey, hasContextDrill, isPendingConfirmation } = ctx
  return batchWords
    .map((w) => {
      const rec = records[w.word]
      const events = rec?.events ?? []
      const { ru, en } = rowIdentity(w.word, vocabByKey)
      return {
        key: w.word,
        ru,
        en,
        done: w.done,
        // Done by criteria but awaiting the spaced confirmation review (#313).
        pending: w.done && isPendingConfirmation(w.word),
        lastAt: lastAttemptAt(events) ?? 0,
        dims: dimPips(events, level, dims, w.word, { known: rec?.known, hasContextDrill }),
      }
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return b.lastAt - a.lastAt
    })
}

/**
 * Build the word rows for the at-risk / slipped status cards. Each key resolves
 * to its current state, the level it's graded at, and its dimension pips.
 *
 * @param keys array of word keys
 * @param ctx `{ records, vocabByKey, stateOf, hasContextDrill }`
 */
export function buildStatusWordList(keys, ctx) {
  const { records, vocabByKey, stateOf, hasContextDrill } = ctx
  return keys.map((key) => {
    const rec = records[key]
    const evs = rec?.events ?? []
    const { ru, en } = rowIdentity(key, vocabByKey)
    const state = stateOf(key)
    const level = state === 'mastered' ? 'mastery' : 'learning'
    const dims = dimPips(evs, level, level === 'mastery' ? MASTERY_DIMS : LEARNING_DIMS, key, {
      known: rec?.known,
      hasContextDrill,
    })
    return { key, ru, en, state, dims }
  })
}
