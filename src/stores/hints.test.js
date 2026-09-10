// The form index is built once per vocabulary load, not once per consumer (#658).
//
// Two unrelated consumers want the same ~39.5k-entry surface-form index: the
// in-phrase hints in this store, and `shapePhrases`' prompt disambiguation over
// in `stores/vocab.js`. Both now read the single computed the vocab store
// exports. This test spies on the pure builder so a future caller that quietly
// rebuilds its own copy — ~260 ms on the corpus, on entry to every
// phrase-bearing drill — fails here rather than in a profile.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../lib/phraseHint.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, buildFormIndex: vi.fn(actual.buildFormIndex) }
})

import { buildFormIndex } from '../lib/phraseHint.js'
import { loadFixtureWords } from '../test/fixtures.js'
import { state as vocabState, phrases, formIndex } from './vocab.js'
import { hintTokensFor, diagnoseAnswer } from './hints.js'

const words = loadFixtureWords()

beforeEach(() => {
  vocabState.words = []
  // Drain the computeds so each test starts from a cold cache, then count only
  // the rebuild the test itself provokes.
  void formIndex.value
  void phrases.value
  buildFormIndex.mockClear()
})

describe('the form index is shared, not rebuilt per consumer', () => {
  it('builds once however many consumers read it', () => {
    vocabState.words = words

    void phrases.value
    hintTokensFor(words[0]?.usage?.[0]?.ru ?? 'привет')
    diagnoseAnswer('привет', { targetKey: words[0].key, target: words[0].ru })
    void phrases.value

    expect(buildFormIndex).toHaveBeenCalledTimes(1)
  })

  it('rebuilds exactly once when the vocabulary changes', () => {
    vocabState.words = words
    void phrases.value
    expect(buildFormIndex).toHaveBeenCalledTimes(1)

    vocabState.words = words.slice(0, 10)
    void phrases.value
    void formIndex.value
    expect(buildFormIndex).toHaveBeenCalledTimes(2)
  })

  it('hands shapePhrases the same index the hints use', () => {
    vocabState.words = words
    void phrases.value

    // `shapePhrases` receives the store's index as an argument rather than
    // letting `promptHints` fall back to building its own.
    expect(buildFormIndex).toHaveBeenCalledTimes(1)
    expect(buildFormIndex).toHaveBeenCalledWith(words)
  })
})

describe('hintTokensFor', () => {
  beforeEach(() => {
    vocabState.words = words
  })

  it('tags a known Russian word with the entry that explains it', () => {
    const target = words.find((w) => w.ru && !w.ru.includes(' '))
    const tokens = hintTokensFor(target.ru)
    const hinted = tokens.find((t) => t.hint)
    expect(hinted).toBeTruthy()
    expect(hinted.hint.en).toBeTruthy()
  })

  it('leaves a token no dictionary entry claims unhinted', () => {
    expect(hintTokensFor('щщщщ').every((t) => t.hint === null)).toBe(true)
  })
})
