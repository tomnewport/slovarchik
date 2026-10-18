import { describe, it, expect } from 'vitest'
import { spellOutInitialisms, sayLoneConsonantWords, speechText } from './initialism.js'

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

describe('sayLoneConsonantWords', () => {
  it('respells a preposition spoken on its own so it is not read as a letter name', () => {
    expect(sayLoneConsonantWords('с')).toBe('со')
    expect(sayLoneConsonantWords('в')).toBe('во')
    expect(sayLoneConsonantWords('к')).toBe('ко')
    expect(sayLoneConsonantWords(' С ')).toBe(' СО ')
  })

  it('respells it when nothing Russian follows, as in a gloss', () => {
    expect(sayLoneConsonantWords('с / со')).toBe('со / со')
    expect(sayLoneConsonantWords('в (+ prep)')).toBe('во (+ prep)')
  })

  it('leaves a preposition alone when its word follows', () => {
    expect(sayLoneConsonantWords('Я гуля́ю с дру́гом.')).toBe('Я гуля́ю с дру́гом.')
    expect(sayLoneConsonantWords('В Москве́')).toBe('В Москве́')
    expect(sayLoneConsonantWords('к врачу́')).toBe('к врачу́')
  })

  it('leaves vowel words and letters inside words alone', () => {
    expect(sayLoneConsonantWords('и')).toBe('и')
    expect(sayLoneConsonantWords('я')).toBe('я')
    expect(sayLoneConsonantWords('сок')).toBe('сок')
  })
})

describe('speechText', () => {
  it('applies both transforms without one disturbing the other', () => {
    expect(speechText('с')).toBe('со')
    expect(speechText('в США')).toBe('в С.Ш.А.')
  })
})
