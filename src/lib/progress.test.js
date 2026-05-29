import { describe, it, expect } from 'vitest'

import {
  GRADES,
  MAX_EVENTS,
  gradeFor,
  subjectId,
  parseSubjectId,
  emptyStat,
  recordEvent,
  applyEvent,
  summarize,
  describeSubject,
  describeStat,
  aggregate,
  rankBuckets,
  combined,
  mostMistakenWords,
  mostMistakenForms,
  mistakenByFacet,
  mostMistakenCollections,
} from './progress.js'

// --- A small fabricated vocab + history --------------------------------------
// Normalised word records (the subset describeSubject reads), keyed by key.
const WORDS = [
  { key: 'лебедь=swan', pos: 'noun', gender: 'm', animacy: 'a', cefr: 'B1', collections: ['animals', 'nature'], headword: 'ле́бедь', ru: 'лебедь' },
  { key: 'собака=dog', pos: 'noun', gender: 'f', animacy: 'a', cefr: 'A1', collections: ['animals'], headword: 'соба́ка', ru: 'собака' },
  { key: 'море=sea', pos: 'noun', gender: 'n', animacy: 'i', cefr: 'A2', collections: ['nature'], headword: 'мо́ре', ru: 'море' },
  { key: 'ворота=gate', pos: 'noun', gender: 'n', animacy: 'i', cefr: 'B2', collections: ['architecture'], headword: 'воро́та', ru: 'ворота' },
  { key: 'деньги=money', pos: 'noun', gender: null, animacy: 'i', cefr: 'A2', collections: ['shopping'], headword: 'де́ньги', ru: 'деньги' },
]
const wordsByKey = new Map(WORDS.map((w) => [w.key, w]))

/** Build a stored stat with a given mix of graded events. */
function statOf(subject, { incorrect = 0, easy = 0, correct = 0 } = {}) {
  const grades = [
    ...Array(incorrect).fill(GRADES.INCORRECT),
    ...Array(easy).fill(GRADES.EASY),
    ...Array(correct).fill(GRADES.CORRECT),
  ]
  return { ...emptyStat(subject), events: grades.map((grade, i) => ({ at: 1000 + i, grade })) }
}

const records = [
  // Words (each ≤ 10 attempts, so single-word rates are multiples of 10%).
  statOf({ kind: 'word', key: 'лебедь=swan' }, { incorrect: 3, correct: 7 }), // 0.30
  statOf({ kind: 'word', key: 'собака=dog' }, { incorrect: 1, correct: 9 }), //  0.10
  statOf({ kind: 'word', key: 'море=sea' }, { incorrect: 1, correct: 9 }), //    0.10 (neuter)
  statOf({ kind: 'word', key: 'ворота=gate' }, { incorrect: 1, correct: 9 }), // 0.10 (neuter)
  statOf({ kind: 'word', key: 'деньги=money' }, { correct: 4 }), //              0.00
  // Forms.
  statOf({ kind: 'form', key: 'деньги=money', slot: 'pl.gen' }, { incorrect: 3, correct: 7 }), // 0.30
  statOf({ kind: 'form', key: 'деньги=money', slot: 'pl.nom' }, { correct: 10 }), //             0.00
  statOf({ kind: 'form', key: 'море=sea', slot: 'sg.gen' }, { incorrect: 2, correct: 8 }), //    0.20 (neuter gen)
  statOf({ kind: 'form', key: 'море=sea', slot: 'sg.nom' }, { incorrect: 1, correct: 9 }), //    0.10 (neuter nom)
  statOf({ kind: 'form', key: 'ворота=gate', slot: 'pl.nom' }, { correct: 10 }), //              0.00 (neuter nom)
  // Phrase.
  statOf({ kind: 'phrase', key: 'Большие ворота открылись.=The big gate opened.' }, { incorrect: 1, correct: 4 }),
]
const stats = records.map((r) => describeStat(r, wordsByKey))

// --- Primitives ---------------------------------------------------------------

describe('grades & subjects', () => {
  it('maps drill level + correctness to a grade', () => {
    expect(gradeFor('easy', true)).toBe(GRADES.EASY)
    expect(gradeFor('intermediate', true)).toBe(GRADES.CORRECT)
    expect(gradeFor('advanced', true)).toBe(GRADES.CORRECT)
    expect(gradeFor('hard', true)).toBe(GRADES.CORRECT)
    expect(gradeFor('easy', false)).toBe(GRADES.INCORRECT)
    expect(gradeFor('advanced', false)).toBe(GRADES.INCORRECT)
  })

  it('round-trips subject ids for words, forms and phrases', () => {
    const cases = [
      { kind: 'word', key: 'лебедь=swan' },
      { kind: 'form', key: 'море=sea', slot: 'sg.nom' },
      { kind: 'phrase', key: 'Большие ворота открылись.=The big gate opened.' },
    ]
    for (const subject of cases) {
      expect(parseSubjectId(subjectId(subject))).toEqual(subject)
    }
    expect(subjectId({ kind: 'form', key: 'море=sea', slot: 'sg.nom' })).toBe('form:море=sea#sg.nom')
  })
})

describe('event history', () => {
  it('keeps only the most recent MAX_EVENTS, dropping the oldest', () => {
    let events = []
    for (let i = 0; i < 8; i++) events = recordEvent(events, GRADES.INCORRECT, i)
    for (let i = 8; i < 15; i++) events = recordEvent(events, GRADES.CORRECT, i)
    expect(events).toHaveLength(MAX_EVENTS)
    const { incorrect, correct } = summarize(events)
    // 15 attempts (8 wrong, 7 right) capped to the last 10 → 3 wrong + 7 right.
    expect(incorrect).toBe(3)
    expect(correct).toBe(7)
  })

  it('applyEvent is pure and summarize reports counts, error rate and recency', () => {
    const before = statOf({ kind: 'word', key: 'море=sea' }, { incorrect: 1, correct: 1 })
    const after = applyEvent(before, GRADES.INCORRECT, 9999)
    expect(before.events).toHaveLength(2) // untouched
    expect(after.events).toHaveLength(3)
    const s = summarize(after.events)
    expect(s).toMatchObject({ attempts: 3, incorrect: 2, correct: 1, lastAt: 9999 })
    expect(s.errorRate).toBeCloseTo(2 / 3)
  })

  it('an empty history has a zero error rate (never divides by zero)', () => {
    expect(summarize([])).toMatchObject({ attempts: 0, errorRate: 0, lastAt: null })
  })
})

describe('describeSubject', () => {
  it('labels and tags a word, a form and a phrase from the vocab', () => {
    const word = describeSubject({ kind: 'word', key: 'море=sea' }, wordsByKey)
    expect(word.label).toBe('мо́ре')
    expect(word.facets).toMatchObject({ kind: 'word', gender: 'n', pos: 'noun', collections: ['nature'] })

    const form = describeSubject({ kind: 'form', key: 'море=sea', slot: 'sg.gen' }, wordsByKey)
    expect(form.label).toBe('мо́ре · sg gen')
    expect(form.facets).toMatchObject({ kind: 'form', gender: 'n', number: 'sg', case: 'gen', slot: 'sg.gen' })

    const phrase = describeSubject({ kind: 'phrase', key: 'Большие ворота открылись.=The big gate opened.' })
    expect(phrase.label).toBe('Большие ворота открылись.')
    expect(phrase.facets).toEqual({ kind: 'phrase' })
  })

  it('falls back gracefully when the word is no longer in the vocab', () => {
    const gone = describeSubject({ kind: 'word', key: 'исчез=vanished' }, wordsByKey)
    expect(gone.label).toBe('исчез=vanished')
    expect(gone.facets).toMatchObject({ kind: 'word', gender: null })
  })
})

// --- The four headline queries from the issue ---------------------------------

describe('query: most mistaken words', () => {
  it('ranks words by error rate, worst first', () => {
    const ranked = mostMistakenWords(stats)
    expect(ranked.every((b) => b.kind === 'word')).toBe(true)
    expect(ranked[0].key).toBe('лебедь=swan') // 0.30, the clear worst
    expect(ranked[0].errorRate).toBeCloseTo(0.3)
    expect(ranked[ranked.length - 1].key).toBe('деньги=money') // 0.00, the best
  })

  it('honours minAttempts and limit', () => {
    expect(mostMistakenWords(stats, { limit: 2 })).toHaveLength(2)
    expect(mostMistakenWords(stats, { minAttempts: 5 }).some((b) => b.key === 'деньги=money')).toBe(false)
  })
})

describe('query: most mistaken word-forms', () => {
  it('ranks individual forms by error rate', () => {
    const ranked = mostMistakenForms(stats)
    expect(ranked.every((b) => b.kind === 'form')).toBe(true)
    // e.g. "the genitive plural of money" is the worst form here.
    expect(ranked[0]).toMatchObject({ key: 'деньги=money', slot: 'pl.gen' })
    expect(ranked[0].errorRate).toBeCloseTo(0.3)
    expect(ranked[0].label).toBe('де́ньги · pl gen')
  })
})

describe('query: aggregate by noun gender', () => {
  it('rolls every attempt up by gender and ranks the genders', () => {
    const byGender = mistakenByFacet(stats, 'gender', { kind: 'word' })
    expect(byGender[0].key).toBe('m') // swan only → 0.30
    const neuter = byGender.find((b) => b.key === 'n')
    // Neuter words: sea (1/10) + gate (1/10) = 2/20 → "neuter nouns wrong 10% of the time".
    expect(neuter.attempts).toBe(20)
    expect(neuter.errorRate).toBeCloseTo(0.1)
    // Words with no gender (pluralia tantum 'money') drop out of the grouping.
    expect(byGender.some((b) => b.key === null)).toBe(false)
  })

  it('combines an arbitrary slice into one rate — nominative forms of neuter nouns', () => {
    const slice = combined(
      stats,
      (s) => s.kind === 'form' && s.facets.gender === 'n' && s.facets.case === 'nom',
    )
    // sea sg.nom (1/10) + gate pl.nom (0/10) = 1/20 → 5%.
    expect(slice.attempts).toBe(20)
    expect(slice.incorrect).toBe(1)
    expect(slice.errorRate).toBeCloseTo(0.05)
  })
})

describe('query: most mistaken collections', () => {
  it('ranks collections, counting multi-collection words towards each', () => {
    const byCollection = mostMistakenCollections(stats)
    const animals = byCollection.find((b) => b.key === 'animals')
    const nature = byCollection.find((b) => b.key === 'nature')
    // swan (0.30) is in both animals and nature, so it lifts both buckets.
    expect(animals.attempts).toBe(20) // swan + dog
    expect(nature.attempts).toBe(20) // swan + sea
    expect(animals.errorRate).toBeCloseTo(0.2)
    expect(nature.errorRate).toBeCloseTo(0.2)
    // Worst collection ties at 0.20; 'animals' wins the alphabetical tie-break.
    expect(byCollection[0].key).toBe('animals')
  })
})

// --- Aggregation engine internals --------------------------------------------

describe('aggregate & rankBuckets', () => {
  it('rolls everything into one bucket when no groupBy is given', () => {
    const [all] = aggregate(stats)
    const totalAttempts = stats.reduce((n, s) => n + s.attempts, 0)
    expect(all.key).toBe('all')
    expect(all.attempts).toBe(totalAttempts)
  })

  it('drops buckets below minAttempts', () => {
    const buckets = [
      { key: 'a', attempts: 1, incorrect: 1, errorRate: 1 },
      { key: 'b', attempts: 10, incorrect: 1, errorRate: 0.1 },
    ]
    expect(rankBuckets(buckets, { minAttempts: 5 }).map((b) => b.key)).toEqual(['b'])
  })
})
