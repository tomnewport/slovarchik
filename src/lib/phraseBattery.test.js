import { describe, it, expect } from 'vitest'
import { buildContextExercise, canBuildContext } from './phraseBattery.js'
import { normalize } from './text.js'

// Minimal battery config mirroring public/vocab/phrase-batteries.yml.
const batteries = {
  nouns: {
    batteries: [
      { id: 'everyday', frames: { gen: 'У меня́ нет ___.', acc: 'Я ви́жу ___.' }, en: { gen: "I don't have ___.", acc: 'I see ___.' } },
      { id: 'animals', frames: { gen: 'Я бою́сь ___.' }, en: { gen: "I'm afraid of ___." }, animate: true },
    ],
  },
  adjectives: {
    shared_frames: {
      gen: { ru: 'У меня́ нет {adj} {N.gen}.', en: "I don't have a {adj} {N}." },
    },
    batteries: [
      { id: 'everyday', carriers: { m: 'дом=house', f: 'вещь=thing', n: 'ме́сто=place', pl: 'вещь=thing' } },
    ],
  },
  verbs: {
    subjects: { present: { '1sg': 'Я', '3sg': 'Он' }, future: {}, past: { past_m: 'Вчера́ он' } },
    batteries: [{ id: 'everyday', tail: 'ча́сто ___' }],
  },
}

const carrierDom = {
  key: 'дом=house',
  pos: 'noun',
  forms: { sg: { nom: 'дом', gen: 'до́ма' }, pl: { nom: 'дома́', gen: 'домо́в' } },
  meaning: 'house',
}
const wordByKey = new Map([[carrierDom.key, carrierDom]])

describe('buildContextExercise — nouns', () => {
  const sobaka = {
    key: 'собака=dog',
    pos: 'noun',
    numbers: ['sg', 'pl'],
    headword: 'соба́ка',
    meaning: 'dog',
    forms: { sg: { nom: 'соба́ка', gen: 'соба́ки', acc: 'соба́ку' }, pl: { nom: 'соба́ки', gen: 'соба́к' } },
    extra: { batteries: ['animals'] },
  }

  it('blanks the lemma and expects the inflected form', () => {
    const ex = buildContextExercise(sobaka, { batteries, wordByKey, rng: () => 0 })
    expect(ex.kind).toBe('phrase-fix')
    // The first non-nominative slot for the animals battery is genitive singular.
    expect(ex.tokens[ex.targetIndex]).toContain('соба́ка') // lemma shown in the blank
    expect(ex.answer).toBe(normalize('соба́ки'))
    expect(ex.en).toContain('dog')
    expect(ex.slotLabel).toMatch(/Genitive/)
  })

  it('falls back to the everyday battery when no tag matches', () => {
    const ex = buildContextExercise({ ...sobaka, extra: { batteries: ['nonexistent'] } }, { batteries, wordByKey, rng: () => 0 })
    expect(ex).not.toBeNull()
  })
})

describe('buildContextExercise — adjectives', () => {
  const noviy = {
    key: 'новый=new',
    pos: 'adjective',
    meaning: 'new',
    extra: {
      batteries: ['everyday'],
      declension: { m_nom: 'но́вый', m_gen: 'но́вого' },
    },
  }
  it('agrees the adjective with a carrier noun', () => {
    const ex = buildContextExercise(noviy, { batteries, wordByKey, rng: () => 0 })
    expect(ex).not.toBeNull()
    expect(ex.lemma).toBe('но́вый')
    expect(ex.answer).toBe(normalize('но́вого'))
    expect(ex.ru).toContain('до́ма') // carrier noun, genitive
  })
})

describe('buildContextExercise — verbs', () => {
  const dumat = {
    key: 'думать=to think',
    pos: 'verb',
    headword: 'ду́мать',
    meaning: 'to think',
    extra: { batteries: ['everyday'], conjugation: { present: { '1sg': 'ду́маю', '3sg': 'ду́мает' } } },
  }
  it('conjugates the infinitive for the carrier subject', () => {
    const ex = buildContextExercise(dumat, { batteries, wordByKey, rng: () => 0 })
    expect(ex).not.toBeNull()
    expect(ex.lemma).toBe('ду́мать')
    expect(['ду́маю', 'ду́мает'].map(normalize)).toContain(ex.answer)
  })
})

describe('canBuildContext', () => {
  it('is false for parts of speech without a context drill', () => {
    expect(canBuildContext({ pos: 'adverb', key: 'тут=here' }, { batteries, wordByKey })).toBe(false)
  })
  it('is false without battery data', () => {
    expect(canBuildContext({ pos: 'noun', key: 'x', forms: {} }, {})).toBe(false)
  })
})
