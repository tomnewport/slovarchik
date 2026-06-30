// Pure streak + activity-calendar logic. No Vue, no I/O — framework-free so it
// stays trivially unit-testable.
//
// The app tracks one "activity" record per local calendar day:
//   { count, correct, hue }
//     count   — number of exercise attempts answered that day
//     correct — how many of those were right
//     hue     — the batch hue in effect when the day was practised (0..359)
//
// From this we derive the streak (consecutive days with at least one exercise)
// and the GitHub-style contribution calendar, where each cell's colour encodes
// effort: hue per batch, value (brightness) = exercises vs the personal record,
// saturation = proportion correct.

/** Local-calendar day key 'YYYY-MM-DD' for a timestamp (ms). */
export function dayKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a 'YYYY-MM-DD' key by `n` whole days (local), returning a new key. */
export function shiftDay(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + n))
}

/** Day-of-week for a key (0 = Sunday … 6 = Saturday), local. */
export function weekday(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Aggregate every record's attempt events into per-day { count, correct }. */
export function buildActivityFromEvents(records) {
  const byDay = {}
  for (const rec of Object.values(records ?? {})) {
    for (const e of rec.events ?? []) {
      if (e.ts == null) continue
      const day = dayKey(e.ts)
      const bucket = byDay[day] ?? (byDay[day] = { count: 0, correct: 0 })
      bucket.count++
      if (e.correct) bucket.correct++
    }
  }
  return byDay
}

/** Set of day keys on which at least one exercise was done. */
export function activeDays(activity) {
  const set = new Set()
  for (const [day, rec] of Object.entries(activity ?? {})) {
    if ((rec?.count ?? 0) > 0) set.add(day)
  }
  return set
}

/**
 * Length of the current streak: consecutive days with activity ending today,
 * or yesterday (a grace day — today's exercise isn't done *yet* but the streak
 * is still alive until midnight).
 */
export function currentStreak(activity, todayKey) {
  const set = activeDays(activity)
  let cursor = todayKey
  if (!set.has(cursor)) {
    cursor = shiftDay(todayKey, -1)
    if (!set.has(cursor)) return 0
  }
  let streak = 0
  while (set.has(cursor)) {
    streak++
    cursor = shiftDay(cursor, -1)
  }
  return streak
}

/** The longest run of consecutive active days ever achieved. */
export function longestStreak(activity) {
  const days = [...activeDays(activity)].sort()
  let best = 0
  let run = 0
  let prev = null
  for (const day of days) {
    run = prev != null && shiftDay(prev, 1) === day ? run + 1 : 1
    if (run > best) best = run
    prev = day
  }
  return best
}

/** The personal record: most exercises done in a single day. */
export function maxDailyCount(activity) {
  let max = 0
  for (const rec of Object.values(activity ?? {})) {
    if ((rec?.count ?? 0) > max) max = rec.count
  }
  return max
}

/** Total exercises done across every day. */
export function totalExercises(activity) {
  let total = 0
  for (const rec of Object.values(activity ?? {})) total += rec?.count ?? 0
  return total
}

/** Pick a fresh random hue (0..359). */
export function randomHue(rng = Math.random) {
  return Math.floor(rng() * 360)
}

/** Deterministic fallback hue for a day with no recorded batch hue. */
export function hueForDay(key) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

/** HSV (h 0..360, s/v 0..1) → '#rrggbb'. */
export function hsvToHex(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const hex = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Colour for one calendar cell. Returns null for an empty day so the UI can
 * render its neutral "no activity" cell.
 *   hue        — the day's batch hue (or a deterministic fallback)
 *   value      — brightness, exercises done relative to the personal record
 *   saturation — proportion of answers correct
 */
export function dayColor(rec, maxCount) {
  const count = rec?.count ?? 0
  if (count <= 0) return null
  const hue = rec.hue ?? hueForDay(rec.day ?? '')
  const frac = maxCount > 0 ? Math.min(1, count / maxCount) : 1
  // Floor the value so even a single exercise stays visible on the calendar
  // while more exercises still read as brighter.
  const value = 0.35 + 0.65 * frac
  const saturation = count > 0 ? Math.min(1, (rec.correct ?? 0) / count) : 0
  return hsvToHex(hue, saturation, value)
}

/**
 * Build the GitHub-style contribution grid: `weeks` columns (oldest first),
 * each a length-7 array of cells indexed by weekday (0 = Sunday). The last
 * column is the current week; days after today are flagged `future`.
 * @returns {{ weeks: Array<Array<object|null>>, months: Array<{index, label}> }}
 */
export function buildCalendar(activity, todayKey, weeks = 53) {
  const maxCount = maxDailyCount(activity)
  // Walk back to the Sunday that starts the oldest visible week.
  const startThisWeek = shiftDay(todayKey, -weekday(todayKey))
  const start = shiftDay(startThisWeek, -(weeks - 1) * 7)
  const cols = []
  const months = []
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const day = shiftDay(start, w * 7 + d)
      const future = day > todayKey
      const rec = activity?.[day]
      const cell = {
        day,
        count: rec?.count ?? 0,
        correct: rec?.correct ?? 0,
        future,
        color: future ? null : dayColor(rec ? { ...rec, day } : { day }, maxCount),
      }
      col.push(cell)
      // Label a week column with a month when its first row crosses into a new
      // month, the way GitHub aligns month captions to the grid.
      if (d === 0) {
        const month = Number(day.slice(5, 7)) - 1
        if (month !== lastMonth) {
          months.push({ index: w, label: MONTHS[month] })
          lastMonth = month
        }
      }
    }
    cols.push(col)
  }
  return { weeks: cols, months }
}
