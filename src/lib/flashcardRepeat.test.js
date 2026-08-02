import { describe, it, expect } from 'vitest'

import {
  dimSet,
  collectMatchResult,
  buildFlashcardRepeatBoards,
  orderPhrasesBySource,
  durationLabel,
} from './flashcardRepeat.js'

const emptyAcc = () => ({ wrong: new Map(), correct: new Map() })

describe('dimSet', () => {
  it('creates and reuses a set per dimension', () => {
    const map = new Map()
    const a = dimSet(map, 'identification')
    a.add('x')
    expect(dimSet(map, 'identification')).toBe(a)
    expect(dimSet(map, 'hearing')).not.toBe(a)
  })
})

describe('collectMatchResult', () => {
  it('records misses in wrong and removes them from correct', () => {
    const acc = emptyAcc()
    collectMatchResult(acc, {
      dimension: 'identification',
      targets: ['a', 'b', 'c'],
      wrong: new Set(['b']),
    })
    expect([...acc.wrong.get('identification')]).toEqual(['b'])
    expect([...acc.correct.get('identification')].sort()).toEqual(['a', 'c'])
  })

  it('does not re-add a known miss as a top-up on a later correct guess', () => {
    const acc = emptyAcc()
    collectMatchResult(acc, { dimension: 'identification', targets: ['a'], wrong: new Set(['a']) })
    // a is later guessed correctly on another board — must stay a miss, not a top-up.
    collectMatchResult(acc, { dimension: 'identification', targets: ['a'], wrong: null })
    expect(acc.correct.get('identification').has('a')).toBe(false)
    expect(acc.wrong.get('identification').has('a')).toBe(true)
  })

  it('treats a null wrong set as all-correct', () => {
    const acc = emptyAcc()
    collectMatchResult(acc, { dimension: 'hearing', targets: ['x', 'y'], wrong: null })
    expect([...acc.correct.get('hearing')].sort()).toEqual(['x', 'y'])
    expect(acc.wrong.get('hearing').size).toBe(0)
  })

  it('ignores falsy targets', () => {
    const acc = emptyAcc()
    collectMatchResult(acc, { dimension: 'identification', targets: ['a', null, undefined], wrong: null })
    expect([...acc.correct.get('identification')]).toEqual(['a'])
  })
})

describe('buildFlashcardRepeatBoards', () => {
  // A vocab lookup rich enough for buildCombinedFlashcard to build a board.
  const vocabById = new Map(
    ['a', 'b', 'c', 'd'].map((id) => [id, { id, ru: id.toUpperCase(), en: id }]),
  )
  const rankOf = () => 0

  it('builds one board per modality with misses present', () => {
    const acc = emptyAcc()
    acc.wrong.set('identification', new Set(['a', 'b']))
    acc.wrong.set('hearing', new Set(['c', 'd']))
    const { boards, repSeq } = buildFlashcardRepeatBoards(acc, { vocabById, rankOf, repSeq: 0 })
    expect(boards).toHaveLength(2)
    expect(boards[0].dimension).toBe('identification')
    expect(boards[0].audio).toBe(false)
    expect(boards[1].dimension).toBe('hearing')
    expect(boards[1].audio).toBe(true)
    // ids advance the sequence counter.
    expect(boards.map((b) => b.id)).toEqual(['fcrep0', 'fcrep1'])
    expect(repSeq).toBe(2)
  })

  it('clears each built board\'s wrong window so misses re-seed the next', () => {
    const acc = emptyAcc()
    acc.wrong.set('identification', new Set(['a', 'b']))
    buildFlashcardRepeatBoards(acc, { vocabById, rankOf, repSeq: 0 })
    expect(acc.wrong.get('identification').size).toBe(0)
  })

  it('skips a modality with no misses', () => {
    const acc = emptyAcc()
    acc.wrong.set('hearing', new Set(['a', 'b']))
    const { boards } = buildFlashcardRepeatBoards(acc, { vocabById, rankOf, repSeq: 5 })
    expect(boards).toHaveLength(1)
    expect(boards[0].dimension).toBe('hearing')
    expect(boards[0].id).toBe('fcrep5')
  })

  it('orders top-ups weakest-first via rankOf', () => {
    const acc = emptyAcc()
    acc.wrong.set('identification', new Set(['a']))
    acc.correct.set('identification', new Set(['b', 'c', 'd']))
    // d weakest, then c, then b.
    const weak = { d: 0, c: 1, b: 2 }
    const { boards } = buildFlashcardRepeatBoards(acc, {
      vocabById,
      rankOf: (k) => weak[k] ?? 9,
      repSeq: 0,
    })
    // The miss leads; the weakest top-up (d) comes before c/b.
    expect(boards[0].targets[0]).toBe('a')
    expect(boards[0].targets.indexOf('d')).toBeLessThan(boards[0].targets.indexOf('c'))
    expect(boards[0].targets.indexOf('c')).toBeLessThan(boards[0].targets.indexOf('b'))
  })
})

describe('orderPhrasesBySource', () => {
  it('orders by source priority, unknown sources last, stably', () => {
    const phrases = [
      { id: 1, source: 'c' },
      { id: 2, source: 'a' },
      { id: 3, source: 'x' },
      { id: 4, source: 'a' },
    ]
    const ordered = orderPhrasesBySource(phrases, ['a', 'b', 'c'])
    expect(ordered.map((p) => p.id)).toEqual([2, 4, 1, 3])
  })

  it('does not mutate the input array', () => {
    const phrases = [{ source: 'b' }, { source: 'a' }]
    const copy = [...phrases]
    orderPhrasesBySource(phrases, ['a', 'b'])
    expect(phrases).toEqual(copy)
  })
})

describe('durationLabel', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(durationLabel(42000)).toBe('42s')
    expect(durationLabel(0)).toBe('0s')
  })

  it('formats durations over a minute as m + s', () => {
    expect(durationLabel(65000)).toBe('1m 5s')
    expect(durationLabel(600000)).toBe('10m 0s')
  })
})
