import { describe, it, expect } from 'vitest'
import {
  commonStem,
  allForms,
  endingsTable,
  matchingSlots,
  validCases,
  CASES,
  NUMBERS,
} from './declension.js'
import { nouns } from '../data/nouns.js'

const kniga = nouns.find((n) => n.id === 'kniga')
const sobaka = nouns.find((n) => n.id === 'sobaka')

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

describe('allForms', () => {
  it('flattens every slot in the table', () => {
    expect(allForms(kniga)).toHaveLength(NUMBERS.length * CASES.length)
  })
})

describe('endingsTable', () => {
  it('derives endings by stripping the stem', () => {
    const { stem, endings } = endingsTable(kniga)
    expect(stem).toBe('книг')
    expect(endings.singular.nom).toBe('а')
    expect(endings.singular.gen).toBe('и')
    expect(endings.plural.gen).toBe('') // книг — bare stem
  })
})

describe('matchingSlots / validCases', () => {
  it('finds the syncretic dative & prepositional singular of книга (книге)', () => {
    const cases = validCases(kniga, 'книге')
    expect(cases).toEqual(new Set(['dat', 'pre']))
  })
  it('finds animate accusative plural = genitive plural for собака (собак)', () => {
    const slots = matchingSlots(sobaka, 'собак')
    const accPl = slots.find((s) => s.number === 'plural' && s.case === 'acc')
    const genPl = slots.find((s) => s.number === 'plural' && s.case === 'gen')
    expect(accPl).toBeTruthy()
    expect(genPl).toBeTruthy()
  })
  it('returns an empty set for a form that does not occur', () => {
    expect(validCases(kniga, 'нет-такого').size).toBe(0)
  })
})

describe('data integrity', () => {
  it('every noun has all cases for both numbers', () => {
    for (const noun of nouns) {
      for (const num of NUMBERS) {
        for (const c of CASES) {
          expect(typeof noun.forms[num][c]).toBe('string')
          expect(noun.forms[num][c].length).toBeGreaterThan(0)
        }
      }
    }
  })
})
