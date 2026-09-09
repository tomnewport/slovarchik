import { describe, it, expect } from 'vitest'

import { buildChart, xAxis, yAxis, dayTime } from './progressChart.js'

describe('yAxis', () => {
  it('uses whole-word steps and tops out at or above the max', () => {
    expect(yAxis(3)).toEqual({ step: 1, top: 3, values: [0, 1, 2, 3] })
    expect(yAxis(1)).toEqual({ step: 1, top: 1, values: [0, 1] })
    const y = yAxis(37)
    expect(y.step).toBe(10)
    expect(y.top).toBe(40)
    expect(y.values).toEqual([0, 10, 20, 30, 40])
    expect(yAxis(220).step).toBe(50)
  })

  it('never proposes a fractional step, however few words there are', () => {
    for (const max of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const y = yAxis(max)
      expect(Number.isInteger(y.step)).toBe(true)
      expect(y.step).toBeGreaterThanOrEqual(1)
      expect(y.top).toBeGreaterThanOrEqual(max)
    }
  })
})

describe('xAxis', () => {
  const d = (s) => dayTime(s)

  it('labels days on a short span, anchored so the last day is a tick', () => {
    const ticks = xAxis(d('2026-06-01'), d('2026-06-05'))
    expect(ticks.map((t) => t.label)).toEqual(['1 Jun', '2 Jun', '3 Jun', '4 Jun', '5 Jun'])
  })

  it('thins day ticks out rather than crowding them', () => {
    const ticks = xAxis(d('2026-06-01'), d('2026-07-01'))
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks[ticks.length - 1].label).toBe('1 Jul')
  })

  it('falls back to month boundaries over a long span', () => {
    const ticks = xAxis(d('2026-01-15'), d('2026-12-20'))
    expect(ticks.map((t) => t.label)).toEqual(['Feb', 'Apr', 'Jun', 'Aug', 'Oct', 'Dec'])
  })

  it('adds the year when the span crosses one', () => {
    const ticks = xAxis(d('2025-06-10'), d('2026-09-10'))
    expect(ticks[0].label).toMatch(/’2[56]$/)
  })

  it('degenerates to a single tick when there is one day', () => {
    expect(xAxis(d('2026-06-01'), d('2026-06-01'))).toEqual([{ time: d('2026-06-01'), label: '1 Jun' }])
  })
})

describe('buildChart', () => {
  const points = [
    { day: '2026-06-01', learned: 2, mastered: 0 },
    { day: '2026-06-02', learned: 5, mastered: 1 },
    { day: '2026-06-12', learned: 6, mastered: 3 },
  ]

  it('returns null with no history', () => {
    expect(buildChart([], { today: '2026-06-12' })).toBeNull()
  })

  it('spaces points by elapsed time, not by index', () => {
    const c = buildChart(points, { today: '2026-06-12', width: 360, height: 180 })
    const xs = c.markers.map((m) => m.x)
    // Days 1→2 is one day of the eleven-day span; 2→12 is ten.
    expect(xs[1] - xs[0]).toBeCloseTo((xs[2] - xs[1]) / 10, 1)
    expect(xs[0]).toBeCloseTo(c.plot.x, 1)
    expect(xs[2]).toBeCloseTo(c.plot.x + c.plot.w, 1)
  })

  it('steps the line so a cumulative total holds its value between days', () => {
    const c = buildChart(points, { today: '2026-06-12', width: 360, height: 180 })
    // Each subsequent day contributes a hold segment then a jump.
    expect(c.learned.match(/L/g).length).toBe(4)
    const [, firstY] = c.learned.match(/^M[\d.]+,([\d.]+)/)
    expect(Number(firstY)).toBeCloseTo(c.plot.y + c.plot.h * (1 - 2 / c.max), 1)
  })

  it('carries the last value on to today so a plateau shows as one', () => {
    const c = buildChart(points, { today: '2026-06-20', width: 360, height: 180 })
    expect(c.end).toBe(dayTime('2026-06-20'))
    // The final marker sits short of the right edge; the line runs on past it.
    const last = c.markers[c.markers.length - 1]
    expect(last.x).toBeLessThan(c.plot.x + c.plot.w - 1)
    expect(c.learned.endsWith(`L${c.plot.x + c.plot.w},${last.learned}`)).toBe(true)
  })

  it('scales y to a round maximum and puts zero on the baseline', () => {
    const c = buildChart(points, { today: '2026-06-12', width: 360, height: 180 })
    expect(c.max).toBe(6)
    expect(c.yTicks[0]).toEqual({ value: 0, y: c.plot.y + c.plot.h })
    expect(c.yTicks[c.yTicks.length - 1].value).toBe(6)
  })

  it('draws no line for a lone day, leaving the marker to carry it', () => {
    const c = buildChart([{ day: '2026-06-01', learned: 2, mastered: 1 }], { today: '2026-06-01' })
    expect(c.learned).toBe('')
    expect(c.area).toBe('')
    expect(c.markers).toHaveLength(1)
    expect(c.markers[0].x).toBeCloseTo(c.plot.x + c.plot.w / 2, 1)
  })

  it('drops the markers once there are too many to read', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      learned: i + 1,
      mastered: i,
    }))
    expect(buildChart(many, { today: '2026-03-01' }).markers).toEqual([])
  })

  it('closes the area under the learned line back to the baseline', () => {
    const c = buildChart(points, { today: '2026-06-12', width: 360, height: 180 })
    expect(c.area.startsWith(c.learned)).toBe(true)
    expect(c.area.endsWith('Z')).toBe(true)
  })
})
