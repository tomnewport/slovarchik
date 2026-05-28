import { describe, it, expect } from 'vitest'
import { parseKey, buildWords, shapeVocab, partsOfSpeech } from './vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('parseKey', () => {
  it('splits a russian=english natural key', () => {
    expect(parseKey('ворота=gate')).toEqual({ ru: 'ворота', en: 'gate' })
  })
  it('only splits on the first "="', () => {
    expect(parseKey('a=b=c')).toEqual({ ru: 'a', en: 'b=c' })
  })
})

describe('buildWords (with a small inline file)', () => {
  const text = `
words:
  "ворота=gate":
    cefr_level: B2
    number: ["pl"]
    en_gb:
      standard: gate (a doorlike structure outside a house)
    declension:
      pl_nom: воро́та
      pl_gen: воро́т
      pl_dat: воро́там
      pl_acc: воро́та
      pl_ins: воро́тами
      pl_pre: воро́тах
`
  const [gate] = buildWords([{ pos: 'noun', text }])

  it('nests flat declension keys and tracks present numbers', () => {
    expect(gate.numbers).toEqual(['pl'])
    expect(gate.forms.sg).toBeUndefined()
    expect(gate.forms.pl.gen).toBe('воро́т')
  })
  it('splits the meaning into a short gloss and a bracketed note', () => {
    expect(gate.meaning).toBe('gate')
    expect(gate.meaningNote).toContain('doorlike')
    expect(gate.english).toContain('gate')
  })
})

describe('the bundled vocabulary fixtures', () => {
  const words = loadFixtureWords()

  it('loads words for every part of speech', () => {
    for (const pos of partsOfSpeech) {
      const count = words.filter((w) => w.pos === pos).length
      expect(count, `expected words for ${pos}`).toBeGreaterThanOrEqual(9)
    }
  })

  it('has unique natural keys', () => {
    const keys = words.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is sorted alphabetically by Russian (ignoring stress)', () => {
    const ru = words.map((w) => w.ru)
    expect(ru).toEqual([...ru].sort((a, b) => a.localeCompare(b, 'ru')))
  })

  it('gives every word a CEFR level, meaning and accepted answers', () => {
    for (const w of words) {
      expect(w.cefr, w.key).toMatch(/^[ABC][12]$/)
      expect(w.meaning.length, w.key).toBeGreaterThan(0)
      expect(w.english.length, w.key).toBeGreaterThan(0)
    }
  })

  it('shapeVocab exposes display + accepted-answer fields', () => {
    const shaped = shapeVocab(words)
    expect(shaped[0]).toHaveProperty('ru')
    expect(Array.isArray(shaped[0].en)).toBe(true)
  })
})
