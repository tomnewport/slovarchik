// Turn a built session (from the store's startSession) into a flat list of
// concrete exercise descriptors the runner steps through and the Vue exercise
// components render. Pure and framework-free; randomness is injectable.
//
// Each practice in the session names a practice type, a learning dimension and
// a candidate word pool (its 25/25/50 bucket). Here we draw real words/phrases
// from that pool — topping up from the wider vocabulary when a pool is thin —
// and shape them into descriptors keyed by a render `kind`:
//
//   match    click-to-match pairs            (match-vocab, listen-match)
//   wordbank assemble a translation          (translate-phrase, listen-translate)
//   type     spell with the hintable keyboard (spell-word, spell-phrase, dictation)
//   speak    repeat aloud                     (repeat-word, repeat-phrase)
//   inflect  fill an inflection table         (inflect-bank, inflect-keyboard)
//
// Every descriptor carries `targets` (the word keys it should report to the
// progress store) plus `dimension`/`level` so results map back to the model.

import { sample } from './quiz.js'
import { shapeVocab } from './vocabBuild.js'
import { buildParadigm } from './paradigm.js'

/** Render `kind` for each practice type. */
export const PRACTICE_KIND = Object.freeze({
  'match-vocab': 'match',
  'listen-match': 'match',
  'translate-phrase': 'wordbank',
  'listen-translate': 'wordbank',
  'spell-word': 'type',
  'spell-phrase': 'type',
  dictation: 'type',
  'repeat-word': 'speak',
  'repeat-phrase': 'speak',
  'inflect-bank': 'inflect',
  'inflect-keyboard': 'inflect',
})

/** Pairs shown in a single matching board. */
export const MATCH_PAIRS = 10

/** The primary English gloss for a shaped vocab word. */
function enText(en) {
  return Array.isArray(en) ? (en[0] ?? '') : (en ?? '')
}

/**
 * Draw up to `n` items, preferring the pool and only then topping up from the
 * rest. Both lists are sampled (so order is randomised) but pool items always
 * win when there are enough of them.
 */
function drawN(pool, rest, n, rng) {
  const chosen = sample(pool, n, rng)
  if (chosen.length >= n) return chosen
  return [...chosen, ...sample(rest, n - chosen.length, rng)]
}

/** Split shaped vocab into pool words and the rest. */
function splitWords(poolKeys, vocab) {
  const pool = (poolKeys ?? []).map((k) => vocab.get(k)).filter(Boolean)
  const have = new Set(pool.map((v) => v.id))
  const rest = [...vocab.values()].filter((v) => !have.has(v.id))
  return { pool, rest }
}

/** Split phrases into those sourced from the pool and the rest. */
function splitPhrases(poolKeys, phrases) {
  const keys = new Set(poolKeys ?? [])
  const pool = phrases.filter((p) => keys.has(p.source))
  const rest = phrases.filter((p) => !keys.has(p.source))
  return { pool, rest }
}

function common(practice, practiceIndex) {
  return {
    practiceIndex,
    practiceType: practice.practiceType,
    dimension: practice.dimension,
    level: practice.level,
    content: practice.content,
    bucket: practice.bucket,
    audio: practice.dimension === 'hearing',
  }
}

function buildMatch(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  // Board size comes from the practice catalogue (`items`), defaulting to MATCH_PAIRS.
  const picked = drawN(pool, rest, practice.items ?? MATCH_PAIRS, ctx.rng)
  if (picked.length < 2) return []
  return [
    make({
      ...common(practice, pi),
      kind: 'match',
      pairs: picked.map((w) => ({ key: w.id, ru: w.ru, en: enText(w.en) })),
      targets: picked.map((w) => w.id),
    }),
  ]
}

function buildWordType(practice, pi, ctx, make, kind) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const picked = drawN(pool, rest, practice.exercises, ctx.rng)
  return picked.map((w) =>
    make({
      ...common(practice, pi),
      kind,
      targets: [w.id],
      ru: w.ru,
      en: enText(w.en),
      note: w.note,
    }),
  )
}

function buildPhrase(practice, pi, ctx, make, kind) {
  const { pool, rest } = splitPhrases(practice.pool, ctx.phrases)
  const picked = drawN(pool, rest, practice.exercises, ctx.rng)
  return picked.map((p) =>
    make({
      ...common(practice, pi),
      kind,
      targets: [p.source].filter(Boolean),
      ru: p.ru,
      en: p.en,
    }),
  )
}

function buildInflect(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const inflectable = (list) =>
    list.map((v) => ctx.recordByKey.get(v.id)).filter((r) => r && buildParadigm(r))
  const picked = drawN(inflectable(pool), inflectable(rest), practice.exercises, ctx.rng)
  const mode = practice.practiceType === 'inflect-keyboard' ? 'keyboard' : 'bank'
  return picked.map((r) =>
    make({
      ...common(practice, pi),
      kind: 'inflect',
      mode,
      targets: [r.key],
      wordKey: r.key,
      lemma: r.headword || r.ru,
    }),
  )
}

function generate(practice, pi, ctx, make) {
  const kind = PRACTICE_KIND[practice.practiceType]
  switch (kind) {
    case 'match':
      return buildMatch(practice, pi, ctx, make)
    case 'wordbank':
      return buildPhrase(practice, pi, ctx, make, 'wordbank')
    case 'type':
      return practice.content === 'phrase'
        ? buildPhrase(practice, pi, ctx, make, 'type')
        : buildWordType(practice, pi, ctx, make, 'type')
    case 'speak':
      return practice.content === 'phrase'
        ? buildPhrase(practice, pi, ctx, make, 'speak')
        : buildWordType(practice, pi, ctx, make, 'speak')
    case 'inflect':
      return buildInflect(practice, pi, ctx, make)
    default:
      return []
  }
}

/**
 * Build the flat exercise list for a session.
 * @param {object} session   from store.startSession (has `.practices`)
 * @param {object} sources
 * @param {object[]} sources.words   normalised word records (vocab store)
 * @param {object[]} sources.phrases shaped phrases ({ id, ru, en, source, cefr })
 * @param {() => number} [sources.rng]
 * @returns {object[]} exercise descriptors (each with a unique `id`)
 */
export function buildExercises(session, { words = [], phrases = [], rng = Math.random } = {}) {
  const vocab = new Map(shapeVocab(words).map((v) => [v.id, v]))
  const recordByKey = new Map(words.map((w) => [w.key, w]))
  const ctx = { vocab, recordByKey, phrases, rng }

  const out = []
  let seq = 0
  const make = (base) => ({ id: `ex${seq++}`, ...base })

  ;(session.practices ?? []).forEach((practice, pi) => {
    for (const exercise of generate(practice, pi, ctx, make)) out.push(exercise)
  })
  return out
}
