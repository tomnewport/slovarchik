import { describe, it, expect } from 'vitest'
import {
  parseKey,
  buildWords,
  shapeVocab,
  vocabDisplay,
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

describe('ambiguousEn', () => {
  const text = `
words:
  "дочка=daughter":
    cefr_level: A1
    en_gb:
      standard: daughter (an informal term)
  "дочь=daughter":
    cefr_level: A1
    en_gb:
      standard: daughter (a female child)
  "дом=house":
    cefr_level: A1
    en_gb:
      standard: house
`
  const words = buildWords([{ pos: 'noun', text }])

  it('marks words that share a base English meaning', () => {
    const dochka = words.find((w) => w.key === 'дочка=daughter')
    const doch = words.find((w) => w.key === 'дочь=daughter')
    expect(dochka.ambiguousEn).toHaveLength(1)
    expect(dochka.ambiguousEn[0].ru).toBe('дочь')
    expect(doch.ambiguousEn).toHaveLength(1)
    expect(doch.ambiguousEn[0].ru).toBe('дочка')
  })

  it('leaves non-colliding words with an empty ambiguousEn', () => {
    const house = words.find((w) => w.key === 'дом=house')
    expect(house.ambiguousEn).toEqual([])
  })

  it('carries the sibling disambiguating note', () => {
    const dochka = words.find((w) => w.key === 'дочка=daughter')
    expect(dochka.ambiguousEn[0].note).toBe('a female child')
  })

  it('shapeVocab exposes ambiguousEn as an array on every word', () => {
    const shaped = shapeVocab(words)
    for (const w of shaped) expect(Array.isArray(w.ambiguousEn)).toBe(true)
    const dochka = shaped.find((w) => w.id === 'дочка=daughter')
    expect(dochka.ambiguousEn).toHaveLength(1)
  })

  it('does not include non-learnable words in collision groups', () => {
    const gloss = `
words:
  "шить=to sew":
    cefr_level: A2
    en_gb:
      standard: to sew
  "шить2=to sew":
    learn: false
    cefr_level: A2
    en_gb:
      standard: to sew
`
    const ws = buildWords([{ pos: 'verb', text: gloss }])
    const sew = ws.find((w) => w.key === 'шить=to sew')
    expect(sew.ambiguousEn).toEqual([])
  })
})

describe('aspect pairs', () => {
  const text = `
words:
  "говорить=to speak":
    cefr_level: A1
    accented: говори́ть
    aspect: impf
    pair: "сказать=to say"
    en_gb:
      standard: to speak (to talk, produce speech)
  "сказать=to say":
    cefr_level: A1
    accented: сказа́ть
    aspect: pf
    pair: "говорить=to speak"
    en_gb:
      standard: to say (to utter words, on one occasion)
  "жить=to live":
    cefr_level: A1
    accented: жить
    aspect: impf
    en_gb:
      standard: to live
  "висеть=to hang":
    cefr_level: A2
    accented: висе́ть
    aspect: impf
    pair: "нет=такого"
    en_gb:
      standard: to hang
`
  const words = buildWords([{ pos: 'verb', text }])
  const govorit = words.find((w) => w.key === 'говорить=to speak')
  const skazat = words.find((w) => w.key === 'сказать=to say')

  it('resolves reciprocal pair links with headword, aspect and gloss', () => {
    expect(govorit.aspect).toBe('impf')
    expect(govorit.aspectPair).toEqual({
      key: 'сказать=to say',
      ru: 'сказа́ть',
      aspect: 'pf',
      gloss: 'to say',
    })
    expect(skazat.aspectPair).toMatchObject({ key: 'говорить=to speak', ru: 'говори́ть', aspect: 'impf' })
  })

  it('leaves unpaired verbs and dangling keys unlinked', () => {
    expect(words.find((w) => w.key === 'жить=to live').aspectPair).toBeNull()
    expect(words.find((w) => w.key === 'висеть=to hang').aspectPair).toBeNull()
  })

  it('shapeVocab exposes aspect and aspectPair', () => {
    const shaped = shapeVocab(words)
    const g = shaped.find((v) => v.id === 'говорить=to speak')
    expect(g.aspect).toBe('impf')
    expect(g.aspectPair).toMatchObject({ ru: 'сказа́ть', aspect: 'pf' })
    expect(shaped.find((v) => v.id === 'жить=to live').aspectPair).toBeNull()
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
    // Every phrase carries an (possibly empty) list of alternate renderings.
    for (const p of ph) expect(Array.isArray(p.enAlt)).toBe(true)
  })

  it('shapePhrases carries en_alt as extra accepted renderings', () => {
    const text = `
words:
  "город=city":
    cefr_level: A1
    accented: го́род
    en_gb: { standard: city (a large town) }
    usage:
      - ru: Э́то большо́й го́род.
        en_gb: This is a big city.
        en_alt:
          - This city is big.
          - ""
`
    const ph = shapePhrases(buildWords([{ pos: 'noun', text }]))
    expect(ph).toHaveLength(1)
    // Blank entries are dropped; real alternates are kept.
    expect(ph[0].enAlt).toEqual(['This city is big.'])
  })
})

describe('the bundled vocabulary has no case-only duplicate keys', () => {
  // Guards against the class of duplicate fixed in #365: the same proper noun
  // stored twice under a lowercase and a capitalised key (Москва/москва), each
  // with its own independent learning progress. Grading lowercases anyway, so
  // two keys differing only by letter case are always the same word.
  it('no two learnable keys differ only by letter case', () => {
    const byLower = new Map()
    for (const w of learnableWords(loadFixtureWords())) {
      const lower = w.key.toLowerCase()
      if (!byLower.has(lower)) byLower.set(lower, new Set())
      byLower.get(lower).add(w.key)
    }
    const collisions = [...byLower.values()]
      .filter((keys) => keys.size > 1)
      .map((keys) => [...keys].join(' / '))
    expect(collisions).toEqual([])
  })
})

describe('display_number (usually-plural nouns)', () => {
  const build = (extra) =>
    buildWords([
      {
        pos: 'noun',
        text: `
words:
  "перчатка=glove":
    cefr_level: B1
    gender: f
    animacy: i
    number: ["sg", "pl"]
    ${extra}
    en_gb:
      standard: glove (a covering for the hand)
    declension:
      sg_nom: перча́тка
      sg_gen: перча́тки
      sg_dat: перча́тке
      sg_acc: перча́тку
      sg_ins: перча́ткой
      sg_pre: перча́тке
      pl_nom: перча́тки
      pl_gen: перча́ток
      pl_dat: перча́ткам
      pl_acc: перча́тки
      pl_ins: перча́тками
      pl_pre: перча́тках
`,
      },
    ])

  it('defaults to singular and captures the plural surface form/gloss', () => {
    const [w] = build('en_pl: gloves')
    expect(w.displayNumber).toBe('sg')
    expect(w.displayRuPl).toBe('перча́тки')
    expect(w.displayEnPl).toEqual(['gloves'])
  })

  it('normalises an en_pl list, dropping any parenthetical note', () => {
    const [w] = build('en_pl: [gloves, mittens (fingerless)]')
    expect(w.displayEnPl).toEqual(['gloves', 'mittens'])
  })

  it('shapeVocab carries the display preference through', () => {
    const [v] = shapeVocab(build('display_number: pl\n    en_pl: gloves'))
    expect(v.displayNumber).toBe('pl')
    expect(v.ruPl).toBe('перча́тки')
    expect(v.enPl).toEqual(['gloves'])
    // The shaped singular fields stay the dictionary headword/gloss.
    expect(v.ru).toBe('перча́тка')
    expect(v.en).toContain('glove')
  })

  it('vocabDisplay shows the plural form and gloss when display_number is pl', () => {
    const [v] = shapeVocab(build('display_number: pl\n    en_pl: gloves'))
    expect(vocabDisplay(v)).toEqual({ ru: 'перча́тки', en: ['gloves'], number: 'pl' })
  })

  it('vocabDisplay shows the singular by default', () => {
    const [v] = shapeVocab(build('en_pl: gloves'))
    const d = vocabDisplay(v)
    expect(d.number).toBe('sg')
    expect(d.ru).toBe('перча́тка')
  })

  it('mixed flips between singular and plural on the injected rng', () => {
    const [v] = shapeVocab(build('display_number: mixed\n    en_pl: gloves'))
    expect(vocabDisplay(v, () => 0.1).number).toBe('pl') // < 0.5 → plural
    expect(vocabDisplay(v, () => 0.9).number).toBe('sg') // ≥ 0.5 → singular
  })

  it('falls back to the singular when the plural data is missing', () => {
    // Marked plural but no en_pl authored: never render a blank plural prompt.
    const [v] = shapeVocab(build('display_number: pl'))
    expect(vocabDisplay(v).number).toBe('sg')
  })
})
