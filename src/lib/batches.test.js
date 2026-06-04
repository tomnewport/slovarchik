import { describe, it, expect } from 'vitest'
import {
  CEFR_ORDER,
  LEARNING_BATCH_SIZE,
  MASTERY_BATCH_SIZE,
  MASTERY_UNLOCK_AT,
  BATCH_OPTIONS,
  BATCH_COLORS,
  cefrRank,
  isEligible,
  batchSize,
  refineToLowest,
  assembleOptions,
  buildBatchOptions,
} from './batches.js'

// Deterministic pseudo-rng so option assembly is stable.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

// Make `n` words at one CEFR level all sharing one collection.
function words(prefix, n, cefr, collections) {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    cefr,
    collections,
  }))
}

describe('helpers', () => {
  it('orders CEFR levels easiest first', () => {
    expect(CEFR_ORDER).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
    expect(cefrRank('A1')).toBeLessThan(cefrRank('B1'))
    expect(cefrRank('C1')).toBeLessThan(cefrRank('Z9')) // unknown sorts last
  })
  it('maps level to batch size', () => {
    expect(batchSize('learning')).toBe(LEARNING_BATCH_SIZE)
    expect(batchSize('mastery')).toBe(MASTERY_BATCH_SIZE)
  })
  it('eligibility differs by level', () => {
    expect(isEligible('unknown', 'learning')).toBe(true)
    expect(isEligible('learning', 'learning')).toBe(true)
    expect(isEligible('learned', 'learning')).toBe(false)
    expect(isEligible('learned', 'mastery')).toBe(true)
    expect(isEligible('mastered', 'mastery')).toBe(false)
  })
})

describe('refineToLowest', () => {
  it('keeps only the lowest CEFR level when it has enough words', () => {
    const pool = refineToLowest(
      [...words('a', 25, 'A1', ['x']), ...words('b', 25, 'B1', ['x'])],
      20,
      seededRng(1),
    )
    expect(pool.length).toBe(25)
    expect(pool.every((w) => w.cefr === 'A1')).toBe(true)
  })
  it('tops up from the next level when the lowest is too thin', () => {
    const pool = refineToLowest(
      [...words('a', 5, 'A1', ['x']), ...words('b', 30, 'A2', ['x'])],
      20,
      seededRng(2),
    )
    // All 5 of A1 plus 15 sampled from A2 to reach the batch size of 20.
    expect(pool.length).toBe(20)
    expect(pool.filter((w) => w.cefr === 'A1').length).toBe(5)
    expect(pool.filter((w) => w.cefr === 'A2').length).toBe(15)
  })
})

describe('assembleOptions — naming rule', () => {
  it('names a batch after a collection that supplies at least 75%', () => {
    // 18 animals (>=15 needed) + plenty of others to borrow from.
    const pool = [...words('an', 18, 'A1', ['animals']), ...words('ot', 20, 'A1', ['food and drink'])]
    const options = assembleOptions(pool, 20, 'learning', seededRng(3))
    const animals = options.find((o) => o.name === 'animals')
    expect(animals).toBeTruthy()
    expect(animals.size).toBe(20)
    expect(animals.collection).toBe('animals')
    expect(animals.color).toBe(BATCH_COLORS.learning)
    // At most 25% (5 of 20) borrowed from other collections.
    const borrowed = animals.words.filter((k) => k.startsWith('ot')).length
    expect(borrowed).toBeLessThanOrEqual(5)
  })
  it('falls back to "Random" when no collection can reach 75%', () => {
    // Many small collections, none with 15 words.
    const pool = [
      ...words('a', 6, 'A1', ['animals']),
      ...words('b', 6, 'A1', ['food and drink']),
      ...words('c', 6, 'A1', ['travel']),
      ...words('d', 6, 'A1', ['work']),
    ]
    const options = assembleOptions(pool, 20, 'learning', seededRng(4))
    expect(options.length).toBeGreaterThan(0)
    expect(options.every((o) => o.name === 'Random' && o.collection === null)).toBe(true)
  })
  it('prioritises named batches before random ones', () => {
    const pool = [
      ...words('an', 20, 'A1', ['animals']),
      ...words('te', 20, 'A1', ['technology']),
      ...words('fo', 20, 'A1', ['food and drink']),
    ]
    const options = assembleOptions(pool, 20, 'learning', seededRng(5))
    const named = options.filter((o) => o.collection !== null)
    expect(named.length).toBe(Math.min(BATCH_OPTIONS, 3))
    // Any random batches only appear after the named ones.
    const firstRandom = options.findIndex((o) => o.collection === null)
    if (firstRandom !== -1) {
      expect(options.slice(0, firstRandom).every((o) => o.collection !== null)).toBe(true)
    }
  })
  it('offers at most five options', () => {
    const pool = Array.from({ length: 8 }, (_, i) => words(`c${i}`, 20, 'A1', [`coll${i}`])).flat()
    const options = assembleOptions(pool, 20, 'learning', seededRng(6))
    expect(options.length).toBe(BATCH_OPTIONS)
  })
})

describe('buildBatchOptions', () => {
  const stateOf = (states) => (w) => states[w.key] ?? 'unknown'

  it('builds learning options from unlearned words', () => {
    const all = [...words('an', 20, 'A1', ['animals']), ...words('te', 20, 'A2', ['technology'])]
    const options = buildBatchOptions({ words: all, stateOf: stateOf({}), level: 'learning', rng: seededRng(7) })
    expect(options.length).toBeGreaterThan(0)
    // Lowest CEFR only: every chosen word should be an A1 (an*) word.
    expect(options[0].words.every((k) => k.startsWith('an'))).toBe(true)
    expect(options[0].level).toBe('learning')
  })

  it('returns no mastery options until 100 words are learned', () => {
    const all = words('an', 20, 'A1', ['animals'])
    const learned = Object.fromEntries(all.map((w) => [w.key, 'learned']))
    expect(
      buildBatchOptions({ words: all, stateOf: stateOf(learned), level: 'mastery', learnedCount: 99, rng: seededRng(8) }),
    ).toEqual([])
  })

  it('unlocks mastery options at exactly 100 learned words', () => {
    const all = words('an', 20, 'A1', ['animals'])
    const learned = Object.fromEntries(all.map((w) => [w.key, 'learned']))
    const options = buildBatchOptions({
      words: all,
      stateOf: stateOf(learned),
      level: 'mastery',
      learnedCount: MASTERY_UNLOCK_AT,
      rng: seededRng(9),
    })
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].level).toBe('mastery')
    expect(options[0].color).toBe(BATCH_COLORS.mastery)
    expect(options[0].size).toBe(MASTERY_BATCH_SIZE)
  })

  it('returns nothing when there are no eligible words', () => {
    const all = words('an', 5, 'A1', ['animals'])
    const mastered = Object.fromEntries(all.map((w) => [w.key, 'mastered']))
    expect(
      buildBatchOptions({ words: all, stateOf: stateOf(mastered), level: 'learning', rng: seededRng(10) }),
    ).toEqual([])
  })
})
