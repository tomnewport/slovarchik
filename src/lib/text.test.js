import { describe, it, expect } from 'vitest'
import { stripStress, normalize } from './text.js'

describe('stripStress', () => {
  it('removes combining acute accents', () => {
    expect(stripStress('воро́та')).toBe('ворота')
    expect(stripStress('студе́нт')).toBe('студент')
  })
  it('leaves unaccented text untouched', () => {
    expect(stripStress('дом')).toBe('дом')
  })
})

describe('normalize', () => {
  it('strips stress, lowercases, trims and collapses whitespace', () => {
    expect(normalize('  Воро́та   ')).toBe('ворота')
  })
  it('treats ё as е', () => {
    expect(normalize('живёшь')).toBe('живешь')
  })
})
