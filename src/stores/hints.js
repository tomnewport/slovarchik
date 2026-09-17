// Reactive glue for in-phrase word hints (#131).
//
// Combines the pure surface-form index (phraseHint) with the learner's progress
// so the UI can ask, for any Russian word in a phrase, "should this be
// hintable, and if so what does it mean?". A word is hintable when it maps to a
// known dictionary entry that the learner has **not** yet learned and that
// **isn't** in the batch they're currently learning/mastering — i.e. words they
// can't be expected to know yet and aren't actively drilling.
import { computed } from 'vue'

import { alignOptsFor, formIndex, state as vocabState, wordsByKey } from './vocab.js'
import { state as progressState, stateOf } from './progress.js'
import { normToken, senseGloss } from '../lib/phraseHint.js'
import { alignedHintTokens } from '../lib/phraseAlign.js'
import { typingSequence } from '../lib/phrases.js'
import { buildSpeakingAid } from '../lib/speakingAid.js'
import { buildGlossIndex, diagnose, diagnoseEnglish } from '../lib/confusables.js'
import { STATES } from '../lib/progression.js'

const LEARNED_RANK = STATES.indexOf('learned')

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
 *
 * Glosses come from word alignment rather than straight off the form index
 * (#706), which is what stops «Мой ру́ки!» glossing мой as "my": the index hands
 * a contested form to whichever entry won its collision rules, and alignment
 * knows — from the sentence's own annotations, from a stub's `lemma:` link, or
 * from the English — when that winner is the wrong word. Tokens alignment can't
 * settle keep the index's stacked senses, so the homograph behaviour (#568) is
 * untouched where it is still the honest answer.
 * @param {string} phrase
 * @returns {Array<{text: string, hint: PlainObject|null}>}
 */
export function hintTokensFor(phrase) {
  return alignedHintTokens(phrase, formIndex.value, alignOptsFor(phrase)).map(
    ({ text, hint }) => ({ text, hint: hintIfShowable(hint) }),
  )
}

/**
 * The aids a speaking exercise offers for one sentence: the free dictionary of
 * its non-target words and the blanked sentence behind the first hint (#733).
 *
 * Lives here rather than in the component because it needs the same two things
 * `hintTokensFor` does — the surface-form index and the sentence's alignment
 * options — and building either twice is pure waste. Its dictionary follows
 * the same learned-word and current-batch rules as the inline phrase glosses.
 *
 * @param {string} phrase  the Russian sentence
 * @param {{targets?: string[], targetTokens?: string[]}} [about]  the word(s)
 *   being assessed — never glossed, and blanked out of the sentence
 * @returns {{dictionary: PlainObject[], skeleton: PlainObject[], hasSkeleton: boolean}}
 */
export function speakingAidFor(phrase, about = {}) {
  const tokens = alignedHintTokens(phrase, formIndex.value, alignOptsFor(phrase)).map(
    (token) => ({ ...token, hint: hintIfShowable(token.hint) }),
  )
  return buildSpeakingAid(tokens, about)
}

/** Short English headword for a word tile, when its gloss names one word. */
function englishTileKey(gloss) {
  const term = typingSequence(String(gloss ?? '').split(/[(/,;]/)[0]).replace(/^to /, '')
  return term && !term.includes(' ') ? term : ''
}

/**
 * Meanings to put under first-encounter word-bank tiles. The source sentence
 * takes precedence over a generic dictionary lookup, so a homograph is glossed
 * in context. Decoys get the same lookup; a source-only label on real tiles
 * would identify every distractor before the learner has read it. A word with
 * no trustworthy one-word counterpart is left alone (e.g. English articles,
 * which Russian does not have).
 *
 * @param {string} ru the Russian sentence
 * @param {Array<{id: number, text: string}>} tiles
 * @param {'ru'|'en'} lang the language of the tiles
 * @returns {Map<number, string>}
 */
export function chipGlossesFor(ru, tiles, lang) {
  const source = new Map()
  const blocked = new Set()
  for (const { text, hint: raw } of alignedHintTokens(ru, formIndex.value, alignOptsFor(ru))) {
    const hint = hintIfShowable(raw)
    if (lang === 'en' && raw) {
      for (const sense of raw.senses) {
        if (!isSenseShowable(sense)) blocked.add(englishTileKey(sense.en))
      }
    }
    if (!hint) continue
    if (lang === 'ru') source.set(normToken(text), hint.en)
    else {
      for (const sense of hint.senses) {
        const key = englishTileKey(sense.en)
        if (key && !source.has(key)) source.set(key, text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
      }
    }
  }

  // English distractors may not occur in this sentence. Look them up in the
  // same unlearned dictionary; ambiguous glosses stay untranslated rather than
  // assigning an arbitrary Russian word to the chip.
  const reverse = new Map()
  if (lang === 'en') {
    for (const word of vocabState.words) {
      if (!isSenseShowable(word)) continue
      for (const meaning of word.english ?? [word.meaning ?? word.en]) {
        const key = englishTileKey(meaning)
        if (!key) continue
        const ruWord = word.headword ?? word.ru
        if (!reverse.has(key)) reverse.set(key, ruWord)
        else if (reverse.get(key) !== ruWord) reverse.set(key, null)
      }
    }
  }

  const out = new Map()
  for (const tile of tiles ?? []) {
    const key = lang === 'ru' ? normToken(tile.text) : typingSequence(tile.text)
    const gloss = source.get(key) ?? (lang === 'ru'
      ? hintTokensFor(tile.text)[0]?.hint?.en
      : blocked.has(key) ? null : reverse.get(key))
    if (gloss) out.set(tile.id, gloss)
  }
  return out
}

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
 * @param {{targetKey?: string, target?: string}} [about] the word being drilled
 *   and the surface form wanted (a single word, or the whole phrase)
 */
export function diagnoseAnswer(typed, { targetKey, target } = {}) {
  return diagnose(typed, {
    targetKey,
    target,
    formIndex: formIndex.value,
    byKey: wordsByKey.value,
  })
}

// Gloss → keys, cached per autocomplete pool. The flashcard drill hands the same
// pool array to every card of an exercise, so the index is built once per board
// rather than once per guess.
const glossIndexes = new WeakMap()

function glossIndexFor(pool) {
  if (!Array.isArray(pool) || !pool.length) return null
  let index = glossIndexes.get(pool)
  if (!index) {
    index = buildGlossIndex(pool)
    glossIndexes.set(pool, index)
  }
  return index
}

/**
 * The same diagnosis in the English direction: the learner saw the Russian and
 * typed a gloss that wasn't the one wanted — whose word were they describing?
 * Null when the gloss belongs to no word we know.
 *
 * @param {string} typed the English the learner gave
 * @param {{targetKey?: string, options?: Array}} [about] the card's word and the
 *   drill's autocomplete pool, which doubles as the gloss index's source
 */
export function diagnoseEnglishAnswer(typed, { targetKey, options } = {}) {
  const glossIndex = glossIndexFor(options)
  if (!glossIndex) return null
  return diagnoseEnglish(typed, { targetKey, byKey: wordsByKey.value, glossIndex })
}
