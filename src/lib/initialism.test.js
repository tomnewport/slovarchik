import { describe, it, expect } from 'vitest'
import { spellOutInitialisms } from './initialism.js'

describe('spellOutInitialisms', () => {
  it('dot-separates a bare Russian initialism so it is spelled out', () => {
    expect(spellOutInitialisms('США')).toBe('С.Ш.А.')
    expect(spellOutInitialisms('СССР')).toBe('С.С.С.Р.')
  })

  it('handles an initialism inside a sentence', () => {
    expect(spellOutInitialisms('Мой брат живёт в США.')).toBe('Мой брат живёт в С.Ш.А..')
    expect(spellOutInitialisms('СССР распа́лся в 1991.')).toBe('С.С.С.Р. распа́лся в 1991.')
  })

  it('leaves ordinary capitalised words alone', () => {
    expect(spellOutInitialisms('Москва')).toBe('Москва')
    expect(spellOutInitialisms('Он живёт в Москве')).toBe('Он живёт в Москве')
  })

  it('leaves a single stand-alone capital alone', () => {
    expect(spellOutInitialisms('Я знаю')).toBe('Я знаю')
  })

  it('does not touch a capital glued to a lower-case tail', () => {
    expect(spellOutInitialisms('СШАшник')).toBe('СШАшник')
  })

  it('leaves Latin initialisms to the English voice', () => {
    expect(spellOutInitialisms('TV')).toBe('TV')
    expect(spellOutInitialisms('DIY project')).toBe('DIY project')
  })

  it('handles empty and nullish input', () => {
    expect(spellOutInitialisms('')).toBe('')
    expect(spellOutInitialisms(null)).toBe('')
    expect(spellOutInitialisms(undefined)).toBe('')
  })
})
