// Geometry for the Progress screen's "words known by day" chart.
//
// Two things make this a chart rather than a sparkline: both axes are real
// scales (a time axis where a fortnight of silence takes up a fortnight of
// width, and a count axis with round tick values), and the lines are stepped —
// a cumulative total holds its value until the next word is learned, so a
// straight interpolation between two distant days would draw progress that
// never happened.

const DAY_MS = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Midnight UTC of a `YYYY-MM-DD` day key, as a timestamp. */
export function dayTime(day) {
  return Date.parse(`${day}T00:00:00Z`)
}

/**
 * Round tick values for a word count running 0..max. Steps are whole numbers —
 * half a word means nothing — and of the 1/2/2.5/5 × 10ⁿ steps that give a
 * readable number of ticks, the one wasting the least height wins.
 */
export function yAxis(max, target = 4) {
  const m = Math.max(1, Math.ceil(max))
  const steps = []
  for (let p = 0; p <= Math.ceil(Math.log10(m)) + 1; p++) {
    for (const mult of [1, 2, 2.5, 5]) {
      const step = mult * 10 ** p
      if (Number.isInteger(step)) steps.push(step)
    }
  }
  const fits = steps
    .map((step) => ({ step, top: Math.ceil(m / step) * step, count: Math.ceil(m / step) + 1 }))
    .filter((c) => c.count >= 3 && c.count <= target + 2)
    .sort((a, b) => a.top - b.top || b.count - a.count)
  const { step, top } = fits[0] ?? { step: 1, top: m }
  const values = []
  for (let v = 0; v <= top; v += step) values.push(v)
  return { step, top, values }
}

function startOfMonth(t) {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

function addMonths(t, n) {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)
}

function dayLabel(t) {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function monthLabel(t, withYear) {
  const d = new Date(t)
  const m = MONTHS[d.getUTCMonth()]
  return withYear ? `${m} ’${String(d.getUTCFullYear()).slice(-2)}` : m
}

const DAY_STEPS = [1, 2, 3, 7, 14, 28]
const MONTH_STEPS = [1, 2, 3, 6, 12]

/**
 * Date ticks across `[start, end]` (timestamps), at most `maxTicks` of them.
 * Short spans get day ticks anchored to the last day, so "today" is always
 * labelled; longer spans fall back to month boundaries.
 */
export function xAxis(start, end, maxTicks = 6) {
  if (end <= start) return [{ time: start, label: dayLabel(start) }]
  const span = (end - start) / DAY_MS
  const dayStep = DAY_STEPS.find((s) => Math.floor(span / s) + 1 <= maxTicks)
  if (dayStep) {
    const ticks = []
    for (let t = end; t >= start; t -= dayStep * DAY_MS) ticks.push({ time: t, label: dayLabel(t) })
    return ticks.reverse()
  }
  const months = Math.round(span / 30.44)
  const monthStep = MONTH_STEPS.find((s) => months / s <= maxTicks) ?? 12
  const withYear = new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear()
  const ticks = []
  let t = startOfMonth(start)
  while (t < start) t = addMonths(t, 1)
  for (; t <= end; t = addMonths(t, monthStep)) ticks.push({ time: t, label: monthLabel(t, withYear) })
  return ticks
}

/**
 * Chart geometry for `history()` points (`{ day, learned, mastered }`), in the
 * SVG's own pixel space. Returns null when there is nothing to draw.
 *
 * The lines run on to `today` so a plateau since the last learned word reads as
 * a plateau, not as the chart ending early.
 */
export function buildChart(points, { today, width = 360, height = 180, margin, maxTicks } = {}) {
  if (!points || points.length === 0) return null
  const data = points.map((p) => ({ ...p, t: dayTime(p.day) })).sort((a, b) => a.t - b.t)
  const todayT = today ? dayTime(today) : Date.now()
  const start = data[0].t
  const end = Math.max(data[data.length - 1].t, todayT)

  const y = yAxis(Math.max(...data.map((p) => p.learned)))
  const m = { top: 8, right: 10, bottom: 24, left: 32, ...margin }
  const plot = { x: m.left, y: m.top, w: width - m.left - m.right, h: height - m.top - m.bottom }

  const sx = (t) => (end === start ? plot.x + plot.w / 2 : plot.x + ((t - start) / (end - start)) * plot.w)
  const sy = (v) => plot.y + plot.h - (v / y.top) * plot.h
  const r1 = (n) => Math.round(n * 10) / 10

  // Stepped: hold the previous value along to the new day, then jump.
  const line = (key) => {
    if (data.length === 1 && end === start) return ''
    let d = `M${r1(sx(data[0].t))},${r1(sy(data[0][key]))}`
    for (let i = 1; i < data.length; i++) {
      d += ` L${r1(sx(data[i].t))},${r1(sy(data[i - 1][key]))} L${r1(sx(data[i].t))},${r1(sy(data[i][key]))}`
    }
    if (end > data[data.length - 1].t) d += ` L${r1(sx(end))},${r1(sy(data[data.length - 1][key]))}`
    return d
  }

  const learned = line('learned')
  const base = r1(sy(0))
  const area = learned ? `${learned} L${r1(sx(end))},${base} L${r1(sx(start))},${base} Z` : ''

  return {
    width,
    height,
    plot,
    max: y.top,
    step: y.step,
    start,
    end,
    learned,
    mastered: line('mastered'),
    area,
    // Markers only while they stay legible; a year of daily study is a smear.
    markers:
      data.length <= 40
        ? data.map((p) => ({
            key: p.day,
            x: r1(sx(p.t)),
            learned: r1(sy(p.learned)),
            mastered: r1(sy(p.mastered)),
            label: `${p.day}: ${p.learned} learned, ${p.mastered} mastered`,
          }))
        : [],
    yTicks: y.values.map((v) => ({ value: v, y: r1(sy(v)) })),
    // Roughly one date label per 80px, so a wide screen gets a denser scale
    // instead of the same four labels stretched out.
    xTicks: xAxis(start, end, maxTicks ?? Math.max(3, Math.min(8, Math.round(plot.w / 80)))).map((t) => ({
      ...t,
      x: r1(sx(t.time)),
    })),
    last: data[data.length - 1],
  }
}
