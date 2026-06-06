import { describe, it, expect } from 'vitest'
import { buildExercises, PRACTICE_KIND, MATCH_PAIRS, MIN_ENCOUNTERS_FOR_SPELLING, MIN_WORDS_FOR_SPELLING } from './exerciseBuild.js'
import { shapePhrases } from './vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

const words = loadFixtureWords()
const phrases = shapePhrases(words)

// One practice per catalogue entry, each with an empty pool (so the builder
// tops up from the whole vocabulary).
function practice(practiceType, overrides = {}) {
  const dims = {
    'match-vocab': 'identification',
    'listen-match': 'hearing',
    'translate-phrase': 'identification',
    'listen-translate': 'hearing',
    'spell-word': 'usage',
    'spell-phrase': 'usage',
    dictation: 'hearing',
    'repeat-word': 'speaking',
    'repeat-phrase': 'speaking',
    'inflect-bank': 'identification',
    'inflect-keyboard': 'usage',
  }
  const content = practiceType.includes('phrase') || practiceType === 'translate-phrase' || practiceType === 'dictation' || practiceType === 'listen-translate'
    ? 'phrase'
    : practiceType.startsWith('inflect')
      ? 'inflection'
      : 'word'
  return {
    practiceType,
    dimension: dims[practiceType],
    level: practiceType.startsWith('inflect') ? 'mastery' : 'learning',
    content,
    bucket: 'current',
    exercises: 3,
    pool: [],
    ...overrides,
  }
}

function build(practices, seed = 1) {
  return buildExercises({ practices }, { words, phrases, rng: seededRng(seed) })
}

describe('buildExercises', () => {
  it('maps every practice type to a renderable kind', () => {
    for (const type of Object.keys(PRACTICE_KIND)) {
      const ex = build([practice(type)])
      expect(ex.length).toBeGreaterThan(0)
      expect(ex.every((e) => e.kind === PRACTICE_KIND[type])).toBe(true)
    }
  })

  it('gives every exercise a unique id, targets, dimension and level', () => {
    const ex = build([practice('spell-word'), practice('translate-phrase')])
    expect(new Set(ex.map((e) => e.id)).size).toBe(ex.length)
    for (const e of ex) {
      expect(e.targets.length).toBeGreaterThan(0)
      expect(e.dimension).toBeTruthy()
      expect(['learning', 'mastery']).toContain(e.level)
      expect(typeof e.practiceIndex).toBe('number')
    }
  })

  it('builds a single matching board of up to MATCH_PAIRS pairs', () => {
    const ex = build([practice('match-vocab')])
    expect(ex).toHaveLength(1)
    expect(ex[0].kind).toBe('match')
    expect(ex[0].pairs.length).toBeLessThanOrEqual(MATCH_PAIRS)
    expect(ex[0].pairs.length).toBe(ex[0].targets.length)
    expect(ex[0].pairs[0]).toHaveProperty('ru')
    expect(ex[0].pairs[0]).toHaveProperty('en')
  })

  it('flags hearing practices as audio (heard, not seen)', () => {
    expect(build([practice('listen-match')])[0].audio).toBe(true)
    expect(build([practice('dictation')])[0].audio).toBe(true)
    expect(build([practice('spell-word')])[0].audio).toBe(false)
  })

  it('produces up to `exercises` items for word/phrase practices', () => {
    const ex = build([practice('spell-word', { exercises: 4 })])
    expect(ex.length).toBeLessThanOrEqual(4)
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.every((e) => e.kind === 'type' && e.ru && e.en)).toBe(true)
  })

  it('only builds inflection exercises for words that have a paradigm', () => {
    const ex = build([practice('inflect-bank', { exercises: 5 })])
    expect(ex.length).toBeGreaterThan(0)
    for (const e of ex) {
      expect(e.kind).toBe('inflect')
      expect(e.mode).toBe('bank')
      expect(e.wordKey).toBeTruthy()
    }
    expect(build([practice('inflect-keyboard')])[0].mode).toBe('keyboard')
  })

  it('preserves the practice index across a multi-practice session', () => {
    const ex = build([practice('spell-word'), practice('match-vocab'), practice('repeat-word')])
    expect(new Set(ex.map((e) => e.practiceIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('prefers pool words when a pool is supplied', () => {
    const poolKey = words[0].key
    const ex = build([practice('spell-word', { exercises: 1, pool: [poolKey] })])
    expect(ex[0].targets).toContain(poolKey)
  })

  describe('spelling encounter prerequisite', () => {
    it('skips words with too few identification encounters for spell-word', () => {
      // Make exactly MIN_WORDS_FOR_SPELLING words eligible so the pool-size gate
      // is satisfied, but all other words are locked out.
      const eligibleKeys = new Set(words.slice(0, MIN_WORDS_FOR_SPELLING).map((w) => w.key))
      const encounterCount = (key) => (eligibleKeys.has(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
      for (const e of ex) expect(eligibleKeys.has(e.targets[0])).toBe(true)
    })

    it('produces no spelling exercises when no word has enough encounters', () => {
      const encounterCount = () => 0
      const ex = buildExercises(
        { practices: [practice('spell-word'), practice('spell-phrase'), practice('dictation')] },
        { words, phrases, rng: seededRng(2), encounterCount },
      )
      expect(ex).toHaveLength(0)
    })

    it('does not filter non-spelling exercises by encounter count', () => {
      const encounterCount = () => 0
      const ex = buildExercises(
        { practices: [practice('match-vocab'), practice('translate-phrase')] },
        { words, phrases, rng: seededRng(3), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
    })

    it('applies no encounter filter when encounterCount is not supplied', () => {
      const ex = build([practice('spell-word')])
      expect(ex.length).toBeGreaterThan(0)
    })

    it('skips spell-word when fewer than MIN_WORDS_FOR_SPELLING words qualify', () => {
      // Only MIN_WORDS_FOR_SPELLING - 1 words are eligible → spelling is skipped.
      const eligibleKeys = new Set(words.slice(0, MIN_WORDS_FOR_SPELLING - 1).map((w) => w.key))
      const encounterCount = (key) => (eligibleKeys.has(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex).toHaveLength(0)
    })

    it('allows spelling once MIN_WORDS_FOR_SPELLING words qualify', () => {
      const eligibleKeys = words.slice(0, MIN_WORDS_FOR_SPELLING).map((w) => w.key)
      const encounterCount = (key) => (eligibleKeys.includes(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
    })
  })
})

describe('CEFR-aware top-up', () => {
  const cefrByKey = new Map(words.map((w) => [w.key, w.cefr]))

  it('fills a thin pool with the lowest level only — no advanced words for a beginner', () => {
    // Empty pool → the whole vocabulary is the top-up source. A brand-new
    // learner (empty at-risk / untested buckets) must never be shown B1/B2/C1
    // words while A1 words remain to draw from.
    const ex = build([practice('match-vocab')])
    expect(ex).toHaveLength(1)
    const levels = ex[0].targets.map((k) => cefrByKey.get(k))
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.every((l) => l === 'A1')).toBe(true)
  })

  it('only spills into the next level once the lower level is exhausted', () => {
    const synth = (i, cefr) => ({ key: `w${i}=${i}`, ru: `w${i}`, english: `${i}`, pos: 'noun', cefr })
    const synthWords = [
      ...Array.from({ length: 3 }, (_, i) => synth(i, 'A1')),
      ...Array.from({ length: 20 }, (_, i) => synth(100 + i, 'B1')),
      ...Array.from({ length: 20 }, (_, i) => synth(200 + i, 'B2')),
    ]
    const cefrOf = new Map(synthWords.map((w) => [w.key, w.cefr]))

    const ex = buildExercises(
      { practices: [practice('match-vocab')] },
      { words: synthWords, phrases: [], rng: seededRng(1) },
    )
    const levels = ex[0].targets.map((k) => cefrOf.get(k))
    // All three A1 words are used, the rest come from B1, and B2 is never
    // touched while B1 can still fill the gap (one level up only, when exhausted).
    expect(levels.filter((l) => l === 'A1')).toHaveLength(3)
    expect(levels).toContain('B1')
    expect(levels).not.toContain('B2')
  })
})
