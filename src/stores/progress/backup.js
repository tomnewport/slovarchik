// Data export / import (the Data screen's JSON backup).
import * as idb from '../../lib/idb.js'
import { toPlain } from '../../lib/plain.js'
import { buildActivityFromEvents, randomHue } from '../../lib/streak.js'

import { state, BATCH_META_KEY } from './state.js'
import { persistedShape } from './persistence.js'
import { clearMemo, acknowledgeAchievements } from './records.js'
import { batchSignature, activityRecord } from './activity.js'
import {
  normaliseRecord,
  isPreScheduler,
  grandfatherConfirmed,
  recheckMasteredPeak,
} from './migrations.js'

/**
 * Bumped if the export schema (or the meaning of its data) changes; guards
 * imports. v2: mastery criteria tightened to two spaced correct answers per
 * dimension (#313) — pre-v2 backups get their mastered peaks re-checked on
 * import (see {@link recheckMasteredPeak}).
 */
export const EXPORT_VERSION = 2

/** A serialisable snapshot of all progress data (plain, proxy-free). */
export function exportData() {
  const snapshot = {
    app: 'slovarchik',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    firstUseAt: state.firstUseAt,
    records: Object.values(state.records).map((rec) => persistedShape(rec)),
    batches: { learning: state.learning, mastery: state.mastery },
    seenAchievements: [...state.seenAchievements],
    achievementsEarnedAt: state.achievementsEarnedAt,
    metWords: state.metWords,
    activity: state.activity,
    streakHue: state.streakHue,
    batchSig: state.batchSig,
  }
  // Detach from reactive state (e.g. the batches) before handing it out.
  return toPlain(snapshot)
}

/** Validate a parsed import payload. Returns `{ ok, error }`. */
export function validateImport(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Not a backup object.' }
  if (data.app !== 'slovarchik') return { ok: false, error: 'Not a Slovarchik backup.' }
  if (typeof data.version !== 'number') return { ok: false, error: 'Missing version.' }
  if (data.version > EXPORT_VERSION) return { ok: false, error: 'Backup is from a newer version.' }
  if (!Array.isArray(data.records)) return { ok: false, error: 'Missing records.' }
  for (const r of data.records) {
    if (!r || typeof r.word !== 'string' || !Array.isArray(r.events)) {
      return { ok: false, error: 'A record is malformed.' }
    }
  }
  return { ok: true }
}

/** Replace all progress with an imported snapshot (validated first). */
export async function importData(data) {
  const check = validateImport(data)
  if (!check.ok) throw new Error(check.error)

  const map = {}
  const records = []
  for (const r of data.records) {
    const rec = normaliseRecord(r)
    // Backups from before the scheduler carry no `schedule`: grandfather their
    // learned words as confirmed, same as loadProgress does (#313). Both call
    // the same rule in migrations.js rather than each spelling it out.
    if (isPreScheduler(r)) grandfatherConfirmed(rec)
    // Backups exported before the mastery criteria tightened (v1) carry peaks
    // earned under the old single-answer rule — re-check them (#313).
    if (data.version < 2) recheckMasteredPeak(rec)
    map[r.word] = rec
    records.push(rec)
  }
  // One transaction that clears and rewrites the store together (#662). The
  // clear used to run first and the records were written one transaction each,
  // so a failure partway through — or a closed tab — left the learner with
  // neither their old progress nor the backup they were restoring. Aborting
  // this transaction puts the pre-import contents back, and nothing below runs,
  // so the reactive state is never left disagreeing with the database.
  await idb.replaceAllProgress(records)
  // Use the plain source values for persistence — reading them back off the
  // reactive `state` would hand IndexedDB a Vue proxy it can't clone.
  const learningBatch = data.batches?.learning ?? null
  const masteryBatch = data.batches?.mastery ?? null
  clearMemo()
  state.records = map
  state.learning = learningBatch
  state.mastery = masteryBatch
  await idb.setMeta(BATCH_META_KEY('learning'), learningBatch)
  await idb.setMeta(BATCH_META_KEY('mastery'), masteryBatch)
  if (data.firstUseAt) {
    state.firstUseAt = data.firstUseAt
    await idb.setMeta('firstUseAt', data.firstUseAt)
  }
  const seenIds = Array.isArray(data.seenAchievements) ? data.seenAchievements : []
  state.seenAchievements = new Set(seenIds)
  await idb.setMeta('seenAchievements', seenIds)
  // A backup predating the stamp carries no earned-at map; the achievements it
  // implies are re-stamped from the restored records on the next attempt.
  const earnedAt =
    data.achievementsEarnedAt && typeof data.achievementsEarnedAt === 'object'
      ? toPlain(data.achievementsEarnedAt)
      : {}
  state.achievementsEarnedAt = earnedAt
  await idb.setMeta('achievementsEarnedAt', earnedAt)
  const metWords =
    data.metWords && typeof data.metWords === 'object' ? toPlain(data.metWords) : {}
  state.metWords = metWords
  await idb.setMeta('metWords', metWords)
  // Restore the activity calendar / streak, falling back to whatever the events
  // imply for backups that predate the streak system.
  const importedActivity =
    data.activity && typeof data.activity === 'object'
      ? data.activity
      : buildActivityFromEvents(map)
  state.activity = toPlain(importedActivity)
  state.streakHue = typeof data.streakHue === 'number' ? data.streakHue : randomHue()
  state.batchSig = typeof data.batchSig === 'string' ? data.batchSig : batchSignature()
  await idb.replaceAllActivity(
    Object.entries(state.activity).map(([day, rec]) => activityRecord(day, rec)),
  )
  // Clear the pre-#662 blob too, so it can't shadow an imported empty calendar
  // on the next boot.
  await idb.setMeta('streak:activity', {})
  await idb.setMeta('streak:hue', state.streakHue)
  await idb.setMeta('streak:batchSig', state.batchSig)
  // Silently acknowledge any achievements already earned in the imported data so
  // they don't all fire as notifications at the end of the very next session.
  await acknowledgeAchievements()
  return true
}
