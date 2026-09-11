// Loading and resetting the store.
//
// The one place that reads every section's slice of IndexedDB back into
// reactive state, so it necessarily imports from most of them. Nothing imports
// it back.
import { coalesce } from '../../lib/coalesce.js'
import * as idb from '../../lib/idb.js'
import { levelMet, lastAttemptAt } from '../../lib/progression.js'
import {
  buildActivityFromEvents,
  randomHue,
  hueForDay,
} from '../../lib/streak.js'

import { state, BATCH_META_KEY } from './state.js'
import { persistedShape } from './persistence.js'
import { clearMemo } from './records.js'
import { batchSignature, activityRecord } from './activity.js'
import {
  normaliseRecord,
  isPreScheduler,
  grandfatherConfirmed,
  recheckMasteredPeak,
} from './migrations.js'

/**
 * Populate the store from IndexedDB (progress records + committed batches).
 *
 * Coalesced (#659): `main.js` starts this on boot and each deep-linkable view
 * starts it again from `onMounted`, so without the wrapper the migration pass
 * below runs twice and `clearMemo()` fires mid-flight through the other run.
 */
async function doLoadProgress() {
  const records = await idb.getAllProgress()
  const map = {}
  // Records persisted before the scheduler existed carry no `schedule` field.
  // Their learned words are grandfathered as already confirmed below — the
  // learner shouldn't wake up to every known word suddenly "pending" (#313).
  const legacy = new Set()
  for (const r of records) {
    if (isPreScheduler(r)) legacy.add(r.word)
    map[r.word] = normaliseRecord(r)
  }
  // Backfill first-learned / first-mastered timestamps for any record that
  // qualifies but predates timestamp stamping, so the history chart can't fall
  // behind the live learned/mastered counts. These criteria are inflection-
  // independent, so they're safe to compute before the vocab is loaded.
  const masteryRechecked = (await idb.getMeta('migration:mastery-recheck')) ?? false
  const backfilled = []
  for (const rec of Object.values(map)) {
    let changed = false
    const when = lastAttemptAt(rec.events) ?? Date.now()
    if (rec.learnedAt == null && levelMet(rec.events, 'learning', { known: rec.known })) {
      rec.learnedAt = when
      changed = true
    }
    if (rec.masteredAt == null && levelMet(rec.events, 'mastery', { known: rec.known })) {
      rec.masteredAt = when
      changed = true
    }
    // Applied here, after the backfill above, so the grandfathering sees the
    // `learnedAt` that backfill may just have filled in.
    if (legacy.has(rec.word) && grandfatherConfirmed(rec)) changed = true
    if (!masteryRechecked && recheckMasteredPeak(rec)) changed = true
    if (changed) backfilled.push(rec)
  }
  // One transaction for the whole backfill rather than one per record (#662).
  if (backfilled.length) await idb.putAllProgress(backfilled.map(persistedShape))
  if (!masteryRechecked) await idb.setMeta('migration:mastery-recheck', true)

  clearMemo()
  state.records = map
  state.learning = (await idb.getMeta(BATCH_META_KEY('learning'))) ?? null
  state.mastery = (await idb.getMeta(BATCH_META_KEY('mastery'))) ?? null
  // Stamp first use the first time we ever load.
  state.firstUseAt = (await idb.getMeta('firstUseAt')) ?? null
  if (state.firstUseAt == null) {
    state.firstUseAt = Date.now()
    await idb.setMeta('firstUseAt', state.firstUseAt)
  }
  const seenIds = (await idb.getMeta('seenAchievements')) ?? []
  state.seenAchievements = new Set(Array.isArray(seenIds) ? seenIds : [])
  // Achievements are stamped with when they were first earned, because
  // `earnedSet` only answers whether the threshold is met *now* (see
  // `stampEarned`). Installs from before the stamp have none, and their
  // achievements are backfilled by the first `stampAchievements` after an
  // attempt — additively, so a partial backfill (vocab not loaded yet, hence no
  // cefr stats) loses nothing and is completed by the next one.
  const earnedAt = await idb.getMeta('achievementsEarnedAt')
  state.achievementsEarnedAt = earnedAt && typeof earnedAt === 'object' ? { ...earnedAt } : {}

  // Activity calendar / streak. The forward-logged store is authoritative; on
  // first run (or for any day it lacks) back-populate from the surviving per-
  // word events so existing learners keep their history. Capping means old days
  // may undercount, but it's the best available — and we never overwrite a day
  // already logged, so no day is double-counted.
  state.streakHue = (await idb.getMeta('streak:hue')) ?? randomHue()
  state.batchSig = (await idb.getMeta('streak:batchSig')) ?? batchSignature()
  const activity = {}
  const storedDays = await idb.getAllActivity()
  for (const d of storedDays) activity[d.day] = { count: d.count, correct: d.correct, hue: d.hue }
  // Installs from before the per-day store (#662) still hold the calendar in a
  // single `streak:activity` meta blob. Adopt it once — the store being empty
  // is the only signal, and once it isn't the blob is never read again.
  const adopting = []
  if (!storedDays.length) {
    const legacy = (await idb.getMeta('streak:activity')) ?? {}
    for (const [day, d] of Object.entries(legacy)) {
      activity[day] = { count: d.count, correct: d.correct, hue: d.hue }
      adopting.push(day)
    }
  }
  const derived = buildActivityFromEvents(state.records)
  for (const [day, d] of Object.entries(derived)) {
    if (!activity[day]) {
      activity[day] = { count: d.count, correct: d.correct, hue: hueForDay(day) }
      adopting.push(day)
    }
  }
  state.activity = activity
  // Both the adoption and the event backfill are one transaction, not one per
  // day — a learner with three years of history had ~1,100 of them.
  if (adopting.length) {
    await idb.putAllActivity(adopting.map((day) => activityRecord(day, activity[day])))
  }

  state.loaded = true
  return state
}

export const loadProgress = coalesce(doLoadProgress)

/** Wipe all progress (records + batches + first-use timestamp). For the Data screen's reset/tests. */
export async function resetProgress() {
  await idb.clearProgress()
  await idb.setMeta(BATCH_META_KEY('learning'), null)
  await idb.setMeta(BATCH_META_KEY('mastery'), null)
  await idb.setMeta('firstUseAt', null)
  await idb.setMeta('seenAchievements', [])
  await idb.setMeta('achievementsEarnedAt', {})
  await idb.clearActivity()
  await idb.setMeta('streak:activity', {})
  await idb.setMeta('streak:hue', null)
  await idb.setMeta('streak:batchSig', null)
  clearMemo()
  state.records = {}
  state.learning = null
  state.mastery = null
  state.firstUseAt = null
  state.seenAchievements = new Set()
  state.achievementsEarnedAt = {}
  state.activity = {}
  state.streakHue = randomHue()
  state.batchSig = ''
}
