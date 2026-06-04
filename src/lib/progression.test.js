import { describe, it, expect } from 'vitest'
import {
  DIMENSIONS,
  STATES,
  LEVELS,
  CRITERIA,
  dimensionsForLevel,
  criterionMet,
  dimensionProgress,
  levelMet,
  wordHasInflections,
  wordState,
  wordProgress,
  lastAttemptAt,
} from './progression.js'

// Build a chronological list of attempts for one (level, dimension).
function attempts(level, dimension, results, startTs = 0) {
  return results.map((correct, i) => ({ level, dimension, correct, ts: startTs + i }))
}

// All four learning criteria met (3/4 spelled etc, 3 speaking attempts).
function fullyLearned() {
  return [
    ...attempts('learning', 'identification', [false, true, true, true]),
    ...attempts('learning', 'usage', [false, true, true, true]),
    ...attempts('learning', 'hearing', [false, true, true, true]),
    ...attempts('learning', 'speaking', [true, true, true]),
  ]
}

describe('constants', () => {
  it('defines the four dimensions and four states', () => {
    expect(DIMENSIONS).toEqual(['identification', 'usage', 'hearing', 'speaking'])
    expect(STATES).toEqual(['unknown', 'learning', 'learned', 'mastered'])
    expect(LEVELS).toEqual(['learning', 'mastery'])
  })
  it('learning grades all four dimensions; mastery has no speaking', () => {
    expect(dimensionsForLevel('learning')).toEqual([
      'identification',
      'usage',
      'hearing',
      'speaking',
    ])
    expect(dimensionsForLevel('mastery')).toEqual(['identification', 'usage', 'hearing'])
    expect(CRITERIA.mastery.speaking).toBeUndefined()
  })
})

describe('criterionMet', () => {
  it('ratio: needs 3 of the last 4 correct', () => {
    const crit = CRITERIA.learning.identification
    expect(criterionMet(attempts('learning', 'identification', [true, true, true]), crit)).toBe(true)
    expect(criterionMet(attempts('learning', 'identification', [true, true]), crit)).toBe(false)
    expect(
      criterionMet(attempts('learning', 'identification', [true, true, false, true]), crit),
    ).toBe(true)
  })
  it('ratio: only the most recent window counts, so a word can slip', () => {
    const crit = CRITERIA.learning.usage
    // Early success, then a run of failures inside the window.
    const list = attempts('learning', 'usage', [true, true, true, false, false])
    expect(criterionMet(list, crit)).toBe(false)
  })
  it('attempts: speaking only needs three tries regardless of correctness', () => {
    const crit = CRITERIA.learning.speaking
    expect(criterionMet(attempts('learning', 'speaking', [false, false, false]), crit)).toBe(true)
    expect(criterionMet(attempts('learning', 'speaking', [true, true]), crit)).toBe(false)
  })
})

describe('dimensionProgress', () => {
  it('reports attempt and correct counts plus whether the criterion is met', () => {
    const p = dimensionProgress(
      attempts('learning', 'hearing', [false, true, true, true]),
      'learning',
      'hearing',
    )
    expect(p).toMatchObject({ level: 'learning', dimension: 'hearing', attempts: 4, correct: 3, met: true })
  })
})

describe('wordHasInflections', () => {
  it('honours an explicit boolean', () => {
    expect(wordHasInflections({ hasInflections: true })).toBe(true)
    expect(wordHasInflections({ hasInflections: false })).toBe(false)
  })
  it('derives a noun paradigm from its forms', () => {
    const noun = {
      key: 'дом=house',
      pos: 'noun',
      numbers: ['sg', 'pl'],
      forms: {
        sg: { nom: 'дом', gen: 'дома', dat: 'дому', acc: 'дом', ins: 'домом', pre: 'доме' },
        pl: { nom: 'дома', gen: 'домов' },
      },
    }
    expect(wordHasInflections(noun)).toBe(true)
  })
  it('returns false for an uninflected word', () => {
    expect(wordHasInflections({ key: 'и=and', pos: 'conjunction' })).toBe(false)
    expect(wordHasInflections(null)).toBe(false)
  })
})

describe('wordState — learning transitions', () => {
  it('is unknown with no attempts', () => {
    expect(wordState([])).toBe('unknown')
  })
  it('is learning after any attempt but before the criteria are met', () => {
    expect(wordState(attempts('learning', 'usage', [true]))).toBe('learning')
  })
  it('requires all four dimensions to become learned', () => {
    const missingSpeaking = [
      ...attempts('learning', 'identification', [true, true, true]),
      ...attempts('learning', 'usage', [true, true, true]),
      ...attempts('learning', 'hearing', [true, true, true]),
    ]
    expect(wordState(missingSpeaking, { hasInflections: true })).toBe('learning')
  })
  it('becomes learned once every learning dimension is met (inflected word)', () => {
    expect(wordState(fullyLearned(), { hasInflections: true })).toBe('learned')
  })
})

describe('wordState — mastery gating', () => {
  it('a word without inflections is mastered as soon as it is learned', () => {
    expect(wordState(fullyLearned(), { hasInflections: false })).toBe('mastered')
  })
  it('an inflected word needs the mastery criteria too', () => {
    const events = [
      ...fullyLearned(),
      ...attempts('mastery', 'identification', [true]),
      ...attempts('mastery', 'usage', [true]),
      ...attempts('mastery', 'hearing', [true, true, true]),
    ]
    expect(wordState(events, { hasInflections: true })).toBe('mastered')
  })
  it('stays learned if a mastery dimension is incomplete', () => {
    const events = [
      ...fullyLearned(),
      ...attempts('mastery', 'identification', [true]),
      ...attempts('mastery', 'usage', [true]),
      // hearing mastery only 2/4 — not enough
      ...attempts('mastery', 'hearing', [true, true]),
    ]
    expect(wordState(events, { hasInflections: true })).toBe('learned')
  })
  it('drops back below mastered when a learning dimension slips', () => {
    const events = [
      ...attempts('learning', 'identification', [true, true, true, false, false]),
      ...attempts('learning', 'usage', [true, true, true]),
      ...attempts('learning', 'hearing', [true, true, true]),
      ...attempts('learning', 'speaking', [true, true, true]),
      ...attempts('mastery', 'identification', [true]),
      ...attempts('mastery', 'usage', [true]),
      ...attempts('mastery', 'hearing', [true, true, true]),
    ]
    // Learning identification has slipped, so the word is no longer even learned.
    expect(levelMet(events, 'mastery')).toBe(true)
    expect(wordState(events, { hasInflections: true })).toBe('learning')
  })
})

describe('wordProgress', () => {
  it('summarises both levels and marks mastery inapplicable for plain words', () => {
    const p = wordProgress(fullyLearned(), { hasInflections: false })
    expect(p.state).toBe('mastered')
    expect(p.learning.met).toBe(true)
    expect(p.mastery.applicable).toBe(false)
    expect(p.mastery.met).toBe(true) // collapses onto the learning criteria
    expect(Object.keys(p.learning.dimensions)).toEqual(DIMENSIONS)
  })
})

describe('lastAttemptAt', () => {
  it('returns the latest timestamp, or null when there are none', () => {
    expect(lastAttemptAt([])).toBe(null)
    expect(lastAttemptAt([{ ts: 5 }, { ts: 9 }, { ts: 2 }])).toBe(9)
  })
})
