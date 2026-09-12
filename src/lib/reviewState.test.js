import { describe, it, expect } from 'vitest'

import { confirmationState, formatDue, formatInterval, reviewState } from './reviewState.js'
import { CONFIRM_GAP_MS, DAY_MS, reviewSchedule } from './schedule.js'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 12, 12, 0)

describe('formatInterval', () => {
  it('names a duration in the largest unit that still reads as a number', () => {
    expect(formatInterval(20 * 60 * 1000)).toBe('under an hour')
    expect(formatInterval(HOUR)).toBe('1 hour')
    expect(formatInterval(6 * HOUR)).toBe('6 hours')
    expect(formatInterval(3 * DAY_MS)).toBe('3 days')
    expect(formatInterval(21 * DAY_MS)).toBe('3 weeks')
    expect(formatInterval(120 * DAY_MS)).toBe('4 months')
  })

  it('never lands on the value that belongs to the next unit up', () => {
    // 23h40m rounds to 24 hours, which must arrive as a day instead.
    expect(formatInterval(23.7 * HOUR)).toBe('1 day')
    // 13.6 days rounds to 14, which belongs to the week branch.
    expect(formatInterval(13.6 * DAY_MS)).toBe('2 weeks')
  })

  it('treats a negative duration as zero rather than emitting a minus sign', () => {
    expect(formatInterval(-5 * DAY_MS)).toBe('under an hour')
  })
})

describe('formatDue', () => {
  it('reads ahead, on, or past the due time', () => {
    expect(formatDue(NOW + 3 * DAY_MS, NOW)).toBe('in 3 days')
    expect(formatDue(NOW, NOW)).toBe('due now')
    expect(formatDue(NOW - 2 * DAY_MS, NOW)).toBe('2 days overdue')
  })

  it('keeps an hour of grace either side of zero', () => {
    // A review the learner has only just earned must not read as overdue the
    // moment the card is reopened.
    expect(formatDue(NOW - 10 * 60 * 1000, NOW)).toBe('due now')
    expect(formatDue(NOW + 10 * 60 * 1000, NOW)).toBe('due now')
  })
})

describe('confirmationState', () => {
  const learned = (extra = {}) => ({ learnedAt: NOW - 3 * DAY_MS, ...extra })

  it('says nothing for a word that has never been learned', () => {
    expect(confirmationState({ learnedAt: null }, { now: NOW }).status).toBe('none')
  })

  it('says nothing for a word that has slipped back below learned', () => {
    // The slip has its own panel on the card; promising a confirmation review
    // the word cannot earn until its criteria are whole again would mislead.
    const state = confirmationState(learned(), { now: NOW, state: 'learning' })
    expect(state.status).toBe('none')
  })

  it('waits while the word is younger than the confirmation gap', () => {
    const rec = { learnedAt: NOW - HOUR }
    const state = confirmationState(rec, { now: NOW, state: 'learned' })
    expect(state.status).toBe('waiting')
    expect(state.eligibleAt).toBe(NOW - HOUR + CONFIRM_GAP_MS)
  })

  it('reports the review as due once the gap has elapsed', () => {
    expect(confirmationState(learned(), { now: NOW, state: 'learned' }).status).toBe('due')
  })

  it('reports a confirmed word, with the date', () => {
    const state = confirmationState(learned({ confirmedAt: NOW - DAY_MS }), { now: NOW })
    expect(state.status).toBe('confirmed')
    expect(state.at).toBe(NOW - DAY_MS)
  })

  it('reports a failed review, with the date', () => {
    const state = confirmationState(learned({ confirmFailedAt: NOW - DAY_MS }), {
      now: NOW,
      state: 'learned',
    })
    expect(state.status).toBe('failed')
    expect(state.at).toBe(NOW - DAY_MS)
  })

  it('waives the wait for a word the learner flagged known (#321)', () => {
    const state = confirmationState(learned({ known: true }), { now: NOW, state: 'learned' })
    expect(state.status).toBe('waived')
  })

  it('prefers a recorded confirmation over the known flag', () => {
    const rec = learned({ known: true, confirmedAt: NOW - DAY_MS })
    expect(confirmationState(rec, { now: NOW }).status).toBe('confirmed')
  })
})

describe('reviewState', () => {
  it('has nothing to show for an untracked word', () => {
    const state = reviewState(null, { now: NOW })
    expect(state.scheduled).toBe(false)
    expect(state.dimensions).toEqual([])
    expect(state.next).toBe(null)
    expect(state.confirmation.status).toBe('none')
  })

  it('is unscheduled for a record written before the scheduler existed', () => {
    // Migrations normalise such records to an empty schedule, which fills in
    // again on the word's next answer.
    const rec = { learnedAt: NOW - 9 * DAY_MS, confirmedAt: NOW - 9 * DAY_MS, schedule: {} }
    const state = reviewState(rec, { now: NOW, state: 'learned' })
    expect(state.scheduled).toBe(false)
    expect(state.confirmation.status).toBe('confirmed')
  })

  it('builds a row per scheduled dimension, most overdue first', () => {
    const rec = {
      learnedAt: NOW - 5 * DAY_MS,
      confirmedAt: NOW - 4 * DAY_MS,
      schedule: {
        // Reviewed four days ago on a two-day interval: overdue.
        usage: { stability: 2 * DAY_MS, due: NOW - 2 * DAY_MS, lastReview: NOW - 4 * DAY_MS },
        // Reviewed this morning on a three-day interval: resting.
        identification: { stability: 3 * DAY_MS, due: NOW + 3 * DAY_MS, lastReview: NOW },
      },
    }
    const state = reviewState(rec, { now: NOW, state: 'mastered' })
    expect(state.scheduled).toBe(true)
    expect(state.dimensions.map((d) => d.dimension)).toEqual(['usage', 'identification'])
    expect(state.dimensions[0]).toMatchObject({
      dueNow: true,
      interval: '2 days',
      when: '2 days overdue',
    })
    expect(state.dimensions[1]).toMatchObject({
      dueNow: false,
      interval: '3 days',
      when: 'in 3 days',
    })
    expect(state.dueCount).toBe(1)
    // `next` is the soonest review, which is not the first row: rows lead with
    // the most overdue skill, and an overdue review is already in the past.
    expect(state.next.dimension).toBe('usage')
  })

  it('names the soonest review when nothing is overdue', () => {
    const rec = {
      schedule: {
        usage: { stability: 6 * DAY_MS, due: NOW + 6 * DAY_MS, lastReview: NOW },
        hearing: { stability: DAY_MS, due: NOW + DAY_MS, lastReview: NOW },
      },
    }
    expect(reviewState(rec, { now: NOW }).next.dimension).toBe('hearing')
    expect(reviewState(rec, { now: NOW }).dueCount).toBe(0)
  })

  it('reads the real schedule the scheduler writes', () => {
    // Not a hand-built fixture: fold two answers through `reviewSchedule` so the
    // row text is checked against what `recordAttempt` actually stores.
    const first = reviewSchedule(null, { correct: true, ts: NOW - 2 * DAY_MS })
    const second = reviewSchedule(first, { correct: true, hinted: false, ts: NOW })
    const state = reviewState({ schedule: { usage: second } }, { now: NOW })
    // A fully-spaced unhinted answer multiplies the one-day first interval by
    // GROWTH_UNHINTED (2.5), which reads as three days rather than two.
    expect(state.dimensions[0].dueNow).toBe(false)
    expect(state.dimensions[0].interval).toBe('3 days')
    expect(state.dimensions[0].when).toBe('in 3 days')
  })

  it('shows a failed answer as immediately due', () => {
    // A miss halves stability and sets `due` to the moment it was given.
    const missed = reviewSchedule({ stability: 4 * DAY_MS, due: NOW, lastReview: NOW - 4 * DAY_MS }, {
      correct: false,
      ts: NOW,
    })
    const state = reviewState({ schedule: { usage: missed } }, { now: NOW })
    expect(state.dimensions[0].when).toBe('due now')
    expect(state.dueCount).toBe(1)
  })

  it('ignores a malformed schedule entry rather than rendering a blank row', () => {
    const rec = { schedule: { usage: null, hearing: {}, identification: { stability: DAY_MS, due: NOW, lastReview: NOW } } }
    const state = reviewState(rec, { now: NOW })
    expect(state.dimensions.map((d) => d.dimension)).toEqual(['identification'])
  })
})
