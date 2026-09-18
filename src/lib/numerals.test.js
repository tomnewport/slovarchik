import { describe, it, expect } from 'vitest'

import {
  cardinal,
  cardinalNominative,
  ordinal,
  yearOrdinal,
  yearIn,
  yearPhrase,
  pluralCategory,
  agree,
  parseCardinal,
  parseCardinals,
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

describe('cardinal (oblique cases)', () => {
  const cases = [
    [2, 'ins', 'двумя'],
    [3, 'gen', 'трёх'],
    [4, 'ins', 'четырьмя'],
    [5, 'pre', 'пяти'],
    [8, 'ins', 'восемью'],
    [21, 'gen', 'двадцати одного'],
    [40, 'ins', 'сорока'],
    [50, 'gen', 'пятидесяти'],
    [100, 'gen', 'ста'],
    [200, 'dat', 'двумстам'],
    [300, 'ins', 'тремястами'],
    [347, 'dat', 'трёмстам сорока семи'],
    [1000, 'gen', 'тысячи'],
    [5000, 'ins', 'пятью тысячами'],
    // The notorious one: every component declines.
    [2945, 'ins', 'двумя тысячами девятьюстами сорока пятью'],
  ]
  for (const [n, kase, expected] of cases) {
    it(`${n} (${kase}) → ${expected}`, () => {
      expect(bare(cardinal(n, { case: kase }))).toBe(expected)
    })
  }

  it('declines один by gender', () => {
    expect(bare(cardinal(1, { case: 'ins', gender: 'm' }))).toBe('одним')
    expect(bare(cardinal(1, { case: 'ins', gender: 'f' }))).toBe('одной')
    expect(bare(cardinal(1, { case: 'gen', gender: 'f' }))).toBe('одной')
  })

  it('nominative and accusative match (inanimate)', () => {
    expect(cardinal(247, { case: 'acc' })).toBe(cardinalNominative(247))
  })

  it('keeps stress through the compound', () => {
    expect(cardinal(2945, { case: 'ins' })).toBe(
      'двумя́ ты́сячами девятьюста́ми сорока́ пятью́',
    )
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

describe('reading cardinals back', () => {
  it('round-trips every number the map can name', () => {
    // 0–9999 is the firewatch map's whole address space (#762), and the
    // reverse lookup is built off the same atom tables that spell them.
    for (let n = 0; n <= 9999; n++) {
      expect(parseCardinal(cardinalNominative(n))).toBe(n)
    }
  })

  it('assembles thousands, hundreds and the tail', () => {
    expect(parseCardinal('\u0442\u044b\u0441\u044f\u0447\u0430')).toBe(1000)
    expect(parseCardinal('\u0442\u044b\u0441\u044f\u0447\u0430 \u0434\u0432\u0435\u0441\u0442\u0438 \u0442\u0440\u0438')).toBe(1203)
    expect(parseCardinal('\u0447\u0435\u0442\u044b\u0440\u0435 \u0442\u044b\u0441\u044f\u0447\u0438 \u0434\u0435\u0432\u044f\u043d\u043e\u0441\u0442\u043e \u0432\u043e\u0441\u0435\u043c\u044c')).toBe(4098)
    expect(parseCardinal('\u043f\u044f\u0442\u044c \u0442\u044b\u0441\u044f\u0447')).toBe(5000)
    expect(parseCardinal('\u0434\u0435\u0432\u044f\u0442\u044c\u0441\u043e\u0442')).toBe(900)
    expect(parseCardinal('\u0434\u0432\u0435\u0441\u0442\u0438 \u0442\u0440\u0438')).toBe(203)
  })

  it('takes \u00ab\u043e\u0434\u043d\u0430\u0301 \u0442\u044b\u0301\u0441\u044f\u0447\u0430\u00bb as well as the bare \u00ab\u0442\u044b\u0301\u0441\u044f\u0447\u0430\u00bb', () => {
    // The generator drops the multiplier before a scale noun; a learner
    // saying it out does not have to.
    expect(parseCardinal('\u043e\u0434\u043d\u0430 \u0442\u044b\u0441\u044f\u0447\u0430 \u0434\u0432\u0435\u0441\u0442\u0438 \u0442\u0440\u0438')).toBe(1203)
  })

  it('does not need the stress marks the generator writes', () => {
    expect(parseCardinal(stripStress(cardinalNominative(4098)))).toBe(4098)
    expect(parseCardinal('CO\u0420OK')).toBe(null) // Latin look-alikes are not Cyrillic
    expect(parseCardinal('\u0421\u041e\u0420\u041e\u041a \u0422\u0420\u0418')).toBe(43)
  })

  it('takes the feminine and neuter forms of one and two', () => {
    expect(parseCardinal('\u043e\u0434\u043d\u0430')).toBe(1)
    expect(parseCardinal('\u043e\u0434\u043d\u043e')).toBe(1)
    expect(parseCardinal('\u0434\u0432\u0435')).toBe(2)
    expect(parseCardinal('\u0434\u0432\u0430\u0301\u0434\u0446\u0430\u0442\u044c \u0434\u0432\u0435')).toBe(22)
  })

  it('takes \u00ab\u043d\u0443\u043b\u044c\u00bb as well as \u00ab\u043d\u043e\u043b\u044c\u00bb, and \u0435 for \u0451', () => {
    expect(parseCardinal('\u043d\u0443\u043b\u044c')).toBe(0)
    expect(parseCardinal('\u043d\u043e\u043b\u044c')).toBe(0)
    expect(parseCardinal('\u0441\u0435\u043c\u044c\u0434\u0435\u0441\u044f\u0442 \u0432\u043e\u0441\u0435\u043c\u044c')).toBe(78)
  })

  it('does not join a ten to a zero', () => {
    expect(parseCardinals('\u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044c \u043d\u043e\u043b\u044c')).toEqual([20, 0])
  })

  it('reads a run of separate numbers as separate numbers', () => {
    expect(parseCardinals('\u0441\u043e\u0440\u043e\u043a \u0442\u0440\u0438 \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044c')).toEqual([43, 20])
    expect(parseCardinals('\u0442\u044b\u0441\u044f\u0447\u0430 \u0442\u044b\u0441\u044f\u0447\u0430')).toEqual([1000, 1000])
  })

  it('says nothing was typed, rather than nothing was understood', () => {
    expect(parseCardinals('')).toEqual([])
    expect(parseCardinals('   ')).toEqual([])
    expect(parseCardinal('')).toBe(null)
  })

  it('rejects a string with anything in it that is not part of a number', () => {
    expect(parseCardinals('\u0441\u043e\u0440\u043e\u043a \u0441\u043e\u0431\u0430\u043a\u0430')).toBe(null)
    expect(parseCardinals('4098')).toBe(null)
    expect(parseCardinal('\u0442\u044b\u0441\u044f\u0447\u0430 \u0441\u043e\u0431\u0430\u043a')).toBe(null)
  })
})
