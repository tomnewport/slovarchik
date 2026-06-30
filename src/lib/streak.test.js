import { describe, it, expect } from 'vitest'

import {
  dayKey,
  shiftDay,
  weekday,
  buildActivityFromEvents,
  activeDays,
  currentStreak,
  longestStreak,
  maxDailyCount,
  totalExercises,
  randomHue,
  hueForDay,
  hsvToHex,
  dayColor,
  buildCalendar,
} from './streak.js'

// A fixed local noon timestamp for a given Y-M-D, so day keys are stable
// regardless of the runner's timezone.
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime()

describe('dayKey / shiftDay / weekday', () => {
  it('formats a local day key', () => {
    expect(dayKey(at(2026, 1, 5))).toBe('2026-01-05')
  })

  it('shifts across month and year boundaries', () => {
    expect(shiftDay('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-03-10', -10)).toBe('2026-02-28')
  })

  it('reports weekday (0 = Sunday)', () => {
    // 2026-01-04 is a Sunday.
    expect(weekday('2026-01-04')).toBe(0)
    expect(weekday('2026-01-05')).toBe(1)
  })
})

describe('buildActivityFromEvents', () => {
  it('aggregates count and correct per day, skipping events without ts', () => {
    const records = {
      дом: {
        events: [
          { ts: at(2026, 1, 5), correct: true },
          { ts: at(2026, 1, 5), correct: false },
          { ts: at(2026, 1, 6), correct: true },
          { correct: true }, // no ts → ignored
        ],
      },
      кот: {
        events: [{ ts: at(2026, 1, 5), correct: true }],
      },
    }
    const activity = buildActivityFromEvents(records)
    expect(activity['2026-01-05']).toEqual({ count: 3, correct: 2 })
    expect(activity['2026-01-06']).toEqual({ count: 1, correct: 1 })
  })

  it('handles empty input', () => {
    expect(buildActivityFromEvents()).toEqual({})
    expect(buildActivityFromEvents({})).toEqual({})
  })
})

describe('activeDays', () => {
  it('includes only days with a positive count', () => {
    const set = activeDays({ a: { count: 2 }, b: { count: 0 }, c: { count: 1 } })
    expect([...set].sort()).toEqual(['a', 'c'])
  })
})

describe('currentStreak', () => {
  const activity = {
    '2026-06-27': { count: 1 },
    '2026-06-28': { count: 3 },
    '2026-06-29': { count: 2 },
  }

  it('counts consecutive days ending today', () => {
    expect(currentStreak(activity, '2026-06-29')).toBe(3)
  })

  it('keeps the streak alive on a grace day (active yesterday, idle today)', () => {
    expect(currentStreak(activity, '2026-06-30')).toBe(3)
  })

  it('is zero once two idle days pass', () => {
    expect(currentStreak(activity, '2026-07-01')).toBe(0)
  })

  it('is zero with no activity', () => {
    expect(currentStreak({}, '2026-06-29')).toBe(0)
  })

  it('stops at a gap', () => {
    const gapped = { '2026-06-25': { count: 1 }, '2026-06-28': { count: 1 }, '2026-06-29': { count: 1 } }
    expect(currentStreak(gapped, '2026-06-29')).toBe(2)
  })
})

describe('longestStreak', () => {
  it('finds the longest consecutive run', () => {
    const activity = {
      '2026-01-01': { count: 1 },
      '2026-01-02': { count: 1 },
      '2026-01-03': { count: 1 },
      '2026-01-10': { count: 1 },
      '2026-01-11': { count: 1 },
    }
    expect(longestStreak(activity)).toBe(3)
  })

  it('is zero with no activity', () => {
    expect(longestStreak({})).toBe(0)
  })
})

describe('maxDailyCount / totalExercises', () => {
  const activity = { a: { count: 2, correct: 1 }, b: { count: 5, correct: 5 }, c: { count: 0 } }
  it('finds the busiest day', () => {
    expect(maxDailyCount(activity)).toBe(5)
  })
  it('sums all exercises', () => {
    expect(totalExercises(activity)).toBe(7)
  })
})

describe('randomHue / hueForDay', () => {
  it('randomHue stays within 0..359', () => {
    expect(randomHue(() => 0)).toBe(0)
    expect(randomHue(() => 0.999)).toBe(359)
  })
  it('hueForDay is deterministic and in range', () => {
    const h = hueForDay('2026-06-29')
    expect(h).toBe(hueForDay('2026-06-29'))
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
  })
})

describe('hsvToHex', () => {
  it('maps primary colours', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000')
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00')
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff')
  })
  it('zero saturation is greyscale', () => {
    expect(hsvToHex(200, 0, 1)).toBe('#ffffff')
    expect(hsvToHex(200, 0, 0)).toBe('#000000')
  })
})

describe('dayColor', () => {
  it('returns null for an empty day', () => {
    expect(dayColor({ count: 0 }, 10)).toBeNull()
    expect(dayColor(undefined, 10)).toBeNull()
  })

  it('produces a hex colour for an active day', () => {
    const c = dayColor({ count: 5, correct: 5, hue: 0 }, 5)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('brighter for more exercises (value scales with count)', () => {
    const lum = (hex) => parseInt(hex.slice(1, 3), 16) // red channel, hue 0
    const few = dayColor({ count: 1, correct: 1, hue: 0 }, 10)
    const many = dayColor({ count: 10, correct: 10, hue: 0 }, 10)
    expect(lum(many)).toBeGreaterThan(lum(few))
  })

  it('falls back to a deterministic hue when none is stored', () => {
    const c = dayColor({ count: 1, correct: 1, day: '2026-06-29' }, 1)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('buildCalendar', () => {
  it('lays out the requested number of weeks, 7 rows each', () => {
    const { weeks } = buildCalendar({}, '2026-06-29', 4)
    expect(weeks).toHaveLength(4)
    for (const col of weeks) expect(col).toHaveLength(7)
  })

  it('ends on the current week and flags future days', () => {
    // 2026-06-29 is a Monday → weekday 1, so the last column has Sunday(28th)
    // and Monday(29th) populated and Tue..Sat in the future.
    const { weeks } = buildCalendar({ '2026-06-29': { count: 2, correct: 2 } }, '2026-06-29', 2)
    const last = weeks[weeks.length - 1]
    expect(last[0].day).toBe('2026-06-28')
    expect(last[1].day).toBe('2026-06-29')
    expect(last[1].count).toBe(2)
    expect(last[2].future).toBe(true)
    expect(last[2].color).toBeNull()
  })

  it('colours active days and leaves empty days null', () => {
    const { weeks } = buildCalendar({ '2026-06-29': { count: 2, correct: 1, hue: 120 } }, '2026-06-29', 2)
    const cells = weeks.flat()
    const active = cells.find((c) => c.day === '2026-06-29')
    expect(active.color).toMatch(/^#[0-9a-f]{6}$/)
    const empty = cells.find((c) => c.day === '2026-06-27')
    expect(empty.color).toBeNull()
  })

  it('emits month labels aligned to week columns', () => {
    const { months } = buildCalendar({}, '2026-06-29', 53)
    expect(months.length).toBeGreaterThan(0)
    for (const m of months) {
      expect(m.index).toBeGreaterThanOrEqual(0)
      expect(m.label).toMatch(/^[A-Z][a-z]{2}$/)
    }
  })
})
