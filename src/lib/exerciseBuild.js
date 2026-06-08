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

import { sample, shuffle } from './quiz.js'
import { cefrRank } from './batches.js'
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

/**
 * Minimum identification encounters a word must have before it is eligible for
 * a spelling (type-kind) exercise. Prevents asking a learner to spell a word
 * they have barely seen.
 */
export const MIN_ENCOUNTERS_FOR_SPELLING = 2

/**
 * Minimum number of eligible words/phrases required to run any spelling
 * practice at all. When the pool is smaller than this the session would repeat
 * the same word too many times, so spelling is skipped until more words qualify.
 */
export const MIN_WORDS_FOR_SPELLING = 3

/** The primary English gloss for a shaped vocab word. */
function enText(en) {
  return Array.isArray(en) ? (en[0] ?? '') : (en ?? '')
}

/**
 * Take up to `n` items from `rest`, lowest CEFR level first: a level is fully
 * exhausted before any of the next level up is touched, and items within a
 * level are shuffled so the fillers vary. This keeps top-up words at (or, only
 * once a level runs dry, just above) the learner's level instead of pulling
 * random advanced vocabulary into an otherwise low-level exercise.
 */
function topUpByLevel(rest, n, rng) {
  if (n <= 0) return []
  const byRank = new Map()
  for (const w of rest) {
    const r = cefrRank(w.cefr)
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r).push(w)
  }
  const out = []
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    if (out.length >= n) break
    out.push(...shuffle(byRank.get(r), rng).slice(0, n - out.length))
  }
  return out
}

/**
 * Draw up to `n` distinct items, biased toward the front of `items`. The store
 * orders the current-batch pool worst-understood first, so this favours the
 * least-understood words. Linear weights: the first item is weighted by the
 * list length, the last by 1.
 */
function frontBiasedSample(items, n, rng) {
  const remaining = items.slice()
  const take = Math.min(Math.max(0, n), remaining.length)
  const out = []
  while (out.length < take) {
    const len = remaining.length
    const total = (len * (len + 1)) / 2
    let r = rng() * total
    let idx = len - 1
    for (let i = 0; i < len; i++) {
      r -= len - i
      if (r < 0) {
        idx = i
        break
      }
    }
    out.push(remaining.splice(idx, 1)[0])
  }
  return out
}

/**
 * Draw up to `n` items, preferring the pool and only then topping up from the
 * rest. Pool items always win when there are enough of them; the top-up draws
 * the lowest available CEFR level first (see {@link topUpByLevel}). When
 * `frontBias` is set (the current bucket) pool items are drawn worst-first
 * rather than uniformly, so the worst-understood words get the most practice.
 */
function drawN(pool, rest, n, rng, frontBias = false) {
  const chosen = frontBias ? frontBiasedSample(pool, n, rng) : sample(pool, n, rng)
  if (chosen.length >= n) return chosen
  return [...chosen, ...topUpByLevel(rest, n - chosen.length, rng)]
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
  const picked = drawN(pool, rest, practice.items ?? MATCH_PAIRS, ctx.rng, practice.bucket === 'current')
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
  let { pool, rest } = splitWords(practice.pool, ctx.vocab)
  if (kind === 'type' && ctx.encounterCount) {
    const met = (w) => ctx.encounterCount(w.id) >= MIN_ENCOUNTERS_FOR_SPELLING
    pool = pool.filter(met)
    rest = rest.filter(met)
  }
  if (kind === 'type' && pool.length + rest.length < MIN_WORDS_FOR_SPELLING) return []
  const picked = drawN(pool, rest, practice.exercises, ctx.rng, practice.bucket === 'current')
  return picked.map((w) =>
    make({
      ...common(practice, pi),
      kind,
      targets: [w.id],
      ru: w.ru,
      en: enText(w.en),
      note: w.note,
      ...(w.alsoRu?.length ? { alsoRu: w.alsoRu } : {}),
    }),
  )
}

function buildPhrase(practice, pi, ctx, make, kind) {
  let { pool, rest } = splitPhrases(practice.pool, ctx.phrases)
  if (kind === 'type' && ctx.encounterCount) {
    const met = (p) => !p.source || ctx.encounterCount(p.source) >= MIN_ENCOUNTERS_FOR_SPELLING
    pool = pool.filter(met)
    rest = rest.filter(met)
  }
  if (kind === 'type' && pool.length + rest.length < MIN_WORDS_FOR_SPELLING) return []
  const picked = drawN(pool, rest, practice.exercises, ctx.rng, practice.bucket === 'current')
  return picked.map((p) =>
    make({
      ...common(practice, pi),
      kind,
      targets: [p.source].filter(Boolean),
      ru: p.ru,
      en: p.en,
      ...(p.enAlt?.length ? { enAlt: p.enAlt } : {}),
    }),
  )
}

function buildInflect(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const inflectable = (list) =>
    list.map((v) => ctx.recordByKey.get(v.id)).filter((r) => r && buildParadigm(r))
  // Mastery exercises must never pull in words from outside the committed mastery
  // batch: doing so records mastery-level events on non-batch words, corrupting
  // their progression state. If the batch has fewer inflectable words than the
  // practice needs, produce fewer exercises rather than widening the scope.
  const topUpSource = practice.level === 'mastery' ? [] : rest
  const picked = drawN(
    inflectable(pool),
    inflectable(topUpSource),
    practice.exercises,
    ctx.rng,
    practice.bucket === 'current',
  )
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
 * Build a visual replacement exercise for a skipped speaking/listening item.
 * The replacement is a word-bank (phrase) or type (word) exercise covering
 * exactly the same content, requiring no audio input or output.
 *
 * @param {object} skipped  exercise or phrase-like descriptor; must have `ru` and `en`
 * @param {number} seq      monotonically-increasing counter for unique ids
 * @returns {object|null}   exercise descriptor, or null if content is missing
 */
export function makeVisualReplacement(skipped, seq) {
  // Match exercises bundle multiple pairs with no top-level ru/en —
  // expand each pair into an individual type (spell-word) exercise.
  if (skipped?.kind === 'match' && skipped.pairs?.length) {
    return skipped.pairs.map((pair, i) => ({
      id: `vis${seq}_${i}`,
      practiceIndex: skipped.practiceIndex ?? 0,
      practiceType: 'spell-word',
      dimension: 'identification',
      level: skipped.level ?? 'learning',
      content: 'word',
      bucket: skipped.bucket ?? 'current',
      audio: false,
      kind: 'type',
      targets: [pair.key].filter(Boolean),
      ru: pair.ru,
      en: pair.en,
    }))
  }
  if (!skipped?.ru || !skipped?.en) return null
  const kind = skipped.content === 'word' ? 'type' : 'wordbank'
  return {
    id: `vis${seq}`,
    practiceIndex: skipped.practiceIndex ?? 0,
    practiceType: kind === 'wordbank' ? 'translate-phrase' : 'spell-word',
    dimension: 'identification',
    level: skipped.level ?? 'learning',
    content: kind === 'wordbank' ? 'phrase' : 'word',
    bucket: skipped.bucket ?? 'current',
    audio: false,
    kind,
    targets: skipped.targets ?? [],
    ru: skipped.ru,
    en: skipped.en,
    ...(skipped.enAlt?.length ? { enAlt: skipped.enAlt } : {}),
    ...(skipped.note !== undefined ? { note: skipped.note } : {}),
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
export function buildExercises(session, { words = [], phrases = [], rng = Math.random, encounterCount = null } = {}) {
  const vocab = new Map(shapeVocab(words).map((v) => [v.id, v]))
  const recordByKey = new Map(words.map((w) => [w.key, w]))
  const ctx = { vocab, recordByKey, phrases, rng, encounterCount }

  const out = []
  let seq = 0
  const make = (base) => ({ id: `ex${seq++}`, ...base })

  ;(session.practices ?? []).forEach((practice, pi) => {
    for (const exercise of generate(practice, pi, ctx, make)) out.push(exercise)
  })
  return out
}
