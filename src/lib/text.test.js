import { describe, it, expect } from 'vitest'
import { stripStress, normalize, stressMatches } from './text.js'

describe('stripStress', () => {
  it('removes combining acute accents', () => {
    expect(stripStress('воро́та')).toBe('ворота')
    expect(stripStress('студе́нт')).toBe('студент')
  })
  it('leaves unaccented text untouched', () => {
    expect(stripStress('дом')).toBe('дом')
  })
  it('also strips a mis-typed spacing/modifier acute accent', () => {
    // A learner reaching for a stress key can land U+00B4 or U+02CA instead of
    // the combining accent — neither is meaningful, so both fold away.
    expect(stripStress('ноябре\u00B4')).toBe('ноябре')
    expect(stripStress('ноябре\u02CA')).toBe('ноябре')
    expect(stripStress('ноябре\u0301')).toBe('ноябре')
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

describe('stressMatches', () => {
  it('distinguishes forms whose spelling only differs by stress position', () => {
    expect(stressMatches('о́кна', 'окна́')).toBe(false)
    expect(stressMatches('О́КНА', 'о́кна')).toBe(true)
  })

  it('canonicalises acute variants and folds ё/е without dropping stress', () => {
    expect(stressMatches('все\u02CA', 'всё\u0301')).toBe(true)
  })
})
