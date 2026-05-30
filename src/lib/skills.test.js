import { describe, it, expect } from 'vitest'

import { emptyStat, describeStat } from './progress.js'
import {
  BREADTH_TIERS,
  breadthTier,
  buildSkills,
  groupByBreadth,
  weakestSkills,
  collectionReadiness,
} from './skills.js'

// Full vocab records (with nested forms) — what buildSkills reads for breadth.
const WORDS = [
  { key: 'лебедь=swan', pos: 'noun', gender: 'm', animacy: 'a', collections: ['animals'], headword: 'ле́бедь', ru: 'лебедь', forms: { sg: { nom: 'ле́бедь', gen: 'ле́бедя' }, pl: { nom: 'ле́беди', gen: 'лебеде́й' } } },
  { key: 'море=sea', pos: 'noun', gender: 'n', animacy: 'i', collections: ['nature'], headword: 'мо́ре', ru: 'море', forms: { sg: { nom: 'мо́ре', gen: 'мо́ря' }, pl: { nom: 'моря́', gen: 'море́й' } } },
  { key: 'ворота=gate', pos: 'noun', gender: 'n', animacy: 'i', collections: ['architecture'], headword: 'воро́та', ru: 'ворота', forms: { pl: { nom: 'воро́та', gen: 'воро́т' } } },
  { key: 'деньги=money', pos: 'noun', gender: null, animacy: 'i', collections: ['shopping'], headword: 'де́ньги', ru: 'деньги', forms: { pl: { nom: 'де́ньги', gen: 'де́нег' } } },
]
const wordsByKey = new Map(WORDS.map((w) => [w.key, w]))

const ev = (grade, level) => ({ grade, level })
function described(subject, evs) {
  const record = { ...emptyStat(subject), events: evs.map((e, i) => ({ at: i + 1, ...e })) }
  return describeStat(record, wordsByKey)
}

const STATS = [
  described({ kind: 'word', key: 'лебедь=swan' }, [ev(2, 'advanced')]), //   mastered (1× hard), no errors
  described({ kind: 'form', key: 'лебедь=swan', slot: 'pl.gen' }, [ev(2, 'intermediate')]),
  described({ kind: 'word', key: 'море=sea' }, [ev(2, 'intermediate')]), //   1/3 mastery
  described({ kind: 'form', key: 'море=sea', slot: 'sg.gen' }, [ev(0, 'easy'), ev(0, 'easy'), ev(2, 'intermediate')]), // 2/3 wrong
  described({ kind: 'form', key: 'деньги=money', slot: 'pl.gen' }, [ev(0, 'easy')]), // always wrong
]
const skills = buildSkills(STATS, WORDS)
const byId = new Map(skills.map((s) => [s.id, s]))

describe('breadth tiers', () => {
  it('places a count in the widest band it qualifies for', () => {
    expect(breadthTier(150).id).toBe('broad')
    expect(breadthTier(100).id).toBe('broad')
    expect(breadthTier(10).id).toBe('medium')
    expect(breadthTier(9).id).toBe('narrow')
    expect(breadthTier(1).id).toBe('narrow')
  })

  it('groups skills into one bucket per tier', () => {
    const groups = groupByBreadth(skills)
    expect(groups.map((g) => g.id)).toEqual(BREADTH_TIERS.map((t) => t.id))
    // Every skill here covers < 10 words, so they all land in the narrow band.
    const narrow = groups.find((g) => g.id === 'narrow')
    expect(narrow.skills).toHaveLength(skills.length)
  })
})

describe('buildSkills — breadth = relevant word count', () => {
  it('covers one word for a word skill', () => {
    const swan = byId.get('word:лебедь=swan')
    expect(swan.breadth).toBe(1)
    expect(swan.kind).toBe('word')
    expect(swan.mastery).toBeCloseTo(1)
    expect(swan.errorRate).toBe(0)
  })

  it('covers every matching noun for a gender skill', () => {
    const neuter = byId.get('type:gender:n') // sea + gate
    expect(neuter.label).toBe('Neuter nouns')
    expect(neuter.breadth).toBe(2)
  })

  it('covers every noun that has the form for a grammar skill', () => {
    expect(byId.get('form:pl.gen').breadth).toBe(4) // all four nouns have a plural genitive
    expect(byId.get('form:sg.gen').breadth).toBe(2) // only swan + sea have singulars
    expect(byId.get('form:sg.gen').label).toBe('Genitive singular')
  })

  it('covers a collection’s members for a collection skill', () => {
    expect(byId.get('collection:nature').breadth).toBe(1)
    expect(byId.get('collection:animals').kind).toBe('collection')
  })
})

describe('exam readiness per collection', () => {
  it('unlocks once every word in the collection is mastered', () => {
    const animals = collectionReadiness(STATS, WORDS, 'animals') // swan, mastered
    expect(animals).toMatchObject({ words: 1, mastered: 1, eligible: true })
    expect(animals.readiness).toBeCloseTo(1)

    const nature = collectionReadiness(STATS, WORDS, 'nature') // sea, 1/3 mastered
    expect(nature.eligible).toBe(false)
    expect(nature.readiness).toBeCloseTo(1 / 3)
  })
})

describe('weakest skills (practice focus)', () => {
  it('returns the worst quartile of attempted skills, never a clean one', () => {
    const weak = weakestSkills(skills)
    const attempted = skills.filter((s) => s.attempts > 0)
    expect(weak).toHaveLength(Math.ceil(attempted.length * 0.25))
    expect(weak[0].errorRate).toBeCloseTo(1) // money's genitive plural / shopping
    // The fully-mastered, error-free swan skill is not flagged as weak.
    expect(weak.some((s) => s.id === 'word:лебедь=swan')).toBe(false)
  })
})

describe('number-drill skills (non-lexical)', () => {
  const numStats = [
    described({ kind: 'number', key: 'year' }, [ev(2, 'advanced'), ev(0, 'advanced')]), // 1/2 wrong
    described({ kind: 'number', key: 'caseForm' }, [ev(0, 'advanced'), ev(0, 'advanced'), ev(0, 'advanced')]),
  ]
  const ns = buildSkills([...STATS, ...numStats], WORDS, {
    numberLabels: { year: 'Years', caseForm: 'Number cases' },
  })
  const nById = new Map(ns.map((s) => [s.id, s]))

  it('creates one skill per topic, with a friendly label and no vocab words', () => {
    const yr = nById.get('number:year')
    expect(yr.kind).toBe('number')
    expect(yr.label).toBe('Years')
    expect(yr.breadth).toBe(0)
    expect(yr.wordKeys).toEqual([])
    expect(yr.strength).toBeCloseTo(0.5)
  })

  it('lets a weak number topic surface among the weakest skills', () => {
    expect(weakestSkills(ns).some((s) => s.id === 'number:caseForm')).toBe(true)
  })
})
