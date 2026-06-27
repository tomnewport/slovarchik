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
//   phrase-fix restore an inflection in a phrase (inflect-context)
//
// Every descriptor carries `targets` (the word keys it should report to the
// progress store) plus `dimension`/`level` so results map back to the model.

import { sample, shuffle } from './quiz.js'
import { cefrRank } from './batches.js'
import { shapeVocab } from './vocabBuild.js'
import { buildParadigm } from './paradigm.js'
import { buildContextExercise, canBuildContext } from './phraseContext.js'

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
  'inflect-context': 'phrase-fix',
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
 * Group items into tiers by how many times they have already been drawn this
 * session (the 0-used tier first, then 1-used, …), preserving the incoming
 * order within each tier. Drawing tier-by-tier guarantees a word is never used
 * an Nth time until every other candidate has been used N−1 times, so a single
 * lesson can't drill the same word over and over.
 */
function bucketByUsage(items, used, keyOf) {
  const tiers = new Map()
  for (const it of items) {
    const u = used.get(keyOf(it)) ?? 0
    if (!tiers.has(u)) tiers.set(u, [])
    tiers.get(u).push(it)
  }
  return [...tiers.keys()].sort((a, b) => a - b).map((u) => tiers.get(u))
}

/**
 * Take up to `n` items from `rest`, lowest CEFR level first: a level is fully
 * exhausted before any of the next level up is touched. Within a level the
 * least-session-used items come first (shuffled within a usage tier) so the
 * fillers vary and spread across the lesson instead of repeating. This keeps
 * top-up words at (or, only once a level runs dry, just above) the learner's
 * level instead of pulling random advanced vocabulary into a low-level exercise.
 */
function topUpByLevel(rest, n, rng, used, keyOf) {
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
    for (const tier of bucketByUsage(byRank.get(r), used, keyOf)) {
      if (out.length >= n) break
      out.push(...shuffle(tier, rng).slice(0, n - out.length))
    }
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
 * Draw up to `n` distinct items, least-session-used first, and within the
 * least-used tier biased toward the front (worst-understood) when `frontBias`
 * is set, otherwise drawn uniformly at random. Spreading by usage is what stops
 * a single worst-understood word from being picked by every practice in a row.
 */
function sampleSpread(items, n, rng, used, keyOf, frontBias) {
  if (n <= 0) return []
  const out = []
  for (const tier of bucketByUsage(items, used, keyOf)) {
    if (out.length >= n) break
    const need = n - out.length
    out.push(...(frontBias ? frontBiasedSample(tier, need, rng) : sample(tier, need, rng)))
  }
  return out
}

/**
 * Draw up to `n` items, preferring the pool and only then topping up from the
 * rest. Pool items always win when there are enough of them; the top-up draws
 * the lowest available CEFR level first (see {@link topUpByLevel}). When
 * `frontBias` is set (the current bucket) pool items are drawn worst-first
 * rather than uniformly, so the worst-understood words get the most practice.
 *
 * Every drawn key is recorded in the session-wide `used` map so later practices
 * spread onto other words instead of repeating these (mid-lesson re-prioritised
 * spacing): a word recurs only once the rest of its pool has had a turn.
 */
function drawN(pool, rest, n, rng, { frontBias = false, used, keyOf }) {
  const chosen = sampleSpread(pool, n, rng, used, keyOf, frontBias)
  const result =
    chosen.length >= n
      ? chosen
      : [...chosen, ...topUpByLevel(rest, n - chosen.length, rng, used, keyOf)]
  for (const it of result) {
    const k = keyOf(it)
    if (k != null) used.set(k, (used.get(k) ?? 0) + 1)
  }
  return result
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
  const picked = drawN(pool, rest, practice.items ?? MATCH_PAIRS, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (w) => w.id,
  })
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
  // Never draw a word the learner has skipped speaking for into a speak exercise.
  if (kind === 'speak' && ctx.skipsSpeaking) {
    pool = pool.filter((w) => !ctx.skipsSpeaking(w.id))
    rest = rest.filter((w) => !ctx.skipsSpeaking(w.id))
  }
  if (kind === 'type' && pool.length + rest.length < MIN_WORDS_FOR_SPELLING) return []
  const picked = drawN(pool, rest, practice.exercises, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (w) => w.id,
  })
  return picked.map((w) =>
    make({
      ...common(practice, pi),
      kind,
      targets: [w.id],
      ru: w.ru,
      en: enText(w.en),
      note: w.note,
      ...(w.alsoRu?.length ? { alsoRu: w.alsoRu } : {}),
      ...(w.ambiguousEn?.length ? { ambiguousEn: w.ambiguousEn } : {}),
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
  const picked = drawN(pool, rest, practice.exercises, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (p) => p.source,
  })
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
  const picked = drawN(inflectable(pool), inflectable(topUpSource), practice.exercises, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (r) => r.key,
  })
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

function buildContext(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const bctx = { phrasesByKey: ctx.contextPhrases, rules: ctx.rules }
  const resolvable = (list) =>
    list.map((v) => ctx.recordByKey.get(v.id)).filter((r) => r && canBuildContext(r, bctx))
  // Like buildInflect, mastery exercises never widen beyond the committed batch.
  const topUpSource = practice.level === 'mastery' ? [] : rest
  const picked = drawN(resolvable(pool), resolvable(topUpSource), practice.exercises, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (r) => r.key,
  })
  const out = []
  for (const r of picked) {
    const ex = buildContextExercise(r, { ...bctx, rng: ctx.rng })
    if (ex) out.push(make({ ...common(practice, pi), ...ex, targets: [r.key] }))
  }
  return out
}

function generate(practice, pi, ctx, make) {
  const kind = PRACTICE_KIND[practice.practiceType]
  switch (kind) {
    case 'match':
      return buildMatch(practice, pi, ctx, make)
    case 'phrase-fix':
      return buildContext(practice, pi, ctx, make)
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

/** A visual (no-audio) type/spell descriptor for one word's content. */
function visType(content, skipped, id) {
  return {
    id,
    practiceIndex: skipped.practiceIndex ?? 0,
    practiceType: 'spell-word',
    dimension: 'identification',
    level: skipped.level ?? 'learning',
    content: 'word',
    bucket: skipped.bucket ?? 'current',
    audio: false,
    kind: 'type',
    targets: [content.key].filter(Boolean),
    ru: content.ru,
    en: content.en,
    ...(content.note !== undefined ? { note: content.note } : {}),
  }
}

/** A visual (no-audio) word-bank descriptor for one phrase's content. */
function visWordbank(content, skipped, id) {
  return {
    id,
    practiceIndex: skipped.practiceIndex ?? 0,
    practiceType: 'translate-phrase',
    dimension: 'identification',
    level: skipped.level ?? 'learning',
    content: 'phrase',
    bucket: skipped.bucket ?? 'current',
    audio: false,
    kind: 'wordbank',
    targets: [content.source].filter(Boolean),
    ru: content.ru,
    en: content.en,
    ...(content.enAlt?.length ? { enAlt: content.enAlt } : {}),
  }
}

/** Cycle through a list, wrapping at the end (null for an empty list). */
function cyclePicker(list) {
  let i = 0
  return () => (list.length ? list[i++ % list.length] : null)
}

/**
 * Create a picker that hands out the highest-priority replacement content for a
 * skipped modality, recalculated from the current pools rather than reusing the
 * skipped word. `wordKeys`/`phrases` arrive already in priority order (worst
 * understood first); words/phrases already covered this session (`exclude`) are
 * dropped so a backfill targets fresh priorities, and each candidate is yielded
 * round-robin so a long backfill never drills the same word repeatedly.
 *
 * @returns {{word: () => object|null, phrase: () => object|null}}
 */
export function makeReplacementPicker({
  wordKeys = [],
  phrases = [],
  vocabById = new Map(),
  exclude = new Set(),
} = {}) {
  const words = wordKeys.filter((k) => vocabById.has(k))
  const freshWords = words.filter((k) => !exclude.has(k))
  const nextWordKey = cyclePicker(freshWords.length ? freshWords : words)

  const usable = phrases.filter((p) => p?.source && p?.ru && p?.en)
  const freshPhrases = usable.filter((p) => !exclude.has(p.source))
  const nextPhrase = cyclePicker(freshPhrases.length ? freshPhrases : usable)

  return {
    word() {
      const k = nextWordKey()
      if (k == null) return null
      const v = vocabById.get(k)
      return v ? { key: k, ru: v.ru, en: enText(v.en), note: v.note } : null
    },
    phrase() {
      const p = nextPhrase()
      return p ? { source: p.source, ru: p.ru, en: p.en, enAlt: p.enAlt } : null
    },
  }
}

/**
 * Build a visual replacement exercise for a skipped speaking/listening item: a
 * word-bank (phrase) or type (word) exercise needing no audio input or output.
 *
 * With a `picker` the replacement targets the *recalculated* highest-priority
 * words/phrases for the visual exercise type (not just the skipped word), so
 * skipping a modality steers practice toward what still needs doing. Without one
 * (or once the picker's priority pool is exhausted) it falls back to covering
 * exactly the skipped item's own content.
 *
 * @param {object} skipped  exercise/phrase-like descriptor (the fallback content)
 * @param {number} seq      monotonically-increasing counter for unique ids
 * @param {object} [picker] from {@link makeReplacementPicker}
 * @returns {object|object[]|null} descriptor(s), or null if no content is available
 */
export function makeVisualReplacement(skipped, seq, picker = null) {
  const pick = (isWord) => (picker ? (isWord ? picker.word() : picker.phrase()) : null)

  // Match exercises bundle multiple pairs with no top-level ru/en — expand each
  // into an individual type (spell-word) exercise, re-prioritised when possible.
  if (skipped?.kind === 'match' && skipped.pairs?.length) {
    return skipped.pairs
      .map((pair, i) => {
        const content = pick(true) || { key: pair.key, ru: pair.ru, en: pair.en }
        return content.ru && content.en ? visType(content, skipped, `vis${seq}_${i}`) : null
      })
      .filter(Boolean)
  }

  const isWord = skipped?.content === 'word'
  const content =
    pick(isWord) ||
    (skipped?.ru && skipped?.en
      ? isWord
        ? { key: (skipped.targets ?? [])[0], ru: skipped.ru, en: skipped.en, note: skipped.note }
        : { source: (skipped.targets ?? [])[0], ru: skipped.ru, en: skipped.en, enAlt: skipped.enAlt }
      : null)
  if (!content) return null
  return isWord ? visType(content, skipped, `vis${seq}`) : visWordbank(content, skipped, `vis${seq}`)
}

/**
 * Build the flat exercise list for a session.
 * @param {object} session   from store.startSession (has `.practices`)
 * @param {object} sources
 * @param {object[]} sources.words   normalised word records (vocab store)
 * @param {object[]} sources.phrases shaped phrases ({ id, ru, en, source, cefr })
 * @param {Map} [sources.contextPhrases] key → annotated context phrases (drill)
 * @param {object} [sources.rules] grammar-rules map (rule id → explanation)
 * @param {() => number} [sources.rng]
 * @param {(key: string) => boolean} [sources.skipsSpeaking] whether the learner
 *   has waived speaking for a word — such words are kept out of speak exercises.
 * @returns {object[]} exercise descriptors (each with a unique `id`)
 */
export function buildExercises(
  session,
  {
    words = [],
    phrases = [],
    rng = Math.random,
    encounterCount = null,
    contextPhrases = new Map(),
    rules = {},
    skipsSpeaking = null,
  } = {},
) {
  const vocab = new Map(shapeVocab(words).map((v) => [v.id, v]))
  const recordByKey = new Map(words.map((w) => [w.key, w]))
  // Shared across every practice so draws spread over the whole lesson: a word
  // recurs only once the rest of its pool has had a turn (mid-lesson spacing).
  const used = new Map()
  const ctx = { vocab, recordByKey, phrases, rng, encounterCount, contextPhrases, rules, used, skipsSpeaking }

  const out = []
  let seq = 0
  const make = (base) => ({ id: `ex${seq++}`, ...base })

  ;(session.practices ?? []).forEach((practice, pi) => {
    for (const exercise of generate(practice, pi, ctx, make)) out.push(exercise)
  })
  return out
}
