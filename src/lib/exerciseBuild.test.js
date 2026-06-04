import { describe, it, expect } from 'vitest'
import { buildExercises, PRACTICE_KIND, MATCH_PAIRS } from './exerciseBuild.js'
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
})
