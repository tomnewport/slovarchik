import { describe, it, expect } from 'vitest'
import { SKILLS, skillById, focusedKeys, rankSkills } from './focus.js'

const words = [
  { key: 'дом=house', pos: 'noun', gender: 'm', animate: false },
  { key: 'кот=cat', pos: 'noun', gender: 'm', animate: true, ru: 'кот' },
  { key: 'вода=water', pos: 'noun', gender: 'f', animate: false },
  { key: 'окно=window', pos: 'noun', gender: 'n', animate: false },
  { key: 'читать=read', pos: 'verb', ru: 'читать', extra: { conjugation: { present: {} } } },
  { key: 'мыться=wash', pos: 'verb', ru: 'мыться', extra: { conjugation: { present: {} } } },
  { key: 'купить=buy', pos: 'verb', ru: 'купить', extra: { conjugation: { future: {} } } },
]

describe('SKILLS catalogue', () => {
  it('classifies words by part of speech and sub-type', () => {
    const m = (id) => skillById(id).match
    expect(words.filter(m('pos:noun'))).toHaveLength(4)
    expect(words.filter(m('noun:m'))).toHaveLength(2)
    expect(words.filter(m('noun:animate'))).toHaveLength(1)
    expect(words.filter(m('verb:imperfective'))).toHaveLength(2)
    expect(words.filter(m('verb:perfective'))).toHaveLength(1)
    expect(words.filter(m('verb:reflexive'))).toHaveLength(1) // мыться
  })
  it('skillById returns null for an unknown id', () => {
    expect(skillById('nope')).toBe(null)
  })
})

describe('focusedKeys', () => {
  it('returns non-unknown matching word keys', () => {
    const stateOf = (k) => (k === 'дом=house' ? 'unknown' : 'learning')
    const keys = focusedKeys(words, skillById('pos:noun'), stateOf)
    expect(keys).not.toContain('дом=house') // unknown excluded
    expect(keys).toContain('кот=cat')
    expect(keys).toHaveLength(3)
  })
})

describe('rankSkills', () => {
  it('ranks categories by the fraction of attempted words not yet learned', () => {
    // All nouns attempted; masculine ones are still "learning", others mastered.
    const stateOf = (k) =>
      ({ 'дом=house': 'learning', 'кот=cat': 'learning', 'вода=water': 'mastered', 'окно=window': 'mastered' })[k] ??
      'unknown'
    const ranked = rankSkills(words, { stateOf, minWords: 2 })
    const noun = ranked.find((r) => r.id === 'pos:noun')
    const masc = ranked.find((r) => r.id === 'noun:m')
    expect(masc.weakness).toBe(1) // both masculine still learning
    expect(noun.weakness).toBe(0.5) // 2 of 4 nouns learning
    // Weakest first.
    expect(ranked[0].weakness).toBeGreaterThanOrEqual(ranked[ranked.length - 1].weakness)
  })

  it('drops categories below the minimum word count or with no weakness', () => {
    const stateOf = () => 'mastered' // nothing is struggling
    expect(rankSkills(words, { stateOf, minWords: 2 })).toEqual([])
  })

  it('SKILLS all have an id, label and match predicate', () => {
    for (const s of SKILLS) {
      expect(typeof s.id).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(typeof s.match).toBe('function')
    }
  })
})
