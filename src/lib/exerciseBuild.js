// Turn a built session (from the store's startSession) into a flat list of
// concrete exercise descriptors the runner steps through and the Vue exercise
// components render. Pure and framework-free; randomness is injectable.
//
// Each practice in the session names a practice type, a learning dimension and
// a candidate word pool (its 25/25/50 bucket). Here we draw real words/phrases
// from that pool — topping up from the wider vocabulary when a pool is thin —
// and shape them into descriptors keyed by a render `kind`:
//
//   match    flashcards (produce the English)  (match-vocab, listen-match)
//   wordbank assemble a translation          (translate-phrase, listen-translate)
//   type     spell with the hintable keyboard (spell-word, spell-phrase, dictation)
//   speak    repeat aloud                     (repeat-word, repeat-phrase)
//   inflect  fill an inflection table         (inflect-bank, inflect-keyboard)
//   verb-contrast pick the aspect / motion partner per sentence, then conjugate
//            (inflect-keyboard, emitted instead of the table for paired verbs)
//   phrase-fix restore an inflection in a set of phrases (inflect-context)
//
// Every descriptor carries `targets` (the word keys it should report to the
// progress store) plus `dimension`/`level` so results map back to the model.

import { sample, shuffle } from './quiz.js'
import { cefrRank } from './batches.js'
import { shapeVocab, vocabDisplay } from './vocabBuild.js'
import { buildWordParadigms, hasParadigm } from './paradigm.js'
import { buildContrastDrill, buildContextSet, canBuildContext } from './phraseContext.js'
import { wordTokensInPhrase } from './phraseHint.js'

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

/** Flashcards shown in a single identification exercise (#412). */
export const MATCH_PAIRS = 12

/**
 * Most sentences bundled into one in-context inflection exercise
 * (inflect-context). A set drills ONE lexical item — several sentences of the
 * same drawn word or, for a verb, of its aspect pair — so the learner can
 * contrast the English uses of the word against its Russian uses. Sets shrink
 * to the sentences the item actually has.
 */
export const CONTEXT_SET_ITEMS = 3

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
 * A disambiguated display gloss: the base English plus any bracketed note that
 * tells near-identical meanings apart ("hat" + "winter" → "hat (winter)"). Used
 * both as the flashcard option label and to grade a picked option, so the two
 * hats can be told apart even though their base gloss is the same (#473).
 */
function glossLabel(en, note) {
  return note ? `${en} (${note})` : en
}

/**
 * A flashcard `{ key, ru, en, label, pos }` pair for one shaped vocab word, with
 * its shown surface form resolved (singular/plural), a disambiguated label, and
 * its part of speech (shown on the card, #503).
 */
function matchPair(w, rng) {
  const d = vocabDisplay(w, rng)
  const en = enText(d.en)
  return { key: w.id, ru: d.ru, en, label: glossLabel(en, w.note), pos: w.pos }
}

/**
 * The shared autocomplete pool for the flashcard drill (#473): one entry per
 * shaped vocab word, carrying its base gloss (what a guess matches against) and
 * a disambiguated label (what is shown / graded on a pick). The same array is
 * referenced by every match exercise, so it costs nothing to attach widely.
 */
function buildOptionPool(vocab) {
  const out = []
  for (const w of vocab.values()) {
    const en = enText(w.en)
    if (!en) continue
    out.push({ key: w.id, ru: w.ru, en, label: glossLabel(en, w.note) })
  }
  return out
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
  // Flashcards drill one combined pool, not one bucket at a time (#472): a single
  // board mixes current-batch, at-risk, due and slipped words instead of running
  // separate boards for "learning" and "known" words. The combined pool is
  // ordered worst-understood first (current batch leads), so front-biasing still
  // favours the words that need the most work. Falls back to the practice's own
  // bucket pool when no session-wide pool is available (e.g. unit tests).
  const poolKeys = ctx.matchPoolKeys ?? practice.pool
  const { pool, rest } = splitWords(poolKeys, ctx.vocab)
  // Card count comes from the practice catalogue (`items`), defaulting to MATCH_PAIRS.
  const picked = drawN(pool, rest, practice.items ?? MATCH_PAIRS, ctx.rng, {
    frontBias: true,
    used: ctx.used,
    keyOf: (w) => w.id,
  })
  if (picked.length < 2) return []
  return [
    make({
      ...common(practice, pi),
      kind: 'match',
      pairs: picked.map((w) => matchPair(w, ctx.rng)),
      targets: picked.map((w) => w.id),
      // Type-ahead autocomplete candidates (#473) — the whole dictionary.
      options: ctx.optionPool,
    }),
  ]
}

/**
 * Build one combined flashcard exercise from the words missed across a session
 * (#472): every wrong word, then — if that is fewer than MATCH_PAIRS — the
 * weakest correctly-guessed words as top-up, so a short mistake list still fills
 * a full board. When more than MATCH_PAIRS words were missed the board simply
 * grows to hold them all. `topUpKeys` must already be ordered weakest-first.
 *
 * @param {object} args
 * @param {string[]} args.wrongKeys   words answered wrong (always included)
 * @param {string[]} [args.topUpKeys] correctly-guessed words, weakest first
 * @param {Map} args.vocabById        shaped vocab by id (from shapeVocab)
 * @param {Array} [args.options]      the shared autocomplete pool
 * @param {string} [args.id]
 * @returns {object|null} a match descriptor, or null if fewer than two words resolve
 */
export function buildCombinedFlashcard({
  wrongKeys = [],
  topUpKeys = [],
  vocabById,
  options = [],
  dimension = 'identification',
  level = 'learning',
  audio = false,
  id = 'fc-repeat',
  rng = Math.random,
} = {}) {
  const seen = new Set()
  const keys = []
  const add = (k) => {
    if (k != null && !seen.has(k) && vocabById.has(k)) {
      seen.add(k)
      keys.push(k)
    }
  }
  for (const k of wrongKeys) add(k)
  for (const k of topUpKeys) {
    if (keys.length >= MATCH_PAIRS) break
    add(k)
  }
  if (keys.length < 2) return null
  return {
    id,
    practiceIndex: -1, // not part of the planned pass — a repeat board
    practiceType: 'match-vocab',
    dimension,
    level,
    content: 'word',
    bucket: 'current',
    audio,
    kind: 'match',
    pairs: shuffle(
      keys.map((k) => matchPair(vocabById.get(k), rng)),
      rng,
    ),
    targets: keys,
    options,
    repeat: true,
  }
}

function buildWordType(practice, pi, ctx, make, kind) {
  let { pool, rest } = splitWords(practice.pool, ctx.vocab)
  if (kind === 'type' && ctx.encounterCount) {
    const met = (w) => ctx.encounterCount(w.id) >= MIN_ENCOUNTERS_FOR_SPELLING
    pool = pool.filter(met)
    rest = rest.filter(met)
  }
  if (kind === 'type' && pool.length + rest.length < MIN_WORDS_FOR_SPELLING) return []
  const picked = drawN(pool, rest, practice.exercises, ctx.rng, {
    frontBias: practice.bucket === 'current',
    used: ctx.used,
    keyOf: (w) => w.id,
  })
  return picked.map((w) => {
    const d = vocabDisplay(w, ctx.rng)
    return make({
      ...common(practice, pi),
      kind,
      targets: [w.id],
      ru: d.ru,
      en: enText(d.en),
      note: w.note,
      // Part of speech, so a spelling prompt says which kind of word to spell —
      // "cold" as an adjective vs an adverb, say (#503).
      pos: w.pos,
      // Verbal aspect, rendered next to the part of speech. For an aspect pair
      // both members share a gloss and a note, so the aspect is the only thing
      // that says whether уби́ть or убива́ть is wanted (#527).
      ...(w.aspect ? { aspect: w.aspect } : {}),
      // `alsoRu` are alternate singular spellings — only offer them when the
      // singular is being shown, or they wouldn't match the plural prompt.
      ...(d.number === 'sg' && w.alsoRu?.length ? { alsoRu: w.alsoRu } : {}),
      ...(w.ambiguousEn?.length ? { ambiguousEn: w.ambiguousEn } : {}),
    })
  })
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
  return picked.map((p) => {
    const base = {
      ...common(practice, pi),
      kind,
      targets: [p.source].filter(Boolean),
      ru: p.ru,
      en: p.en,
      ...(p.enAlt?.length ? { enAlt: p.enAlt } : {}),
      // What the Russian commits to that the English can't show — informal vs
      // formal "you", the speaker's gender. Carried so a prompt showing only
      // the English can annotate the ambiguous word (see phraseAmbiguity.js).
      ...(p.enNotes?.length ? { enNotes: p.enNotes } : {}),
    }
    // For spelling (type) a phrase, record which token(s) are the word being
    // assessed so a wrong answer only penalises the word if the slip was in it.
    if (kind === 'type' && p.source) {
      const record = ctx.recordByKey.get(p.source)
      const tokens = record ? wordTokensInPhrase(p.ru, record) : []
      if (tokens.length) base.targetTokens = tokens
    }
    return make(base)
  })
}

function buildInflect(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const inflectable = (list) =>
    list.map((v) => ctx.recordByKey.get(v.id)).filter((r) => r && hasParadigm(r))
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
  return picked.map((r) => {
    // Which of the word's tables to drill. Beyond its primary paradigm a word may
    // carry a variant — an adjective's short form, a verb's participles/gerund or
    // short passive — and until #575 the session could only ever serve the primary
    // one, leaving 206 drillable tables to free practice alone. They are drawn
    // uniformly, so a word with a short form drills it about half the time:
    // «Магази́н закры́т» is how the predicate is normally said, not an extra.
    const [table] = sample(buildWordParadigms(r), 1, ctx.rng)
    // Usage mastery for a verb with a linked partner is the contrast drill —
    // pick the right member of the pair (imperfective/perfective, or for a verb
    // of motion determinate/indeterminate) for a batch of English sentences,
    // then spell one conjugated form — rather than typing the full table. Verbs
    // the drill can't be built for (no partner, thin data) keep the table, and a
    // turn that drew a variant is drilling participles rather than aspect, so it
    // keeps the table too.
    if (mode === 'keyboard' && r.pos === 'verb' && !table?.variant) {
      const drill = buildContrastDrill(r, {
        phrasesByKey: ctx.contextPhrases,
        phrasesBySource: ctx.phrasesBySource,
        rules: ctx.rules,
        rng: ctx.rng,
      })
      if (drill) return make({ ...common(practice, pi), ...drill })
    }
    return make({
      ...common(practice, pi),
      kind: 'inflect',
      mode,
      // A variant shares its lemma's mastery state (#575): the table is another
      // way of assessing the same word, so it is graded against `word.key` and
      // needs no progress key of its own.
      targets: [r.key],
      wordKey: r.key,
      variant: table?.variant ?? null,
      lemma: r.headword || r.ru,
    })
  })
}

function buildContext(practice, pi, ctx, make) {
  const { pool, rest } = splitWords(practice.pool, ctx.vocab)
  const bctx = { phrasesByKey: ctx.contextPhrases, rules: ctx.rules }
  const resolvable = (list) =>
    list.map((v) => ctx.recordByKey.get(v.id)).filter((r) => r && canBuildContext(r, bctx))
  // Like buildInflect, mastery exercises never widen beyond the committed batch.
  const topUpSource = practice.level === 'mastery' ? [] : rest
  const poolKeys = new Set(practice.pool ?? [])
  const out = []
  // Each exercise is a SET of sentences that all drill the SAME lexical item —
  // up to `items` sentences of one drawn word (or, for a verb, of its aspect
  // pair) — so the learner contrasts the English uses of that word against its
  // Russian uses instead of hopping between unrelated words. Each item keeps
  // its own single-word `targets`; the set's `targets` is their (deduplicated)
  // union, and the component reports per-word results (`wrong`) against it.
  for (let e = 0; e < (practice.exercises ?? 1); e++) {
    const [word] = drawN(resolvable(pool), resolvable(topUpSource), 1, ctx.rng, {
      frontBias: practice.bucket === 'current',
      used: ctx.used,
      keyOf: (r) => r.key,
    })
    if (!word) break
    const partner = word.aspectPair?.key ? ctx.recordByKey.get(word.aspectPair.key) : null
    const items = buildContextSet(word, {
      ...bctx,
      rng: ctx.rng,
      items: practice.items ?? CONTEXT_SET_ITEMS,
      partner,
    })
    // Mastery discipline: an aspect partner outside the committed batch must
    // not record mastery attempts. Its sentences still assess the drawn word's
    // skill (choosing between the pair IS that skill), so — exactly as the
    // aspect drill does — report them against the drawn word instead.
    if (practice.level === 'mastery') {
      for (const it of items) {
        if (!(it.targets ?? []).every((k) => k === word.key || poolKeys.has(k))) {
          it.targets = [word.key]
        }
      }
    }
    if (items.length) {
      out.push(
        make({
          ...common(practice, pi),
          kind: 'phrase-fix',
          items,
          targets: [...new Set(items.flatMap((it) => it.targets ?? []))],
        }),
      )
    }
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
    ...(content.pos ? { pos: content.pos } : {}),
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
  rng = Math.random,
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
      if (!v) return null
      const d = vocabDisplay(v, rng)
      return { key: k, ru: d.ru, en: enText(d.en), note: v.note, pos: v.pos }
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
        const content = pick(true) || { key: pair.key, ru: pair.ru, en: pair.en, pos: pair.pos }
        return content.ru && content.en ? visType(content, skipped, `vis${seq}_${i}`) : null
      })
      .filter(Boolean)
  }

  const isWord = skipped?.content === 'word'
  const content =
    pick(isWord) ||
    (skipped?.ru && skipped?.en
      ? isWord
        ? { key: (skipped.targets ?? [])[0], ru: skipped.ru, en: skipped.en, note: skipped.note, pos: skipped.pos }
        : { source: (skipped.targets ?? [])[0], ru: skipped.ru, en: skipped.en, enAlt: skipped.enAlt }
      : null)
  if (!content) return null
  return isWord ? visType(content, skipped, `vis${seq}`) : visWordbank(content, skipped, `vis${seq}`)
}

/** At most this many intro cards in one session — an introduction is a pause. */
export const MAX_INTROS_PER_SESSION = 5

/**
 * Splice intro cards (#587) into a built exercise list: a non-graded "here is a
 * new word" step immediately before the first exercise that tests it.
 *
 * Just-in-time rather than batched at the top of the session, so the
 * introduction and the first test sit together. The rules keep it from becoming
 * the session:
 *  - **current-batch words only** — a top-up word pulled in to fill a thin pool
 *    shouldn't stop the lesson;
 *  - **at most one per exercise**, so a twelve-card flashcard board introduces
 *    one word and teaches the rest by reveal, as it does today;
 *  - **never two in a row**, and never more than {@link MAX_INTROS_PER_SESSION};
 *  - **once per session per word**, so a word introduced before its flashcard
 *    isn't introduced again before its spelling exercise;
 *  - **never after the word has already been met in this session**. A board that
 *    teaches a word by reveal has introduced it, whatever the label says, and a
 *    card headed "A new word" arriving afterwards is simply backwards.
 *
 * @param {object[]} exercises the built list, in order
 * @param {object} opts
 * @param {(key: string) => boolean} opts.needsIntro has this word never been
 *   met *and* never been introduced?
 * @param {Set<string>|string[]} [opts.batchKeys] words of the current batch; when
 *   absent every target is eligible
 * @param {number} [opts.max]
 * @returns {object[]} a new list with the intro descriptors spliced in
 */
export function spliceIntros(exercises = [], { needsIntro, batchKeys, max = MAX_INTROS_PER_SESSION } = {}) {
  if (typeof needsIntro !== 'function' || max <= 0) return exercises.slice()
  const eligible = batchKeys ? new Set(batchKeys) : null
  // Every word this session has already put in front of the learner — whether by
  // introducing it or by testing it. A word only gets a card while it is still
  // genuinely new to the session.
  const seen = new Set()
  const out = []
  let count = 0
  let lastWasIntro = false
  for (const ex of exercises) {
    if (count < max && !lastWasIntro) {
      const key = (ex.targets ?? []).find(
        (k) => k && !seen.has(k) && (!eligible || eligible.has(k)) && needsIntro(k),
      )
      if (key) {
        seen.add(key)
        count++
        out.push({
          id: `intro${count}`,
          kind: 'intro',
          // Not something the learner can get wrong: the runner walks past it
          // with `advance()` and it never enters the accuracy figures.
          graded: false,
          dimension: ex.dimension,
          level: ex.level,
          targets: [key],
          // It borrows the practice index of the exercise it precedes, so the
          // segmented progress bar stays coherent.
          practiceIndex: ex.practiceIndex ?? 0,
        })
        lastWasIntro = true
        out.push(ex)
        for (const k of ex.targets ?? []) if (k) seen.add(k)
        continue
      }
    }
    lastWasIntro = false
    out.push(ex)
    for (const k of ex.targets ?? []) if (k) seen.add(k)
  }
  return out
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
  } = {},
) {
  const vocab = new Map(shapeVocab(words).map((v) => [v.id, v]))
  const recordByKey = new Map(words.map((w) => [w.key, w]))
  // Usage phrases grouped by the word that owns them — the aspect drill draws a
  // verb pair's sentences from here (no `inflect:` annotation needed to pick).
  const phrasesBySource = new Map()
  for (const p of phrases) {
    if (!p?.source) continue
    if (!phrasesBySource.has(p.source)) phrasesBySource.set(p.source, [])
    phrasesBySource.get(p.source).push(p)
  }
  // Shared across every practice so draws spread over the whole lesson: a word
  // recurs only once the rest of its pool has had a turn (mid-lesson spacing).
  const used = new Map()
  // Flashcards draw from one combined pool spanning every bucket (#472), and
  // offer the whole dictionary as autocomplete candidates (#473). Both are built
  // once and shared. `matchPoolKeys` is null when the session carries no pools
  // (unit tests), so buildMatch falls back to each practice's own bucket pool.
  const matchPoolKeys = session.pools
    ? [
        ...new Set([
          ...(session.pools.current ?? []),
          ...(session.pools.atRisk ?? []),
          ...(session.pools.untested ?? []),
        ]),
      ]
    : null
  const optionPool = buildOptionPool(vocab)
  const ctx = {
    vocab,
    recordByKey,
    phrases,
    phrasesBySource,
    rng,
    encounterCount,
    contextPhrases,
    rules,
    used,
    matchPoolKeys,
    optionPool,
  }

  const out = []
  let seq = 0
  const make = (base) => ({ id: `ex${seq++}`, ...base })

  ;(session.practices ?? []).forEach((practice, pi) => {
    for (const exercise of generate(practice, pi, ctx, make)) out.push(exercise)
  })
  return out
}
