import { describe, it, expect } from 'vitest'

import {
  cardinalNominative,
  ordinal,
  yearOrdinal,
  yearIn,
  yearPhrase,
  pluralCategory,
  agree,
} from './numerals.js'
import { stripStress } from './text.js'

// Compare ignoring stress marks so the assertions stay readable, then separately
// assert that stress is present where we expect it.
const bare = (s) => stripStress(s)

describe('cardinalNominative', () => {
  const cases = [
    [0, 'ноль'],
    [1, 'один'],
    [2, 'два'],
    [9, 'девять'],
    [10, 'десять'],
    [11, 'одиннадцать'],
    [19, 'девятнадцать'],
    [20, 'двадцать'],
    [21, 'двадцать один'],
    [40, 'сорок'],
    [48, 'сорок восемь'],
    [100, 'сто'],
    [248, 'двести сорок восемь'],
    [999, 'девятьсот девяносто девять'],
    [1000, 'тысяча'],
    [1001, 'тысяча один'],
    [1945, 'тысяча девятьсот сорок пять'],
    [2000, 'две тысячи'],
    [2024, 'две тысячи двадцать четыре'],
    [5000, 'пять тысяч'],
    [21000, 'двадцать одна тысяча'],
  ]
  for (const [n, expected] of cases) {
    it(`${n} → ${expected}`, () => {
      expect(bare(cardinalNominative(n))).toBe(expected)
    })
  }

  it('respects gender for the final 1 and 2', () => {
    expect(bare(cardinalNominative(1, 'f'))).toBe('одна')
    expect(bare(cardinalNominative(2, 'f'))).toBe('две')
    expect(bare(cardinalNominative(1, 'n'))).toBe('одно')
    expect(bare(cardinalNominative(21, 'f'))).toBe('двадцать одна')
  })

  it('keeps stress marks', () => {
    expect(cardinalNominative(8)).toContain('́')
    expect(cardinalNominative(248)).toBe('две́сти со́рок во́семь')
  })
})

describe('ordinal (declined)', () => {
  it('forms the base ordinals (masculine nominative)', () => {
    const expected = {
      1: 'первый',
      2: 'второй',
      3: 'третий',
      4: 'четвёртый',
      5: 'пятый',
      6: 'шестой',
      7: 'седьмой',
      8: 'восьмой',
      9: 'девятый',
      10: 'десятый',
      11: 'одиннадцатый',
      20: 'двадцатый',
      40: 'сороковой',
      100: 'сотый',
      1000: 'тысячный',
    }
    for (const [n, word] of Object.entries(expected)) {
      expect(bare(ordinal(Number(n))), `${n}th`).toBe(word)
    }
  })

  it('declines by case and gender', () => {
    expect(bare(ordinal(1, { case: 'pre' }))).toBe('первом')
    expect(bare(ordinal(2, { case: 'pre' }))).toBe('втором')
    expect(bare(ordinal(2, { case: 'gen', gender: 'f' }))).toBe('второй')
    expect(bare(ordinal(3, { case: 'gen' }))).toBe('третьего')
    expect(bare(ordinal(3, { case: 'dat', gender: 'f' }))).toBe('третьей')
    // "the eighth of March" — genitive neuter/masculine.
    expect(bare(ordinal(8, { case: 'gen' }))).toBe('восьмого')
    expect(bare(ordinal(40, { case: 'pre' }))).toBe('сороковом')
  })

  it('handles animacy in the accusative', () => {
    expect(bare(ordinal(1, { case: 'acc', animate: true }))).toBe('первого')
    expect(bare(ordinal(1, { case: 'acc', animate: false }))).toBe('первый')
  })

  it('composes compound ordinals with a cardinal lead', () => {
    expect(bare(ordinal(21, { case: 'nom' }))).toBe('двадцать первый')
    expect(bare(ordinal(248, { case: 'nom' }))).toBe('двести сорок восьмой')
  })
})

describe('years', () => {
  const yearsPre = [
    [1812, 'тысяча восемьсот двенадцатом'],
    [1861, 'тысяча восемьсот шестьдесят первом'],
    [1900, 'тысяча девятисотом'],
    [1917, 'тысяча девятьсот семнадцатом'],
    [1945, 'тысяча девятьсот сорок пятом'],
    [1980, 'тысяча девятьсот восьмидесятом'],
    [1991, 'тысяча девятьсот девяносто первом'],
    [1999, 'тысяча девятьсот девяносто девятом'],
    [2000, 'двухтысячном'],
    [2010, 'две тысячи десятом'],
    [2015, 'две тысячи пятнадцатом'],
    [2024, 'две тысячи двадцать четвёртом'],
    [2100, 'две тысячи сотом'],
  ]
  for (const [n, expected] of yearsPre) {
    it(`${n} (prepositional) → ${expected}`, () => {
      expect(bare(yearOrdinal(n))).toBe(expected)
    })
  }

  it('wraps the spoken "in <year>" phrase', () => {
    expect(bare(yearIn(1987))).toBe('в тысяча девятьсот восемьдесят седьмом году')
    expect(bare(yearPhrase(2024))).toBe('две тысячи двадцать четвёртом году')
  })

  it('keeps stress on the year phrase', () => {
    expect(yearPhrase(1945)).toBe('ты́сяча девятьсо́т со́рок пя́том году́')
  })
})

describe('count agreement', () => {
  it('classifies counts', () => {
    expect(pluralCategory(1)).toBe('one')
    expect(pluralCategory(2)).toBe('few')
    expect(pluralCategory(5)).toBe('many')
    expect(pluralCategory(11)).toBe('many')
    expect(pluralCategory(21)).toBe('one')
    expect(pluralCategory(22)).toBe('few')
    expect(pluralCategory(112)).toBe('many')
  })

  it('picks the governed noun form', () => {
    const год = { one: 'год', few: 'года', many: 'лет' }
    expect(agree(1, год)).toBe('год')
    expect(agree(2, год)).toBe('года')
    expect(agree(5, год)).toBe('лет')
    expect(agree(21, год)).toBe('год')
  })
})
