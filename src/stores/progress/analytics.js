// Analytics for the Progress screen.
import { state, rank } from './state.js'
import { stateOf } from './records.js'

/** Keys currently at (or above) `learned`. */
export function learnedWords() {
  return Object.keys(state.records).filter((k) => rank(stateOf(k)) >= rank('learned'))
}

/** Keys currently `mastered`. */
export function masteredWords() {
  return Object.keys(state.records).filter((k) => stateOf(k) === 'mastered')
}

/**
 * Cumulative words-known-by-day history, derived from each record's first
 * learned / mastered timestamps. One point per day on which something changed.
 * @returns {Array<{day: string, learned: number, mastered: number}>}
 */
export function history() {
  const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10)
  const learnedByDay = new Map()
  const masteredByDay = new Map()
  for (const rec of Object.values(state.records)) {
    if (rec.learnedAt != null) {
      const d = dayOf(rec.learnedAt)
      learnedByDay.set(d, (learnedByDay.get(d) ?? 0) + 1)
    }
    if (rec.masteredAt != null) {
      const d = dayOf(rec.masteredAt)
      masteredByDay.set(d, (masteredByDay.get(d) ?? 0) + 1)
    }
  }
  const days = [...new Set([...learnedByDay.keys(), ...masteredByDay.keys()])].sort()
  let learned = 0
  let mastered = 0
  return days.map((day) => {
    learned += learnedByDay.get(day) ?? 0
    mastered += masteredByDay.get(day) ?? 0
    return { day, learned, mastered }
  })
}
