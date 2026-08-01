import { describe, it, expect } from 'vitest'

import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import {
  promotionCandidates,
  guessPos,
  scaffoldEntry,
  hasUnresolvedMarkers,
} from './glossaryPromotion.js'
import { loadFixtureWords } from '../test/fixtures.js'

// buildWords takes parsed docs; these tests author inline YAML, so parse first.
const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

// A learnable noun whose usage example leans on two glossary words: «мяч» (a
// clean promotable noun) and «купи» (an imperative — a verb surface form).
const noun = `
words:
  "мальчик=boy":
    cefr_level: A1
    gender: m
    animacy: a
    en_gb: { standard: boy }
    usage:
      - { ru: Купи́ ма́льчику мяч., en_gb: Buy the boy a ball. }
    declension:
      sg_nom: ма́льчик
      sg_gen: ма́льчика
      sg_dat: ма́льчику
      sg_acc: ма́льчика
      sg_ins: ма́льчиком
      sg_pre: ма́льчике
      pl_nom: ма́льчики
      pl_gen: ма́льчиков
      pl_dat: ма́льчикам
      pl_acc: ма́льчиков
      pl_ins: ма́льчиками
      pl_pre: ма́льчиках
`

const glossary = `
words:
  "мяч=ball":
    cefr_level: A1
    learn: false
    accented: мяч
    en_gb: { standard: ball }
  "купи=buy":
    cefr_level: A2
    learn: false
    accented: купи́
    en_gb: { standard: buy (imperative of купи́ть) }
  "неведомый=unknown":
    cefr_level: C1
    learn: false
    accented: неве́домый
    en_gb: { standard: unknown }
`

describe('promotionCandidates', () => {
  const words = fromYaml([
    { pos: 'noun', text: noun },
    { pos: 'glossary', text: glossary },
  ])

  it('ranks glossary entries by how many phrase tokens they gloss', () => {
    const rows = promotionCandidates(words)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    // Both мяч and купи appear once in the single usage sentence.
    expect(byKey['мяч=ball'].count).toBe(1)
    expect(byKey['купи=buy'].count).toBe(1)
    // неведомый never appears in a phrase → not a candidate at all.
    expect(byKey['неведомый=unknown']).toBeUndefined()
  })

  it('carries the gloss data a promotion can reuse safely', () => {
    const row = promotionCandidates(words).find((r) => r.key === 'мяч=ball')
    expect(row.cefr).toBe('A1')
    expect(row.en).toBe('ball')
    expect(row.headword).toBe('мяч')
    expect(row.phrases).toContain('Купи́ ма́льчику мяч.')
  })

  it('flags a glossary entry whose meaning a learnable word already owns', () => {
    const dupWords = fromYaml([
      { pos: 'noun', text: noun },
      {
        pos: 'glossary',
        text: `
words:
  "мяч=boy":
    cefr_level: A1
    learn: false
    accented: мяч
    en_gb: { standard: boy }
`,
      },
    ])
    const row = promotionCandidates(dupWords).find((r) => r.key === 'мяч=boy')
    // «мальчик=boy» is a learnable entry with the same meaning → collision.
    expect(row.collision).toBe('мальчик=boy')
  })

  it('returns nothing when there are no glossary entries', () => {
    expect(promotionCandidates(fromYaml([{ pos: 'noun', text: noun }]))).toEqual([])
  })
})

describe('guessPos', () => {
  it('recognises verb infinitives with high confidence', () => {
    expect(guessPos('покупать')).toMatchObject({ pos: 'verb', confidence: 'likely' })
    expect(guessPos('учиться')).toMatchObject({ pos: 'verb', confidence: 'likely' })
    expect(guessPos('мочь')).toMatchObject({ pos: 'verb', confidence: 'likely' })
    expect(guessPos('идти')).toMatchObject({ pos: 'verb', confidence: 'likely' })
  })

  it('recognises adjective masculine nominatives', () => {
    expect(guessPos('красивый')).toMatchObject({ pos: 'adjective', confidence: 'likely' })
    expect(guessPos('другой')).toMatchObject({ pos: 'adjective', confidence: 'likely' })
  })

  it('is honest about ambiguous endings rather than guessing confidently', () => {
    // An adjective agreement form is not a lemma — flagged, not asserted.
    expect(guessPos('автономных').confidence).toBe('uncertain')
    // -о could be adverb or neuter noun/short form.
    expect(guessPos('быстро')).toMatchObject({ pos: 'adverb', confidence: 'uncertain' })
    // A bare consonant noun is only a guess.
    expect(guessPos('матч')).toMatchObject({ pos: 'noun', confidence: 'uncertain' })
  })

  it('spots multi-word keys that are not single lemmas', () => {
    expect(guessPos('из-за чего').pos).toBe('phrase')
  })
})

describe('scaffoldEntry', () => {
  const words = fromYaml([
    { pos: 'noun', text: noun },
    { pos: 'glossary', text: glossary },
  ])
  const gloss = (key) => words.find((w) => w.pos === 'glossary' && w.key === key)

  it('never emits a finished entry — every stub still has authoring markers', () => {
    for (const key of ['мяч=ball', 'купи=buy']) {
      const stub = scaffoldEntry(gloss(key))
      expect(hasUnresolvedMarkers(stub)).toBe(true)
    }
  })

  it('carries the gloss and CEFR but leaves inflection cells as TODO', () => {
    const stub = scaffoldEntry(gloss('мяч=ball'), { pos: 'noun' })
    expect(stub).toContain('cefr_level: A1')
    expect(stub).toContain('standard: ball')
    // The declension grid is scaffolded but never guessed.
    expect(stub).toContain('sg_nom: TODO')
    expect(stub).toContain('pl_gen: TODO')
    // No fabricated usage sentence — the array is left empty for hand-authoring.
    expect(stub).toMatch(/usage:.*\n\s*\[\]/)
  })

  it('routes each POS to the right file and skeleton', () => {
    expect(scaffoldEntry(gloss('мяч=ball'), { pos: 'noun' })).toContain('→ nouns.yml')
    const verb = scaffoldEntry(gloss('купи=buy'), { pos: 'verb', lemma: 'купить' })
    expect(verb).toContain('→ verbs.yml')
    expect(verb).toContain('"купить=buy"') // hand-supplied lemma is used in the key
    expect(verb).toContain('conjugation:')
  })

  it('warns when the lemma is defaulted from the surface form', () => {
    const defaulted = scaffoldEntry(gloss('купи=buy'), { pos: 'verb' })
    expect(defaulted).toMatch(/Lemma defaulted to the surface form/)
    const supplied = scaffoldEntry(gloss('купи=buy'), { pos: 'verb', lemma: 'купить' })
    expect(supplied).toMatch(/Lemma supplied by hand/)
  })

  it('points adjectives at the declension generator instead of hand-writing a grid', () => {
    const stub = scaffoldEntry(gloss('неведомый=unknown'), { pos: 'adjective' })
    expect(stub).toContain('forms:')
    expect(stub).toContain('gen:adjectives')
    // It must NOT scaffold a declension grid — the generator owns that.
    expect(stub).not.toMatch(/^\s*m_nom:/m)
  })

  it('produces a body that parses as valid YAML', () => {
    const stub = scaffoldEntry(gloss('мяч=ball'), { pos: 'noun' })
    const body = stub
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
    const doc = yaml.load('words:\n' + body)
    expect(Object.keys(doc.words)).toEqual(['мяч=ball'])
  })
})

describe('real glossary corpus', () => {
  it('produces a non-empty, frequency-sorted candidate list', () => {
    const rows = promotionCandidates(loadFixtureWords())
    expect(rows.length).toBeGreaterThan(100)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count)
    }
  })

  it('scaffolds the busiest candidate without throwing', () => {
    const rows = promotionCandidates(loadFixtureWords())
    const word = loadFixtureWords().find((w) => w.pos === 'glossary' && w.key === rows[0].key)
    expect(() => scaffoldEntry(word)).not.toThrow()
  })
})
