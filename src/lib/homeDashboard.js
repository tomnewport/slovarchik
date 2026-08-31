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

/** Abbreviations of the grammatical qualifiers {@link disambiguatedGloss} spells out. */
const SHORT_ASPECT_LABEL = Object.freeze({ impf: 'impf.', pf: 'pf.' })
const SHORT_MOTION_LABEL = Object.freeze({ det: 'det.', indet: 'indet.' })

/**
 * How much of an authored note a row can still afford beside the gloss and the
 * dimension pips — measured against the narrowest phone the app targets, where
 * the whole English half of a row is about twenty characters wide. A note longer
 * than this is an explanation rather than a label, and is left to the card.
 */
const ROW_NOTE_MAX = 20

/** Separators an authored gloss or note uses between one sense and the next. */
const SENSE_BREAK = /[,;\u2013\u2014]/

/**
 * The leading sense of a gloss — everything before the first comma, semicolon or
 * dash that isn't inside a parenthetical, so "close (near in space or time)"
 * survives whole while "accepted, resigned himself" reduces to "accepted".
 */
function firstSense(en) {
  const text = String(en ?? '').trim()
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '(') depth += 1
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && SENSE_BREAK.test(c)) return text.slice(0, i).trim()
  }
  return text
}

/**
 * The gloss a dashboard row shows: its leading sense, with the shortest
 * qualifier that still keeps a linked pair apart. A row shares its width with
 * the dimension pips, and a gloss long enough to push those off the card is the
 * one thing it must not do — so the row says only enough to identify the word,
 * and the card behind it ({@link disambiguatedGloss}, WordProgressModal) carries
 * the full explanation.
 */
export function rowGloss(en, word) {
  const base = firstSense(en)
  if (!word) return base

  // An authored note is a full explanation ("polite form used with children and
  // guests"), sized for the card rather than for a row. Keep its opening clause
  // when that alone still fits and says something the gloss doesn't; otherwise
  // the row shows the bare gloss and the card does the explaining.
  const note = firstSense(word.note)
  const fits = note.length <= ROW_NOTE_MAX && note.toLowerCase() !== base.toLowerCase()
  if (word.ambiguousEn?.length && fits) return `${base} (${note})`

  const aspect = word.aspectPair ? SHORT_ASPECT_LABEL[word.aspect] : null
  if (aspect) return `${base} (${aspect})`

  const motion = word.motionPair ? SHORT_MOTION_LABEL[word.motion] : null
  if (motion) return `${base} (${motion})`

  return base
}

function rowIdentity(key, vocabByKey) {
  const { ru, en } = parseKey(key)
  const word = vocabByKey?.get(key)
  // `en` is what the row prints; `fullEn` is the unabridged gloss, carried
  // along for the row's hover title.
  return { ru, en: rowGloss(en, word), fullEn: disambiguatedGloss(en, word) }
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
      const { ru, en, fullEn } = rowIdentity(w.word, vocabByKey)
      return {
        key: w.word,
        ru,
        en,
        fullEn,
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
    const { ru, en, fullEn } = rowIdentity(key, vocabByKey)
    const state = stateOf(key)
    const level = state === 'mastered' ? 'mastery' : 'learning'
    const dims = dimPips(evs, level, level === 'mastery' ? MASTERY_DIMS : LEARNING_DIMS, key, {
      known: rec?.known,
      hasContextDrill,
    })
    return { key, ru, en, fullEn, state, dims }
  })
}
