import { describe, it, expect } from 'vitest'
import { words, byPos, getByKey, parseKey, partsOfSpeech } from './db.js'

describe('parseKey', () => {
  it('splits a russian=english natural key', () => {
    expect(parseKey('ворота=gate')).toEqual({ ru: 'ворота', en: 'gate' })
  })
  it('handles "=" only once (first occurrence wins)', () => {
    expect(parseKey('a=b=c')).toEqual({ ru: 'a', en: 'b=c' })
  })
})

describe('vocab database', () => {
  it('loads words from every part-of-speech file', () => {
    for (const pos of partsOfSpeech) {
      expect(byPos[pos]?.length, `expected words for ${pos}`).toBeGreaterThanOrEqual(9)
    }
  })

  it('has unique natural keys', () => {
    const keys = words.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is sorted alphabetically by Russian (ignoring stress)', () => {
    const ru = words.map((w) => w.ru)
    const sorted = [...ru].sort((a, b) => a.localeCompare(b, 'ru'))
    expect(ru).toEqual(sorted)
  })

  it('gives every word a CEFR level, a meaning and accepted answers', () => {
    for (const w of words) {
      expect(w.cefr, w.key).toMatch(/^[ABC][12]$/)
      expect(w.meaning.length, w.key).toBeGreaterThan(0)
      expect(w.english.length, w.key).toBeGreaterThan(0)
    }
  })

  it('builds nested, number-aware declension tables for nouns', () => {
    const gate = getByKey('ворота=gate')
    expect(gate.numbers).toEqual(['pl'])
    expect(gate.forms.sg).toBeUndefined()
    expect(gate.forms.pl.gen).toBe('воро́т')

    const book = getByKey('книга=book')
    expect(book.forms.sg.nom).toBe('кни́га')
    expect(book.headword).toBe('кни́га')
  })

  it('splits meanings into a short gloss and a parenthetical note', () => {
    const gate = getByKey('ворота=gate')
    expect(gate.meaning).toBe('gate')
    expect(gate.meaningNote).toContain('doorlike')
  })
})
