import { describe, it, expect } from 'vitest'

import {
  DAY_MS,
  FIRST_STABILITY_MS,
  MIN_STABILITY_MS,
  DEFAULT_STABILITY_MS,
  GROWTH_UNHINTED,
  GROWTH_HINTED,
  FAIL_FACTOR,
  CONFIRM_GAP_MS,
  reviewSchedule,
  isDue,
  overdueness,
  wordOverdueness,
  confirmationOutcome,
} from './schedule.js'

describe('reviewSchedule', () => {
  it('grants the first stability on a first correct answer', () => {
    const sch = reviewSchedule(null, { correct: true, ts: 1000 })
    expect(sch).toEqual({
      stability: FIRST_STABILITY_MS,
      due: 1000 + FIRST_STABILITY_MS,
      lastReview: 1000,
    })
  })

  it('starts at the floor and is due immediately after a first wrong answer', () => {
    const sch = reviewSchedule(null, { correct: false, ts: 1000 })
    expect(sch.stability).toBe(MIN_STABILITY_MS)
    expect(sch.due).toBe(1000)
    expect(isDue(sch, 1000)).toBe(true)
  })

  it('a fully-spaced unhinted success grows stability by the full factor', () => {
    const prev = { stability: DAY_MS, due: DAY_MS, lastReview: 0 }
    const sch = reviewSchedule(prev, { correct: true, hinted: false, ts: DAY_MS })
    expect(sch.stability).toBeCloseTo(DAY_MS * GROWTH_UNHINTED)
    expect(sch.due).toBe(DAY_MS + sch.stability)
  })

  it('a hinted success grows stability less than an unhinted one', () => {
    const prev = { stability: DAY_MS, due: DAY_MS, lastReview: 0 }
    const hinted = reviewSchedule(prev, { correct: true, hinted: true, ts: DAY_MS })
    const unhinted = reviewSchedule(prev, { correct: true, hinted: false, ts: DAY_MS })
    expect(hinted.stability).toBeCloseTo(DAY_MS * GROWTH_HINTED)
    expect(hinted.stability).toBeLessThan(unhinted.stability)
  })

  it('a massed same-session repeat barely grows stability', () => {
    const prev = { stability: DAY_MS, due: DAY_MS, lastReview: 0 }
    const sch = reviewSchedule(prev, { correct: true, hinted: false, ts: 60_000 }) // a minute later
    expect(sch.stability).toBeLessThan(DAY_MS * 1.01)
    // But the due date still moves out from the new review time.
    expect(sch.due).toBe(60_000 + sch.stability)
  })

  it('caps growth at the full factor for very late reviews', () => {
    const prev = { stability: DAY_MS, due: DAY_MS, lastReview: 0 }
    const sch = reviewSchedule(prev, { correct: true, hinted: false, ts: 30 * DAY_MS })
    expect(sch.stability).toBeCloseTo(DAY_MS * GROWTH_UNHINTED)
  })

  it('a failure halves stability and makes the dimension due now', () => {
    const prev = { stability: 4 * DAY_MS, due: 4 * DAY_MS, lastReview: 0 }
    const sch = reviewSchedule(prev, { correct: false, ts: DAY_MS })
    expect(sch.stability).toBe(4 * DAY_MS * FAIL_FACTOR)
    expect(sch.due).toBe(DAY_MS)
    expect(isDue(sch, DAY_MS)).toBe(true)
  })

  it('failures never push stability below the floor', () => {
    let sch = { stability: MIN_STABILITY_MS, due: 0, lastReview: 0 }
    sch = reviewSchedule(sch, { correct: false, ts: 1 })
    expect(sch.stability).toBe(MIN_STABILITY_MS)
  })
})

describe('due-ness and ordering', () => {
  it('isDue treats a missing schedule as due', () => {
    expect(isDue(null)).toBe(true)
    expect(isDue(undefined)).toBe(true)
  })

  it('overdueness is 1 exactly at the due date and grows past it', () => {
    const sch = { stability: DAY_MS, due: 2 * DAY_MS, lastReview: DAY_MS }
    expect(overdueness(sch, 2 * DAY_MS)).toBe(1)
    expect(overdueness(sch, 3 * DAY_MS)).toBe(2)
    expect(overdueness(sch, 1.5 * DAY_MS)).toBe(0.5)
  })

  it('wordOverdueness takes the most overdue dimension', () => {
    const schedule = {
      usage: { stability: DAY_MS, due: 2 * DAY_MS, lastReview: DAY_MS }, // overdueness 2 at 3d
      hearing: { stability: 4 * DAY_MS, due: 5 * DAY_MS, lastReview: DAY_MS }, // 0.5 at 3d
    }
    expect(wordOverdueness(schedule, null, 3 * DAY_MS)).toBe(2)
  })

  it('wordOverdueness falls back to last-attempt recency for legacy records', () => {
    const now = 6 * DAY_MS
    expect(wordOverdueness(null, now - 3 * DAY_MS, now)).toBeCloseTo(
      (3 * DAY_MS) / DEFAULT_STABILITY_MS,
    )
    expect(wordOverdueness({}, now - 6 * DAY_MS, now)).toBeGreaterThan(
      wordOverdueness({}, now - DAY_MS, now),
    )
  })
})

describe('confirmationOutcome', () => {
  const learned = { learnedAt: 0, confirmedAt: null }

  it('is not a confirmation review before the gap has passed', () => {
    expect(confirmationOutcome(learned, { correct: true, ts: CONFIRM_GAP_MS - 1 })).toBeNull()
  })

  it('confirms on a correct answer once the gap has passed', () => {
    expect(confirmationOutcome(learned, { correct: true, ts: CONFIRM_GAP_MS })).toBe('confirmed')
  })

  it('fails on a wrong answer once the gap has passed', () => {
    expect(confirmationOutcome(learned, { correct: false, ts: CONFIRM_GAP_MS })).toBe('failed')
  })

  it('never re-judges an already-confirmed or never-learned word', () => {
    expect(
      confirmationOutcome({ learnedAt: 0, confirmedAt: 10 }, { correct: false, ts: 9 * DAY_MS }),
    ).toBeNull()
    expect(
      confirmationOutcome({ learnedAt: null, confirmedAt: null }, { correct: true, ts: 9 * DAY_MS }),
    ).toBeNull()
  })
})
