import { describe, it, expect } from 'vitest'

import { phraseProvesEncounter, encounteredKeys } from './encounters.js'
import { buildFormIndex } from './phraseHint.js'

const phrase = { content: 'phrase', kind: 'type', ru: 'Кот спит.' }

describe('phraseProvesEncounter', () => {
  it('credits a phrase typed correctly, unaided', () => {
    expect(phraseProvesEncounter(phrase, { correct: true, double: true })).toBe(true)
  })

  it('refuses a wrong answer', () => {
    expect(phraseProvesEncounter(phrase, { correct: false, double: false })).toBe(false)
  })

  it('refuses a correct answer that leaned on the keyboard hint', () => {
    // `double` is first-try-correct with the hint untouched; without it the
    // learner was shown letters they had not recalled.
    expect(phraseProvesEncounter(phrase, { correct: true, double: false })).toBe(false)
  })

  it('refuses a correct answer after the Dictionary was opened', () => {
    // The Dictionary glosses exactly the unlearned words of the phrase — the
    // encounter candidates — and costs no points, so `double` cannot see it.
    expect(phraseProvesEncounter(phrase, { correct: true, double: true, dictUsed: true })).toBe(
      false,
    )
  })

  it('credits an audio word bank, where nothing is glossed', () => {
    const ex = { content: 'phrase', kind: 'wordbank', ru: 'Кот спит.', audio: true }
    expect(phraseProvesEncounter(ex, { correct: true })).toBe(true)
  })

  it('refuses a visual word bank, whose cue glosses every unlearned word', () => {
    const ex = { content: 'phrase', kind: 'wordbank', ru: 'Кот спит.', audio: false }
    expect(phraseProvesEncounter(ex, { correct: true })).toBe(false)
  })

  it('ignores word-level exercises, whose target the attempt already records', () => {
    const ex = { content: 'word', kind: 'type', ru: 'кот' }
    expect(phraseProvesEncounter(ex, { correct: true, double: true })).toBe(false)
  })

  it('ignores exercise kinds it knows nothing about', () => {
    const ex = { content: 'phrase', kind: 'phrase-fix', ru: 'Кот спит.' }
    expect(phraseProvesEncounter(ex, { correct: true, double: true })).toBe(false)
  })

  it('survives a missing exercise, phrase or result', () => {
    expect(phraseProvesEncounter(null, { correct: true })).toBe(false)
    expect(phraseProvesEncounter({ content: 'phrase', kind: 'type' }, { correct: true })).toBe(false)
    expect(phraseProvesEncounter(phrase, undefined)).toBe(false)
  })
})

describe('encounteredKeys', () => {
  const words = [
    { key: 'кот=cat', ru: 'кот', headword: 'кот', meaning: 'cat', pos: 'noun' },
    { key: 'спать=to sleep', ru: 'спать', headword: 'спать', meaning: 'to sleep', pos: 'verb' },
  ]
  const index = buildFormIndex(words)

  it('resolves the words of a phrase to their dictionary keys', () => {
    expect(encounteredKeys('кот спать', index)).toEqual(['кот=cat', 'спать=to sleep'])
  })

  it('ignores tokens that match no dictionary entry', () => {
    expect(encounteredKeys('кот зелёный', index)).toEqual(['кот=cat'])
  })

  it('counts a repeated word once', () => {
    expect(encounteredKeys('кот и кот', index)).toEqual(['кот=cat'])
  })

  it('skips a token whose form matches more than one sense', () => {
    // A homograph: crediting either sense would be a guess, so credit neither.
    const ambiguous = buildFormIndex([
      ...words,
      { key: 'кот=male cat', ru: 'кот', headword: 'кот', meaning: 'male cat', pos: 'noun' },
    ])
    expect(encounteredKeys('кот', ambiguous)).toEqual([])
  })

  it('drops keys the caller says are not learnable', () => {
    const isLearnable = (k) => k !== 'спать=to sleep'
    expect(encounteredKeys('кот спать', index, isLearnable)).toEqual(['кот=cat'])
  })

  it('survives a missing phrase or index', () => {
    expect(encounteredKeys('', index)).toEqual([])
    expect(encounteredKeys('кот', null)).toEqual([])
  })
})
