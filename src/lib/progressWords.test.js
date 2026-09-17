import { describe, expect, it } from 'vitest'
import { problemKeys, progressWordRow, searchProgressWords, sortProgressWords, wordStatus } from './progressWords.js'

const NOW = Date.parse('2026-09-17T12:00:00Z')

describe('Progress word explorer', () => {
  it('combines slipped and at-risk keys without duplicating a word', () => {
    expect(problemKeys(['slipped', 'both'], ['both', 'risk'])).toEqual(['slipped', 'both', 'risk'])
  })

  it('prioritises a problem, then an overdue review, then a recent word, then a solid word', () => {
    const old = { learnedAt: NOW - 45 * 86400000, schedule: { usage: { due: NOW - 1, stability: 86400000 } } }
    expect(wordStatus(old, 'learned', true, NOW).icon).toBe('⚠️')
    expect(wordStatus(old, 'learned', false, NOW).icon).toBe('⏰')
    expect(wordStatus({ learnedAt: NOW - 5 * 86400000 }, 'learned', false, NOW).icon).toBe('🌱')
    expect(wordStatus({ learnedAt: NOW - 45 * 86400000 }, 'learned', false, NOW).icon).toBe('💚')
  })

  it('sorts by status, recency, lifetime mistakes, CEFR and both alphabets', () => {
    const words = [
      progressWordRow('кот=cat', { headword: 'ко́т', cefr: 'A2' }, {
        learnedAt: NOW - 40 * 86400000, events: [{ correct: false, ts: 1 }],
        agg: { lastSeenAt: 40, dims: { usage: { attempts: 15, correct: 5 } } },
      }, 'learned', false, NOW),
      progressWordRow('дом=house', { headword: 'до́м', cefr: 'A1' }, {
        learnedAt: NOW - 40 * 86400000, agg: { lastSeenAt: 80, dims: { usage: { attempts: 1, correct: 1 } } },
        schedule: { usage: { due: NOW - 100, stability: 100 } },
      }, 'learned', false, NOW),
      progressWordRow('яблоко=apple', { headword: 'я́блоко', cefr: 'B1' }, {
        learnedAt: NOW - 40 * 86400000, agg: { lastSeenAt: 60, dims: { usage: { attempts: 5, correct: 3 } } },
      }, 'learned', true, NOW),
    ]
    const sorted = (by) => sortProgressWords(words, by).map((w) => w.key)
    expect(sorted('status')).toEqual(['яблоко=apple', 'дом=house', 'кот=cat'])
    expect(sorted('recent')).toEqual(['дом=house', 'яблоко=apple', 'кот=cat'])
    expect(sorted('oldest')).toEqual(['кот=cat', 'яблоко=apple', 'дом=house'])
    expect(sorted('most-incorrect')).toEqual(['кот=cat', 'яблоко=apple', 'дом=house'])
    expect(sorted('least-incorrect')).toEqual(['дом=house', 'яблоко=apple', 'кот=cat'])
    expect(sorted('cefr')).toEqual(['дом=house', 'кот=cat', 'яблоко=apple'])
    expect(sorted('english')).toEqual(['яблоко=apple', 'кот=cat', 'дом=house'])
    expect(sorted('russian')).toEqual(['дом=house', 'кот=cat', 'яблоко=apple'])
  })

  it('searches unlearned and gloss-only entries in Russian without stress marks or in English', () => {
    const words = [
      { key: 'кот=cat', headword: 'ко́т', meaning: 'cat' },
      { key: 'кошка=cat', headword: 'ко́шка', meaning: 'cat', learnable: false },
    ]
    expect(searchProgressWords(words, 'кошка')).toEqual(['кошка=cat'])
    expect(searchProgressWords(words, 'cat')).toEqual(['кот=cat', 'кошка=cat'])
    expect(searchProgressWords(words, 'rabbit')).toEqual([])
  })
})
