import { describe, it, expect } from 'vitest'
import {
  phraseTokens,
  typingSequence,
  phraseCorrect,
  nextChar,
  hintKeys,
  RU_LETTERS,
  EN_LETTERS,
} from './phrases.js'

// A deterministic pseudo-rng so hintKeys assertions are stable.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

describe('phraseTokens', () => {
  it('splits on whitespace and keeps punctuation attached', () => {
    expect(phraseTokens('Я иду́ в шко́лу.')).toEqual(['Я', 'иду́', 'в', 'шко́лу.'])
  })
  it('returns an empty array for blank input', () => {
    expect(phraseTokens('   ')).toEqual([])
  })
})

describe('typingSequence', () => {
  it('drops stress, punctuation and case, and folds ё→е', () => {
    expect(typingSequence('Всё хорошо́!')).toBe('все хорошо')
  })
  it('collapses whitespace', () => {
    expect(typingSequence('I  go   to school')).toBe('i go to school')
  })
})

describe('phraseCorrect', () => {
  it('accepts an answer that differs only in punctuation, case and stress', () => {
    expect(phraseCorrect('я иду в школу', 'Я иду́ в шко́лу.')).toBe(true)
  })
  it('rejects a wrong answer', () => {
    expect(phraseCorrect('я иду домой', 'Я иду́ в шко́лу.')).toBe(false)
  })
  it('rejects an empty answer', () => {
    expect(phraseCorrect('', 'дом')).toBe(false)
  })
})

describe('nextChar', () => {
  const target = 'Я иду́ в шко́лу.'
  it('returns the first expected letter when nothing is typed', () => {
    expect(nextChar(target, '')).toBe('я')
  })
  it('returns a space at a word boundary', () => {
    expect(nextChar(target, 'я')).toBe(' ')
  })
  it('returns the next letter mid-word', () => {
    expect(nextChar(target, 'я иду в шк')).toBe('о')
  })
  it('returns empty once complete', () => {
    expect(nextChar('дом', 'дом')).toBe('')
  })
})

describe('hintKeys', () => {
  it('includes the correct next letter plus two decoys', () => {
    const keys = hintKeys('п', RU_LETTERS, 2, seededRng(3))
    expect(keys).toHaveLength(3)
    expect(keys).toContain('п')
    expect(new Set(keys).size).toBe(3)
  })
  it('draws decoys from the requested alphabet', () => {
    const keys = hintKeys('a', EN_LETTERS, 2, seededRng(5))
    for (const k of keys) expect(EN_LETTERS).toContain(k)
  })
  it('highlights the space bar alone at a word boundary', () => {
    expect(hintKeys(' ', RU_LETTERS)).toEqual([' '])
  })
  it('returns nothing once the phrase is complete', () => {
    expect(hintKeys('', RU_LETTERS)).toEqual([])
  })
})
