import { describe, it, expect } from 'vitest'

import {
  ADJ_CASES,
  ADJ_COLS,
  GOLDEN_ADJECTIVES,
  declineAdjective,
  goldenAdjectiveMismatches,
} from './adjectiveDeclension.js'

describe('declineAdjective', () => {
  it('matches every hand-verified golden paradigm', () => {
    expect(goldenAdjectiveMismatches()).toEqual([])
  })

  it('covers one adjective of each spelling / stress class', () => {
    // The guard above is only as strong as the table behind it: if the golden
    // set ever loses a class, a whole ending table stops being checked.
    expect(Object.keys(GOLDEN_ADJECTIVES)).toEqual([
      'но́вый', // hard, stem-stressed
      'молодо́й', // hard, ending-stressed
      'ру́сский', // velar
      'хоро́ший', // sibilant, stem-stressed (о→е)
      'большо́й', // sibilant, ending-stressed (о stays)
      'си́ний', // soft
      'бо́жий', // possessive -ий
    ])
  })

  it('reports a mismatch rather than throwing when a golden form disagrees', () => {
    expect(goldenAdjectiveMismatches({ 'но́вый': { m_gen: 'но́вово' } })).toEqual([
      { lemma: 'но́вый', slot: 'm_gen', expected: 'но́вово', actual: 'но́вого' },
    ])
  })

  it('fills all 24 cells', () => {
    const table = declineAdjective('но́вый')
    expect(Object.keys(table)).toHaveLength(ADJ_COLS.length * ADJ_CASES.length)
    for (const col of ADJ_COLS) {
      for (const c of ADJ_CASES) expect(table[`${col}_${c}`], `${col}_${c}`).toBeTruthy()
    }
  })

  it('mirrors the nominative into the inanimate accusative', () => {
    const table = declineAdjective('но́вый')
    expect(table.m_acc).toBe(table.m_nom)
    expect(table.n_acc).toBe(table.n_nom)
    expect(table.pl_acc).toBe(table.pl_nom)
    // The feminine accusative is its own form, not a copy.
    expect(table.f_acc).toBe('но́вую')
  })

  it('drops the mark from a monosyllabic ending-stressed form', () => {
    // Convention in the curated data: a single vowel is unambiguously stressed.
    expect(declineAdjective('злой').m_nom).toBe('злой')
    expect(declineAdjective('злой').m_gen).toBe('зло́го')
  })

  it('needs the agreement forms to spot a possessive -ий', () => {
    // бо́жий is spelled like the sibilant хоро́ший; only the -ья/-ье/-ьи
    // nominatives give it away, so without them it declines as a sibilant.
    expect(declineAdjective('бо́жий').m_gen).toBe('бо́жего')
    expect(declineAdjective('бо́жий', { f: 'бо́жья' }).m_gen).toBe('бо́жьего')
  })

  it('declines a participle like the adjective it agrees as', () => {
    // The reason this module left the generator: a participle stores only its
    // accented nominative and derives the grid on demand (#564). One per
    // participial ending, since each lands in a different spelling class.
    expect(declineAdjective('чита́ющий').m_gen).toBe('чита́ющего') // -щий  → sibilant
    expect(declineAdjective('чита́ющий').f_acc).toBe('чита́ющую')
    expect(declineAdjective('прочита́вший').pl_dat).toBe('прочита́вшим') // -вший → sibilant
    expect(declineAdjective('прочи́танный').m_pre).toBe('прочи́танном') // -нный → hard
    expect(declineAdjective('при́нятый').pl_gen).toBe('при́нятых') // -тый  → hard
    expect(declineAdjective('люби́мый').n_nom).toBe('люби́мое') // -мый  → hard
  })
})
