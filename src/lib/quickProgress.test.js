import { describe, it, expect } from 'vitest'

import { flawlessFinished, resultFlawless, trackFlawless } from './quickProgress.js'

describe('resultFlawless', () => {
  it('takes a plain correct answer at face value', () => {
    expect(resultFlawless({ correct: true }, 'дом=house')).toBe(true)
    expect(resultFlawless({ correct: false }, 'дом=house')).toBe(false)
  })

  it('believes an exercise that says it was helped, however it was graded', () => {
    // A correct answer typed with the keyboard hint on: right, but not evidence
    // the learner knew the word.
    expect(resultFlawless({ correct: true, flawless: false }, 'дом=house')).toBe(false)
  })

  it('rejects an answer corrected on its built-in retry', () => {
    expect(resultFlawless({ correct: false, correctedOnRetry: true }, 'дом=house')).toBe(false)
  })

  it('reads a board per word, not as a whole', () => {
    const board = { correct: false, wrong: ['кот=cat'] }
    expect(resultFlawless(board, 'дом=house')).toBe(true)
    expect(resultFlawless(board, 'кот=cat')).toBe(false)
  })

  it('is false for no result at all', () => {
    expect(resultFlawless(null, 'дом=house')).toBe(false)
  })
})

describe('trackFlawless', () => {
  it('records each target of an exercise separately', () => {
    const ledger = new Map()
    trackFlawless(ledger, ['дом=house', 'кот=cat'], { correct: false, wrong: ['кот=cat'] })
    expect(ledger.get('дом=house')).toBe(true)
    expect(ledger.get('кот=cat')).toBe(false)
  })

  it('never washes an earlier miss out with a later clean answer', () => {
    const ledger = new Map()
    trackFlawless(ledger, ['дом=house'], { correct: false })
    trackFlawless(ledger, ['дом=house'], { correct: true })
    expect(ledger.get('дом=house')).toBe(false)
  })

  it('ignores empty target slots', () => {
    const ledger = new Map()
    trackFlawless(ledger, [null, undefined, ''], { correct: true })
    expect(ledger.size).toBe(0)
  })
})

describe('flawlessFinished', () => {
  const ledger = () =>
    new Map([
      ['дом=house', true],
      ['кот=cat', false],
      ['стол=table', true],
    ])

  it('names the flawless words the session has finished with', () => {
    expect(flawlessFinished(ledger(), { remaining: new Set(['стол=table']) })).toEqual([
      'дом=house',
    ])
  })

  it('waits for a word that is coming back in the repeat round', () => {
    const remaining = new Set(['дом=house', 'стол=table'])
    expect(flawlessFinished(ledger(), { remaining })).toEqual([])
  })

  it('does not ask twice about the same word', () => {
    const skip = new Set(['дом=house'])
    expect(flawlessFinished(ledger(), { remaining: new Set(), skip })).toEqual(['стол=table'])
  })
})
