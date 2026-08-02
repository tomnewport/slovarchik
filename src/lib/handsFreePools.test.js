import { describe, it, expect } from 'vitest'

import {
  FATAL_ERRORS,
  newWordsPool,
  knownWordsPool,
  phraseToRuPool,
  phrasePool,
  buildPools,
} from './handsFreePools.js'

const vocab = [
  { id: 'a', ru: 'а' },
  { id: 'b', ru: 'б' },
  { id: 'c', ru: 'в' },
]
const phrases = [
  { id: 'p1', source: 'a' },
  { id: 'p2', source: 'b' },
  { id: 'p3', source: 'c' },
]

describe('FATAL_ERRORS', () => {
  it('includes the permission/hardware failures', () => {
    expect(FATAL_ERRORS.has('not-allowed')).toBe(true)
    expect(FATAL_ERRORS.has('audio-capture')).toBe(true)
    expect(FATAL_ERRORS.has('no-speech')).toBe(false)
  })
})

describe('newWordsPool', () => {
  it('draws from the current learning batch when it has words', () => {
    const pool = newWordsPool(vocab, new Set(['a', 'c']), () => 'unknown')
    expect(pool.map((w) => w.id)).toEqual(['a', 'c'])
  })

  it('falls back to words being learned when the batch is empty', () => {
    const stateOf = (id) => (id === 'b' ? 'learning' : 'unknown')
    const pool = newWordsPool(vocab, new Set(), stateOf)
    expect(pool.map((w) => w.id)).toEqual(['b'])
  })
})

describe('knownWordsPool', () => {
  it('keeps only words answered correctly at least once', () => {
    const hasBeenCorrect = (id) => id !== 'b'
    expect(knownWordsPool(vocab, hasBeenCorrect).map((w) => w.id)).toEqual(['a', 'c'])
  })
})

describe('phraseToRuPool', () => {
  it('gates on the source word being at least learned', () => {
    const stateOf = (id) => (id === 'a' ? 'learned' : id === 'c' ? 'mastered' : 'learning')
    expect(phraseToRuPool(phrases, stateOf).map((p) => p.id)).toEqual(['p1', 'p3'])
  })
})

describe('phrasePool', () => {
  it('admits phrases whose source is in the batch or has been correct', () => {
    const learningKeys = new Set(['a'])
    const hasBeenCorrect = (id) => id === 'c'
    expect(phrasePool(phrases, learningKeys, hasBeenCorrect).map((p) => p.id)).toEqual(['p1', 'p3'])
  })
})

describe('buildPools', () => {
  it('assembles all six activity pools and shares the known/phrase lists', () => {
    const stateOf = (id) => (id === 'a' ? 'learned' : 'unknown')
    const hasBeenCorrect = (id) => id === 'a'
    const pools = buildPools({
      vocab,
      phrases,
      learningKeys: new Set(['b']),
      stateOf,
      hasBeenCorrect,
    })
    expect(Object.keys(pools).sort()).toEqual([
      'new-words',
      'phrase-to-russian',
      'repeat-phrase',
      'translate-phrase',
      'translate-word',
      'word-test',
    ])
    // word-test and translate-word share the known-words list.
    expect(pools['word-test']).toBe(pools['translate-word'])
    // repeat-phrase and translate-phrase share the phrase list.
    expect(pools['repeat-phrase']).toBe(pools['translate-phrase'])
    expect(pools['new-words'].map((w) => w.id)).toEqual(['b'])
    expect(pools['word-test'].map((w) => w.id)).toEqual(['a'])
    expect(pools['phrase-to-russian'].map((p) => p.id)).toEqual(['p1'])
  })
})
