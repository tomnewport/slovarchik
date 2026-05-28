import { describe, it, expect } from 'vitest'
import {
  commonStem,
  allForms,
  endingsTable,
  matchingSlots,
  validCases,
  validSlots,
  numbersOf,
  CASES,
} from './declension.js'
import { loadFixtureNouns } from '../test/fixtures.js'

const nouns = loadFixtureNouns()

const kniga = nouns.find((n) => n.id === 'книга=book')
const sobaka = nouns.find((n) => n.id === 'собака=dog')
const dengi = nouns.find((n) => n.id === 'деньги=money')

describe('commonStem', () => {
  it('finds the shared prefix', () => {
    expect(commonStem(['книга', 'книги', 'книг'])).toBe('книг')
  })
  it('returns empty string when nothing is shared', () => {
    expect(commonStem(['дом', 'кот'])).toBe('')
  })
  it('handles an empty list', () => {
    expect(commonStem([])).toBe('')
  })
})

describe('numbersOf', () => {
  it('returns both numbers for a normal noun', () => {
    expect(numbersOf(kniga)).toEqual(['sg', 'pl'])
  })
  it('returns only plural for a pluralia tantum noun', () => {
    expect(numbersOf(dengi)).toEqual(['pl'])
  })
})

describe('allForms', () => {
  it('flattens every present slot and strips stress', () => {
    const forms = allForms(kniga)
    expect(forms).toHaveLength(2 * CASES.length)
    expect(forms).toContain('книга') // not "кни́га"
  })
})

describe('endingsTable', () => {
  it('derives stress-free endings by stripping the stem', () => {
    const { stem, endings } = endingsTable(kniga)
    expect(stem).toBe('книг')
    expect(endings.sg.nom).toBe('а')
    expect(endings.sg.gen).toBe('и')
    expect(endings.pl.gen).toBe('') // книг — bare stem
  })
})

describe('matchingSlots / validCases', () => {
  it('finds the syncretic dative & prepositional singular of книга (книге)', () => {
    expect(validCases(kniga, 'книге')).toEqual(new Set(['dat', 'pre']))
  })
  it('ignores stress marks in the probe form', () => {
    expect(validCases(kniga, 'кни́ге')).toEqual(new Set(['dat', 'pre']))
  })
  it('finds animate accusative plural = genitive plural for собака (собак)', () => {
    const slots = matchingSlots(sobaka, 'собак')
    expect(slots.some((s) => s.number === 'pl' && s.case === 'acc')).toBe(true)
    expect(slots.some((s) => s.number === 'pl' && s.case === 'gen')).toBe(true)
  })
  it('returns an empty set for a form that does not occur', () => {
    expect(validCases(kniga, 'нет-такого').size).toBe(0)
  })
})

describe('validSlots', () => {
  it('keeps the number distinction (dative & prepositional singular of книге)', () => {
    expect(validSlots(kniga, 'книге')).toEqual(new Set(['sg.dat', 'sg.pre']))
  })
  it('distinguishes the syncretic genitive & accusative plural of собака', () => {
    expect(validSlots(sobaka, 'собак')).toEqual(new Set(['pl.gen', 'pl.acc']))
  })
  it('returns an empty set for a form that does not occur', () => {
    expect(validSlots(kniga, 'нет-такого').size).toBe(0)
  })
})

describe('data integrity', () => {
  it('every noun has all cases for each number it declares', () => {
    for (const noun of nouns) {
      expect(numbersOf(noun).length).toBeGreaterThan(0)
      for (const num of numbersOf(noun)) {
        for (const c of CASES) {
          expect(typeof noun.forms[num][c]).toBe('string')
          expect(noun.forms[num][c].length).toBeGreaterThan(0)
        }
      }
    }
  })
})
