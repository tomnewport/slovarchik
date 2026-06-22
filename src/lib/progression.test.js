import { describe, it, expect } from 'vitest'
import {
  DIMENSIONS,
  STATES,
  LEVELS,
  CRITERIA,
  dimensionsForLevel,
  applicableDimensions,
  criterionMet,
  minCorrectToMeet,
  minExercisesToLevel,
  dimensionProgress,
  levelMet,
  wordHasInflections,
  wordHasContextDrill,
  wordSkipsSpeaking,
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
  it('defines the learning dimensions plus the context mastery dimension', () => {
    expect(DIMENSIONS).toEqual(['identification', 'usage', 'hearing', 'speaking', 'context'])
    expect(STATES).toEqual(['unknown', 'learning', 'learned', 'mastered'])
    expect(LEVELS).toEqual(['learning', 'mastery'])
  })
  it('learning grades all four dimensions; mastery grades identification, usage and context', () => {
    expect(dimensionsForLevel('learning')).toEqual([
      'identification',
      'usage',
      'hearing',
      'speaking',
    ])
    expect(dimensionsForLevel('mastery')).toEqual(['identification', 'usage', 'context'])
    expect(CRITERIA.mastery.speaking).toBeUndefined()
    expect(CRITERIA.mastery.hearing).toBeUndefined()
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

describe('minCorrectToMeet', () => {
  it('ratio: a fresh dimension needs `need` correct answers', () => {
    expect(minCorrectToMeet([], CRITERIA.learning.identification)).toBe(3)
  })
  it('ratio: counts only the correct answers still missing from the window', () => {
    const crit = CRITERIA.learning.usage
    // One correct already in the window → two more correct answers finish it.
    expect(minCorrectToMeet(attempts('learning', 'usage', [true]), crit)).toBe(2)
    // Two correct + a wrong fill the window at 2/3; one more correct slides the
    // wrong one out of the last-4 window and meets 3/4.
    expect(minCorrectToMeet(attempts('learning', 'usage', [true, true, false]), crit)).toBe(1)
  })
  it('ratio: zero when already met', () => {
    const crit = CRITERIA.learning.hearing
    expect(minCorrectToMeet(attempts('learning', 'hearing', [true, true, true]), crit)).toBe(0)
  })
  it('attempts: just the shortfall of total tries', () => {
    const crit = CRITERIA.learning.speaking
    expect(minCorrectToMeet([], crit)).toBe(3)
    expect(minCorrectToMeet(attempts('learning', 'speaking', [false, false]), crit)).toBe(1)
    expect(minCorrectToMeet(attempts('learning', 'speaking', [true, true, true, true]), crit)).toBe(0)
  })
  it('treats a missing criterion as already satisfied', () => {
    expect(minCorrectToMeet([], null)).toBe(0)
  })
})

describe('minExercisesToLevel', () => {
  it('a fresh word needs every learning dimension filled (3+3+3+3)', () => {
    expect(minExercisesToLevel([], 'learning')).toBe(12)
  })
  it('shrinks as dimensions are met, reaching zero once learned', () => {
    expect(minExercisesToLevel(fullyLearned(), 'learning')).toBe(0)
  })
  it('mastery counts identification + usage + context for a word with a drill', () => {
    expect(minExercisesToLevel([], 'mastery', { hasContextDrill: true })).toBe(3)
  })
  it('mastery drops the context exercise for words without a drill', () => {
    expect(minExercisesToLevel([], 'mastery', { hasContextDrill: false })).toBe(2)
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
    ]
    expect(wordState(events, { hasInflections: true })).toBe('mastered')
  })
  it('stays learned if a mastery dimension is incomplete', () => {
    const events = [
      ...fullyLearned(),
      // identification met but usage missing
      ...attempts('mastery', 'identification', [true]),
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
    expect(Object.keys(p.learning.dimensions)).toEqual(dimensionsForLevel('learning'))
  })
})

describe('context mastery requirement', () => {
  const noun = { pos: 'noun', hasInflections: true }
  it('applies the context dimension to inflecting noun/verb/adjective words', () => {
    expect(wordHasContextDrill(noun)).toBe(true)
    expect(wordHasContextDrill({ pos: 'pronoun', hasInflections: true })).toBe(false)
    expect(applicableDimensions('mastery', noun)).toEqual(['identification', 'usage', 'context'])
    expect(applicableDimensions('mastery', { pos: 'pronoun', hasInflections: true })).toEqual([
      'identification',
      'usage',
    ])
  })
  it('honours an explicit hasContextDrill flag (stamped by the vocab store)', () => {
    expect(wordHasContextDrill({ pos: 'noun', hasInflections: true, hasContextDrill: false })).toBe(false)
  })
  it('a context-drill word stays learned until the phrase drill is passed', () => {
    const events = [
      ...fullyLearned(),
      ...attempts('mastery', 'identification', [true]),
      ...attempts('mastery', 'usage', [true]),
    ]
    expect(wordState(events, noun)).toBe('learned')
    const withContext = [...events, ...attempts('mastery', 'context', [true])]
    expect(wordState(withContext, noun)).toBe('mastered')
  })
  it('a word without a context drill masters on identification + usage alone', () => {
    const events = [
      ...fullyLearned(),
      ...attempts('mastery', 'identification', [true]),
      ...attempts('mastery', 'usage', [true]),
    ]
    expect(wordState(events, { pos: 'pronoun', hasInflections: true })).toBe('mastered')
  })
})

describe('speaking waiver (skip_speaking)', () => {
  // The three non-speaking learning dimensions met, with no speaking attempts.
  const noSpeaking = [
    ...attempts('learning', 'identification', [false, true, true, true]),
    ...attempts('learning', 'usage', [false, true, true, true]),
    ...attempts('learning', 'hearing', [false, true, true, true]),
  ]

  it('reads the skipSpeaking flag off a word', () => {
    expect(wordSkipsSpeaking({ skipSpeaking: true })).toBe(true)
    expect(wordSkipsSpeaking({ skipSpeaking: false })).toBe(false)
    expect(wordSkipsSpeaking({})).toBe(false)
    expect(wordSkipsSpeaking(null)).toBe(false)
  })

  it('drops speaking from the learning dimensions for a waived word', () => {
    expect(applicableDimensions('learning', {})).toEqual([
      'identification',
      'usage',
      'hearing',
      'speaking',
    ])
    expect(applicableDimensions('learning', { skipSpeaking: true })).toEqual([
      'identification',
      'usage',
      'hearing',
    ])
  })

  it('lets a word learn without any speaking attempt once waived', () => {
    // Without the waiver the missing speaking dimension keeps it in 'learning'.
    expect(wordState(noSpeaking, { hasInflections: true })).toBe('learning')
    expect(levelMet(noSpeaking, 'learning', { hasInflections: true })).toBe(false)
    // With the waiver the three remaining dimensions are enough to learn it.
    expect(levelMet(noSpeaking, 'learning', { hasInflections: true, skipSpeaking: true })).toBe(true)
    expect(wordState(noSpeaking, { hasInflections: true, skipSpeaking: true })).toBe('learned')
  })

  it('omits speaking from a waived word’s learning progress breakdown', () => {
    const p = wordProgress(noSpeaking, { hasInflections: true, skipSpeaking: true })
    expect(Object.keys(p.learning.dimensions)).toEqual(['identification', 'usage', 'hearing'])
    expect(p.learning.met).toBe(true)
  })
})

describe('lastAttemptAt', () => {
  it('returns the latest timestamp, or null when there are none', () => {
    expect(lastAttemptAt([])).toBe(null)
    expect(lastAttemptAt([{ ts: 5 }, { ts: 9 }, { ts: 2 }])).toBe(9)
  })
})
