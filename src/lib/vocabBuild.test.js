import { describe, it, expect } from 'vitest'
import {
  parseKey,
  buildWords,
  shapeVocab,
  shapePhrases,
  shapeNouns,
  learnableWords,
  partsOfSpeech,
} from './vocabBuild.js'
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

describe('learn: false (gloss-only entries)', () => {
  const text = `
words:
  "дом=house":
    cefr_level: A1
    gender: m
    animacy: i
    en_gb: { standard: house }
    usage:
      - { ru: Большо́й дом, en_gb: A big house. }
    declension:
      sg_nom: дом
      sg_gen: до́ма
      sg_dat: до́му
      sg_acc: дом
      sg_ins: до́мом
      sg_pre: до́ме
      pl_nom: дома́
      pl_gen: домо́в
      pl_dat: дома́м
      pl_acc: дома́
      pl_ins: дома́ми
      pl_pre: дома́х
  "полдень=noon":
    cefr_level: B1
    gender: m
    animacy: i
    learn: false
    en_gb: { standard: noon }
    usage:
      - { ru: До полу́дня, en_gb: Until noon. }
    declension:
      sg_nom: по́лдень
      sg_gen: полу́дня
      sg_dat: полу́дню
      sg_acc: по́лдень
      sg_ins: полу́днем
      sg_pre: полу́дне
`
  const words = buildWords([{ pos: 'noun', text }])
  const noon = words.find((w) => w.key === 'полдень=noon')
  const house = words.find((w) => w.key === 'дом=house')

  it('flags the entry not-learnable but keeps it in the word list', () => {
    expect(noon.learnable).toBe(false)
    expect(house.learnable).toBe(true)
    expect(words).toHaveLength(2) // still present — buildFormIndex can hint it
  })

  it('learnableWords drops gloss-only entries', () => {
    expect(learnableWords(words).map((w) => w.key)).toEqual(['дом=house'])
  })

  it('excludes gloss-only entries from every drill', () => {
    expect(shapeVocab(words).map((v) => v.id)).toEqual(['дом=house'])
    expect(shapeNouns(words).map((n) => n.id)).toEqual(['дом=house'])
    // …and their usage examples never enter the phrase bank.
    const phraseRu = shapePhrases(words).map((p) => p.ru)
    expect(phraseRu).toContain('Большо́й дом')
    expect(phraseRu).not.toContain('До полу́дня')
  })
})

describe('heteronyms', () => {
  it('auto-links same-spelling headwords that differ only in stress', () => {
    const text = `
words:
  "замок=lock":
    cefr_level: A2
    accented: замо́к
    en_gb:
      standard: lock
    declension:
      sg_nom: замо́к
  "замок=castle":
    cefr_level: A2
    accented: за́мок
    en_gb:
      standard: castle
    declension:
      sg_nom: за́мок
`
    const words = buildWords([{ pos: 'noun', text }])
    const lock = words.find((w) => w.key === 'замок=lock')
    expect(lock.heteronyms).toEqual([
      { ru: 'замо́к', gloss: 'lock' },
      { ru: 'за́мок', gloss: 'castle' },
    ])
  })

  it('does not link headwords that share both spelling and stress', () => {
    const text = `
words:
  "коса=plait":
    cefr_level: B1
    accented: коса́
    en_gb:
      standard: plait
    declension:
      sg_nom: коса́
  "коса=scythe":
    cefr_level: B1
    accented: коса́
    en_gb:
      standard: scythe
    declension:
      sg_nom: коса́
`
    const words = buildWords([{ pos: 'noun', text }])
    for (const w of words) expect(w.heteronyms).toEqual([])
  })

  it('falls back to an empty gloss rather than "undefined" when a meaning is missing', () => {
    const text = `
words:
  "замок=lock":
    cefr_level: A2
    accented: замо́к
    declension:
      sg_nom: замо́к
  "замок=castle":
    cefr_level: A2
    accented: за́мок
    declension:
      sg_nom: за́мок
`
    const words = buildWords([{ pos: 'noun', text }])
    for (const w of words) {
      for (const h of w.heteronyms) expect(h.gloss).not.toContain('undefined')
    }
  })

  it('honours an explicit heteronyms annotation over auto-detection', () => {
    const text = `
words:
  "стоить=to cost":
    cefr_level: A2
    accented: сто́ить
    heteronyms:
      - ru: сто́ит
        gloss: it costs
      - ru: стои́т
        gloss: it stands
    en_gb:
      standard: to cost
`
    const [cost] = buildWords([{ pos: 'verb', text }])
    expect(cost.heteronyms).toEqual([
      { ru: 'сто́ит', gloss: 'it costs' },
      { ru: 'стои́т', gloss: 'it stands' },
    ])
    expect(shapeVocab([cost])[0].heteronyms).toEqual(cost.heteronyms)
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

  it('shapePhrases flattens usage examples into translatable phrases', () => {
    const ph = shapePhrases(words)
    expect(ph.length).toBeGreaterThan(0)
    for (const p of ph) {
      expect(p.ru.length, p.id).toBeGreaterThan(0)
      expect(p.en.length, p.id).toBeGreaterThan(0)
    }
    // Phrases are deduplicated by their russian=english pair.
    expect(new Set(ph.map((p) => p.id)).size).toBe(ph.length)
  })
})
