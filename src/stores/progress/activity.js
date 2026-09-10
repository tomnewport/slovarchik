// Streak + activity calendar (#streak-system).
//
// Imports `state` and the persistence helpers, and nothing else from this
// directory — in particular not `batches.js`. `batchSignature` reads
// `state.learning` / `state.mastery` directly for that reason: `records.js`
// calls `logActivity` from `recordAttempt`, and `batches.js` calls `stateOf`
// from `records.js`, so an edge from here to `batches.js` would close the loop
// records → activity → batches → records (#667).
import { computed } from 'vue'

import * as idb from '../../lib/idb.js'
import {
  dayKey,
  currentStreak as computeStreak,
  longestStreak as computeLongestStreak,
  maxDailyCount,
  totalExercises as computeTotalExercises,
  randomHue,
  buildCalendar,
} from '../../lib/streak.js'

import { state } from './state.js'
import { saveInBackground, saveMeta } from './persistence.js'

/** A stable signature of the active batches; changes when either batch does. */
export function batchSignature() {
  const sig = (b) => (b ? `${b.name}:${(b.words ?? []).join(',')}` : '-')
  return `${sig(state.learning)}|${sig(state.mastery)}`
}

/**
 * Record one day's worth of exercise effort: bump today's count/correct and
 * stamp it with the current batch hue, rerolling that hue whenever the active
 * batch has changed since the last attempt. Reactive state updates synchronously
 * (so the streak and calendar are instantly live); persistence is fire-and-forget
 * so the calendar survives the event-window capping that discards old attempts
 * without adding an awaited write to the hot recording path.
 */
export function logActivity(ts, correct, times) {
  const sig = batchSignature()
  if (sig !== state.batchSig) {
    state.batchSig = sig
    state.streakHue = randomHue()
    saveMeta('streak:batchSig', sig)
    saveMeta('streak:hue', state.streakHue)
  }
  const day = dayKey(ts)
  const rec = state.activity[day] ?? { count: 0, correct: 0, hue: state.streakHue }
  rec.count += times
  if (correct) rec.correct += times
  rec.hue = state.streakHue
  state.activity[day] = rec
  // One small record for the day that changed, not the whole calendar (#662).
  // The map is never pruned, so rewriting it per answer meant a ~365-entry
  // object after a year of daily use and ~1,100 after three, serialised and
  // structured-cloned on the hot path of every drill.
  saveInBackground(`activity ${day}`, idb.putActivityDay(activityRecord(day, rec)))
}

/** The stored shape of one calendar day. */
export function activityRecord(day, rec) {
  return { day, count: rec.count, correct: rec.correct, hue: rec.hue }
}

/** Current streak length in days (today, or a yesterday-grace day, backwards). */
export const currentStreak = computed(() => computeStreak(state.activity, dayKey(Date.now())))

/** Longest run of consecutive active days ever achieved. */
export const longestStreak = computed(() => computeLongestStreak(state.activity))

/** Personal record: the most exercises done in a single day. */
export const dailyRecord = computed(() => maxDailyCount(state.activity))

/** Total exercises ever done (across all days). */
export const totalExercises = computed(() => computeTotalExercises(state.activity))

/** GitHub-style contribution grid for the Progress screen. */
export function activityCalendar(weeks = 53) {
  return buildCalendar(state.activity, dayKey(Date.now()), weeks)
}
