// What happens to the learner's data when a write fails, and how much gets
// written on the way (#662).
//
// Two independent things are pinned here: a restore is atomic, so a failure
// halfway cannot leave the store empty; and a lost write is no longer silent,
// so an exhausted quota doesn't cost a streak with nothing on screen to say so.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import { state as vocabState } from './vocab.js'
import { errorToastState, dismissToast } from './errorToast.js'
import { failWrites } from '../test/idbFailure.js'
import { dayKey } from '../lib/streak.js'
import {
  state,
  loadProgress,
  resetProgress,
  recordAttempt,
  exportData,
  importData,
  activityCalendar,
  currentStreak,
  totalExercises,
  persistenceSettled,
} from './progress.js'

const words = (n) =>
  Array.from({ length: n }, (_, i) => ({
    key: `w${i}`,
    cefr: 'A1',
    collections: ['animals'],
    hasInflections: false,
  }))

/** Count the readwrite transactions opened on `storeName`. */
function countTransactions(storeName) {
  let count = 0
  const proto = IDBDatabase.prototype
  const original = proto.transaction
  proto.transaction = function (names, mode) {
    const list = Array.isArray(names) ? names : [names]
    if (mode === 'readwrite' && list.includes(storeName)) count += 1
    return original.call(this, names, mode)
  }
  return {
    count: () => count,
    restore: () => {
      proto.transaction = original
    },
  }
}

const backup = (records, extra = {}) => ({
  app: 'slovarchik',
  version: 2,
  exportedAt: Date.now(),
  records,
  ...extra,
})

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = words(5)
  dismissToast()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await resetProgress()
  await loadProgress()
})

describe('importData is atomic', () => {
  it('restores a backup in a single progress transaction', async () => {
    const records = Array.from({ length: 200 }, (_, i) => ({ word: `w${i}`, events: [] }))
    const opened = countTransactions('progress')
    try {
      await importData(backup(records))
    } finally {
      opened.restore()
    }

    // One, where the per-record loop opened 200 (plus the separate clear).
    expect(opened.count()).toBe(1)
    expect((await idb.getAllProgress()).length).toBe(200)
    expect(Object.keys(state.records).length).toBe(200)
  })

  it('leaves the learner their existing progress when the restore fails', async () => {
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    const before = (await idb.getAllProgress()).map((r) => r.word)
    expect(before).toEqual(['w0'])

    const restore = await failWrites({ stores: ['progress'] })
    try {
      await expect(importData(backup([{ word: 'w3', events: [] }]))).rejects.toBeTruthy()
    } finally {
      restore()
    }

    // The clear used to run first and on its own, so this is exactly the case
    // that used to leave the store empty: neither the old data nor the new.
    expect((await idb.getAllProgress()).map((r) => r.word)).toEqual(['w0'])
    // The reactive state never diverged from the database either.
    expect(Object.keys(state.records)).toEqual(['w0'])
  })

  it('round-trips an export through an import unchanged', async () => {
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await recordAttempt({ word: 'w1', dimension: 'identification', level: 'learning', correct: false })
    const snapshot = exportData()
    const calendarBefore = totalExercises.value

    await resetProgress()
    expect(totalExercises.value).toBe(0)

    await importData(snapshot)

    expect(Object.keys(state.records).sort()).toEqual(['w0', 'w1'])
    expect(totalExercises.value).toBe(calendarBefore)
    // …and it survives a reload, from the per-day store rather than the blob.
    await loadProgress()
    expect(totalExercises.value).toBe(calendarBefore)
  })
})

describe('the activity calendar is stored per day', () => {
  it('writes one day record per answer, not the whole calendar', async () => {
    // Seed a long history the way a multi-year install would have one.
    const days = Array.from({ length: 400 }, (_, i) => ({
      day: `2024-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`,
      count: 3,
      correct: 2,
      hue: 10,
    }))
    await idb.putAllActivity(days)
    await loadProgress()
    expect(Object.keys(state.activity).length).toBeGreaterThanOrEqual(400)

    const written = []
    const original = idb.putActivityDay
    const spy = vi.spyOn(idb, 'putActivityDay')
    spy.mockImplementation((rec) => {
      written.push(rec)
      return original(rec)
    })

    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await persistenceSettled()

    // One record, for today — not the 400-entry map.
    expect(written).toHaveLength(1)
    expect(written[0].day).toBe(dayKey(Date.now()))
    expect(Object.keys(written[0]).sort()).toEqual(['correct', 'count', 'day', 'hue'])
  })

  it('adopts a pre-#662 streak:activity blob on the next load', async () => {
    const day = dayKey(Date.now())
    await idb.clearActivity()
    await idb.setMeta('streak:activity', { [day]: { count: 7, correct: 5, hue: 40 } })

    await loadProgress()

    expect(state.activity[day]).toEqual({ count: 7, correct: 5, hue: 40 })
    expect(currentStreak.value).toBe(1)
    // Adopted into the per-day store, so the blob is never consulted again.
    expect((await idb.getAllActivity()).map((d) => d.day)).toEqual([day])
  })

  it('keeps the calendar across a reload', async () => {
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await persistenceSettled()
    const total = totalExercises.value
    expect(total).toBeGreaterThan(0)

    await loadProgress()

    expect(totalExercises.value).toBe(total)
    // …and today's cell in the rendered grid carries the count.
    const cells = activityCalendar(2).weeks.flat()
    expect(cells.find((c) => c.day === dayKey(Date.now())).count).toBe(total)
  })

  it('clears the calendar on reset', async () => {
    await recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    await persistenceSettled()

    await resetProgress()

    expect(await idb.getAllActivity()).toEqual([])
    expect(totalExercises.value).toBe(0)
  })
})

describe('a lost background write is visible', () => {
  it('warns with the key rather than discarding the failure', async () => {
    const restore = await failWrites({ stores: ['activity'] })
    try {
      await recordAttempt({
        word: 'w0',
        dimension: 'identification',
        level: 'learning',
        correct: true,
      })
      await persistenceSettled()
    } finally {
      restore()
    }

    expect(console.warn).toHaveBeenCalled()
    const message = console.warn.mock.calls.map(([m]) => String(m)).join('\n')
    expect(message).toContain('could not persist')
    expect(message).toContain(dayKey(Date.now()))
  })

  it('still lets the attempt itself land', async () => {
    const restore = await failWrites({ stores: ['activity'] })
    try {
      // The streak write is deliberately absorbed — a failed calendar write
      // must not reject the answer the learner just gave.
      await recordAttempt({
        word: 'w0',
        dimension: 'identification',
        level: 'learning',
        correct: true,
      })
      await persistenceSettled()
    } finally {
      restore()
    }

    expect((await idb.getAllProgress()).map((r) => r.word)).toEqual(['w0'])
  })

  it('raises one toast for a run of failures, not one per answer', async () => {
    const restore = await failWrites({ stores: ['activity', 'meta'] })
    try {
      for (let i = 0; i < 6; i++) {
        await recordAttempt({
          word: `w${i % 5}`,
          dimension: 'identification',
          level: 'learning',
          correct: true,
        })
        await persistenceSettled()
      }
    } finally {
      restore()
    }

    expect(errorToastState.error).toBeInstanceOf(Error)
    expect(errorToastState.error.message).toMatch(/isn't being saved/)
  })

  it('says nothing while persistence is working', async () => {
    for (let i = 0; i < 4; i++) {
      await recordAttempt({
        word: `w${i}`,
        dimension: 'identification',
        level: 'learning',
        correct: true,
      })
      await persistenceSettled()
    }

    expect(errorToastState.error).toBe(null)
    expect(console.warn).not.toHaveBeenCalled()
  })
})
