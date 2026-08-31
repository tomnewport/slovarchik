import { describe, it, expect } from 'vitest'

import {
  LEARNING_DIMS,
  MASTERY_DIMS,
  DIM_LABEL,
  dimsFor,
  disambiguatedGloss,
  rowGloss,
  buildWordList,
  buildStatusWordList,
} from './homeDashboard.js'

const ev = (dimension, level, correct, ts) => ({ dimension, level, correct, ts })

describe('disambiguatedGloss', () => {
  it('qualifies a verb that has an aspect partner', () => {
    expect(
      disambiguatedGloss('to sew', { aspect: 'pf', aspectPair: { key: 'шить=to sew' } }),
    ).toBe('to sew (perfective)')
  })

  it('qualifies a verb that has a motion partner', () => {
    expect(
      disambiguatedGloss('to walk', { motion: 'indet', motionPair: { key: 'идти=to go' } }),
    ).toBe('to walk (indeterminate)')
  })

  it('uses the authored note for same-gloss words', () => {
    expect(
      disambiguatedGloss('hat', { note: 'winter', ambiguousEn: [{ ru: 'шляпа' }] }),
    ).toBe('hat (winter)')
  })

  it('leaves ordinary words and non-distinguishing notes unchanged', () => {
    expect(disambiguatedGloss('house', { note: 'building', ambiguousEn: [] })).toBe('house')
    expect(disambiguatedGloss('house')).toBe('house')
  })
})

describe('rowGloss', () => {
  it('keeps only the leading sense of a multi-sense gloss', () => {
    expect(rowGloss('accepted, resigned himself')).toBe('accepted')
    expect(rowGloss('audible; can be heard')).toBe('audible')
  })

  it('keeps a parenthetical clarification whole, commas and all', () => {
    expect(rowGloss('close (near in space or time)')).toBe('close (near in space or time)')
  })

  it('abbreviates the aspect and motion qualifiers', () => {
    expect(rowGloss('to sew', { aspect: 'pf', aspectPair: { key: 'шить=to sew' } })).toBe(
      'to sew (pf.)',
    )
    expect(rowGloss('to walk', { motion: 'indet', motionPair: { key: 'идти=to go' } })).toBe(
      'to walk (indet.)',
    )
  })

  it('keeps the authored note for same-gloss words, which is already short', () => {
    expect(rowGloss('hat', { note: 'winter', ambiguousEn: [{ ru: 'шляпа' }] })).toBe('hat (winter)')
  })

  it('reduces an authored note to its opening clause', () => {
    const word = { note: 'relating to buses; a city bus', ambiguousEn: [{ ru: 'авто́бусный' }] }
    expect(rowGloss('bus', word)).toBe('bus (relating to buses)')
    const dashed = { note: 'the everyday word — «мне ну́жно»', ambiguousEn: [{ ru: 'на́до' }] }
    expect(rowGloss('needed', dashed)).toBe('needed (the everyday word)')
  })

  it('leaves a note too long to fit beside the pips to the card', () => {
    const word = {
      note: 'polite form used with children and guests',
      ambiguousEn: [{ ru: 'есть' }],
    }
    expect(rowGloss('to eat', word)).toBe('to eat')
  })

  it('drops a note whose opening clause only repeats the gloss', () => {
    const word = { note: 'alike, to the same degree', ambiguousEn: [{ ru: 'одина́ково' }] }
    expect(rowGloss('alike', word)).toBe('alike')
  })

  it('leaves an ordinary single-sense gloss alone', () => {
    expect(rowGloss('house')).toBe('house')
    expect(rowGloss('house', { note: 'building', ambiguousEn: [] })).toBe('house')
  })
})

describe('dimsFor', () => {
  it('returns dims unchanged at the learning level', () => {
    expect(dimsFor('дом=house', 'learning', LEARNING_DIMS, () => false)).toEqual(LEARNING_DIMS)
  })

  it('keeps context at mastery only when the word has a context drill', () => {
    expect(dimsFor('дом=house', 'mastery', MASTERY_DIMS, () => true)).toEqual(MASTERY_DIMS)
    expect(dimsFor('дом=house', 'mastery', MASTERY_DIMS, () => false)).toEqual([
      'identification',
      'usage',
    ])
  })

  it('consults hasContextDrill per key', () => {
    const hasCtx = (k) => k === 'withdrill'
    expect(dimsFor('withdrill', 'mastery', MASTERY_DIMS, hasCtx)).toContain('context')
    expect(dimsFor('nodrill', 'mastery', MASTERY_DIMS, hasCtx)).not.toContain('context')
  })
})

describe('buildWordList', () => {
  const ctx = {
    records: {
      'дом=house': { word: 'дом=house', events: [ev('identification', 'learning', true, 100)] },
      'кот=cat': { word: 'кот=cat', events: [ev('identification', 'learning', true, 300)] },
    },
    hasContextDrill: () => false,
    isPendingConfirmation: () => false,
  }

  it('parses ru/en and attaches a pip per learning dimension', () => {
    const [row] = buildWordList([{ word: 'дом=house', done: false }], 'learning', LEARNING_DIMS, ctx)
    expect(row.ru).toBe('дом')
    expect(row.en).toBe('house')
    expect(row.dims.map((d) => d.name)).toEqual(LEARNING_DIMS)
    expect(row.dims.map((d) => d.label)).toEqual(LEARNING_DIMS.map((d) => DIM_LABEL[d]))
  })

  it('uses vocabulary metadata to disambiguate the row gloss', () => {
    const pairedCtx = {
      ...ctx,
      vocabByKey: new Map([
        ['сшить=to sew', { aspect: 'pf', aspectPair: { key: 'шить=to sew' } }],
      ]),
    }
    const [row] = buildWordList(
      [{ word: 'сшить=to sew', done: false }],
      'learning',
      LEARNING_DIMS,
      pairedCtx,
    )
    expect(row.en).toBe('to sew (pf.)')
    // The unabridged gloss rides along for the row's hover title.
    expect(row.fullEn).toBe('to sew (perfective)')
  })

  it('sorts not-done first, then most-recently-attempted first', () => {
    const words = [
      { word: 'дом=house', done: false }, // lastAt 100
      { word: 'кот=cat', done: false }, // lastAt 300
    ]
    const rows = buildWordList(words, 'learning', LEARNING_DIMS, ctx)
    expect(rows.map((r) => r.key)).toEqual(['кот=cat', 'дом=house'])
  })

  it('pushes done words to the end regardless of recency', () => {
    const words = [
      { word: 'кот=cat', done: true }, // recent but done
      { word: 'дом=house', done: false }, // older but not done
    ]
    const rows = buildWordList(words, 'learning', LEARNING_DIMS, ctx)
    expect(rows.map((r) => r.key)).toEqual(['дом=house', 'кот=cat'])
  })

  it('marks a done word pending only when isPendingConfirmation says so', () => {
    const pendingCtx = { ...ctx, isPendingConfirmation: (k) => k === 'дом=house' }
    const [row] = buildWordList([{ word: 'дом=house', done: true }], 'learning', LEARNING_DIMS, pendingCtx)
    expect(row.pending).toBe(true)
    const [notDone] = buildWordList([{ word: 'дом=house', done: false }], 'learning', LEARNING_DIMS, pendingCtx)
    expect(notDone.pending).toBe(false)
  })

  it('defaults lastAt to 0 for a word with no events', () => {
    const emptyCtx = { records: {}, hasContextDrill: () => false, isPendingConfirmation: () => false }
    const [row] = buildWordList([{ word: 'нов=new', done: false }], 'learning', LEARNING_DIMS, emptyCtx)
    expect(row.lastAt).toBe(0)
  })

  it('drops the context pip at mastery for words without a context drill', () => {
    const [row] = buildWordList([{ word: 'дом=house', done: false }], 'mastery', MASTERY_DIMS, ctx)
    expect(row.dims.map((d) => d.name)).toEqual(['identification', 'usage'])
  })
})

describe('buildStatusWordList', () => {
  const ctx = {
    records: {
      'дом=house': { word: 'дом=house', events: [ev('identification', 'learning', true, 100)] },
    },
    stateOf: (k) => (k === 'дом=house' ? 'learned' : 'mastered'),
    hasContextDrill: () => true,
  }

  it('resolves state and grades learned words at the learning level', () => {
    const [row] = buildStatusWordList(['дом=house'], ctx)
    expect(row).toMatchObject({ key: 'дом=house', ru: 'дом', en: 'house', state: 'learned' })
    expect(row.dims.map((d) => d.name)).toEqual(LEARNING_DIMS)
  })

  it('grades mastered words at the mastery level', () => {
    const [row] = buildStatusWordList(['кот=cat'], ctx)
    expect(row.state).toBe('mastered')
    expect(row.dims.map((d) => d.name)).toEqual(MASTERY_DIMS)
  })

  it('uses the same disambiguated gloss as current-batch rows', () => {
    const pairedCtx = {
      ...ctx,
      vocabByKey: new Map([
        ['кот=cat', { note: 'animal', ambiguousEn: [{ ru: 'кошка' }] }],
      ]),
    }
    const [row] = buildStatusWordList(['кот=cat'], pairedCtx)
    expect(row.en).toBe('cat (animal)')
    expect(row.fullEn).toBe('cat (animal)')
  })
})
