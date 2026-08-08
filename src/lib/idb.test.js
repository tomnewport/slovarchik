// Direct tests for the persistence layer (#535).
//
// Every store sits on top of this module, and with no backend behind the app
// an IndexedDB mistake loses a learner's progress outright. The store tests
// exercise the happy paths indirectly; what needs covering here is everything
// that only shows up when something changes or goes wrong — the schema upgrade,
// the rejection paths, and the cached connection.
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { reactive } from 'vue'

import * as idb from './idb.js'
import { failWrites } from '../test/idbFailure.js'

const DB_NAME = 'slovarchik'
const VERSION = 5
const STORES = ['issue-reports', 'meta', 'progress', 'vocab-files']

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
})

/** Open the database directly, bypassing the module's cached connection. */
function openRaw(version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME)
    if (onUpgrade) req.onupgradeneeded = () => onUpgrade(req.result)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Run a raw readwrite transaction over `stores`, resolving once it commits. */
function writeRaw(db, stores, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite')
    run((name) => transaction.objectStore(name))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** Await a promise's rejection reason (rather than its resolved value). */
function reasonOf(promise) {
  return promise.then(
    (value) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`)
    },
    (reason) => reason,
  )
}

describe('idb writes accept reactive state', () => {
  // The invariant these cover: every `idb` write unwraps Vue's proxies itself
  // (#534), so a store can hand over reactive state without a defensive clone.
  it('stores a reactive progress record with nested reactive maps', async () => {
    const state = reactive({
      records: { дом: { word: 'дом', events: [{ dim: 'spell', ok: true }], schedule: { due: 42 } } },
    })
    await idb.putProgress(state.records['дом'])
    const [stored] = await idb.getAllProgress()
    expect(stored).toEqual({
      word: 'дом',
      events: [{ dim: 'spell', ok: true }],
      schedule: { due: 42 },
    })
  })

  it('stores a meta value assembled from reactive reads', async () => {
    const state = reactive({ learning: { level: 'learning', words: ['дом', 'кот'] } })
    await idb.setMeta('batch:learning', { batch: state.learning })
    expect(await idb.getMeta('batch:learning')).toEqual({
      batch: { level: 'learning', words: ['дом', 'кот'] },
    })
  })

  it('detaches the stored copy from later mutations of the source', async () => {
    const state = reactive({ activity: { '2026-08-07': { count: 1 } } })
    await idb.setMeta('streak:activity', state.activity)
    state.activity['2026-08-07'].count = 99
    expect(await idb.getMeta('streak:activity')).toEqual({ '2026-08-07': { count: 1 } })
  })

  it('stores a reactive file record', async () => {
    const state = reactive({ doc: { words: { дом: { en: 'house' } } } })
    await idb.putFile({ file: 'nouns.json', pos: 'noun', doc: state.doc })
    const [stored] = await idb.getAllFiles()
    expect(stored.doc).toEqual({ words: { дом: { en: 'house' } } })
  })

  it('stores a reactive report record', async () => {
    const state = reactive({ report: { id: 'r1', context: { word: 'дом' } } })
    await idb.putReport(state.report)
    expect(await idb.getAllReports()).toEqual([{ id: 'r1', context: { word: 'дом' } }])
  })
})

describe('the schema', () => {
  it('creates all four object stores on a first run', async () => {
    await idb.getMeta('anything') // any call opens the database

    const db = await openRaw()
    expect(db.version).toBe(VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(STORES)
    db.close()
  })

  it('starts every store empty rather than undefined', async () => {
    expect(await idb.getAllFiles()).toEqual([])
    expect(await idb.getAllProgress()).toEqual([])
    expect(await idb.getAllReports()).toEqual([])
  })

  // The one that matters: `onupgradeneeded` creates only the stores that are
  // missing, so a learner arriving with an older cache keeps their progress.
  // Get this wrong in a future v6 and the deploy wipes real data, with no
  // backend to restore it from.
  it('upgrades a v4 database in place, leaving the cached data readable', async () => {
    const v4 = await openRaw(4, (db) => {
      // v4's schema: the reports store arrived with v5.
      db.createObjectStore('vocab-files', { keyPath: 'file' })
      db.createObjectStore('meta', { keyPath: 'key' })
      db.createObjectStore('progress', { keyPath: 'word' })
    })
    await writeRaw(v4, ['vocab-files', 'meta', 'progress'], (store) => {
      store('vocab-files').put({ file: 'nouns.json', pos: 'noun', hash: 'abc', doc: { words: {} } })
      store('meta').put({ key: 'settings', value: { voice: 'ru-RU' } })
      store('progress').put({ word: 'дом', events: [{ dim: 'spell', ok: true }] })
    })
    v4.close()

    // Opening through the module runs the v4 → v5 upgrade.
    expect(await idb.getAllProgress()).toEqual([
      { word: 'дом', events: [{ dim: 'spell', ok: true }] },
    ])
    expect(await idb.getMeta('settings')).toEqual({ voice: 'ru-RU' })
    expect((await idb.getAllFiles()).map((f) => f.file)).toEqual(['nouns.json'])
    // …and the store v5 added is there, empty, alongside the surviving data.
    expect(await idb.getAllReports()).toEqual([])

    const upgraded = await openRaw()
    expect(upgraded.version).toBe(VERSION)
    expect([...upgraded.objectStoreNames].sort()).toEqual(STORES)
    upgraded.close()
  })
})

describe('reads, writes and deletes round-trip', () => {
  it('deletes and clears cached files', async () => {
    await idb.putFile({ file: 'nouns.json', pos: 'noun' })
    await idb.putFile({ file: 'verbs.json', pos: 'verb' })

    await idb.deleteFile('nouns.json')
    expect((await idb.getAllFiles()).map((f) => f.file)).toEqual(['verbs.json'])

    await idb.clearFiles()
    expect(await idb.getAllFiles()).toEqual([])
  })

  it('deletes and clears progress records', async () => {
    await idb.putProgress({ word: 'дом' })
    await idb.putProgress({ word: 'кот' })

    await idb.deleteProgress('дом')
    expect((await idb.getAllProgress()).map((p) => p.word)).toEqual(['кот'])

    await idb.clearProgress()
    expect(await idb.getAllProgress()).toEqual([])
  })

  it('deletes a queued report by id', async () => {
    await idb.putReport({ id: 'r1' })
    await idb.putReport({ id: 'r2' })

    await idb.deleteReport('r1')
    expect((await idb.getAllReports()).map((r) => r.id)).toEqual(['r2'])
  })

  it('replaces a record written under the same key', async () => {
    await idb.putProgress({ word: 'дом', events: [1] })
    await idb.putProgress({ word: 'дом', events: [1, 2] })
    expect(await idb.getAllProgress()).toEqual([{ word: 'дом', events: [1, 2] }])
  })

  it('resolves to undefined for a meta key that was never set', async () => {
    expect(await idb.getMeta('never-set')).toBeUndefined()
  })

  it('overwrites a meta key rather than accumulating rows', async () => {
    await idb.setMeta('settings', { voice: 'ru-RU' })
    await idb.setMeta('settings', { voice: 'ru-RU', rate: 0.9 })
    expect(await idb.getMeta('settings')).toEqual({ voice: 'ru-RU', rate: 0.9 })
  })
})

// `progress.js` leans on these rejections: `SessionView` catches a per-target
// write failure and deliberately advances the session before re-throwing, and
// `saveMeta` swallows its rejection so a failed write never surfaces as an
// unhandled one. Both only hold if a failed write actually rejects.
describe('failed writes reject', () => {
  it('rejects when the record has no usable key', async () => {
    const reason = await reasonOf(idb.putProgress({ word: { not: 'a key' } }))
    expect(reason.name).toBe('DataError')
  })

  it('rejects when the value cannot be structured-cloned', async () => {
    const reason = await reasonOf(idb.setMeta('callback', { onDone: () => {} }))
    expect(reason.name).toBe('DataCloneError')
  })

  // The rejection has to carry the underlying error, not `null`: SessionView
  // re-throws it for Vue's global handler, which is what the learner sees.
  it('rejects with the underlying error when the transaction aborts', async () => {
    await idb.putProgress({ word: 'дом' })

    const restore = await failWrites()
    let reason
    try {
      reason = await reasonOf(idb.putProgress({ word: 'кот' }))
    } finally {
      restore()
    }
    expect(reason.name).toBe('ConstraintError')

    // The abort rolled the whole transaction back — neither the caller's write
    // nor the record that triggered it landed.
    expect(await idb.getAllProgress()).toEqual([{ word: 'дом' }])
  })
})

describe('the cached connection', () => {
  /** Count `indexedDB.open` calls while still opening for real. */
  function countOpens() {
    const factory = globalThis.indexedDB
    const counter = { calls: 0 }
    globalThis.indexedDB = {
      open: (...args) => {
        counter.calls++
        return factory.open(...args)
      },
    }
    return counter
  }

  it('opens the database once, however many operations run', async () => {
    const opens = countOpens()

    // Concurrent callers race for the connection; sequential ones follow it.
    await Promise.all([idb.getMeta('a'), idb.setMeta('b', 1), idb.getAllProgress()])
    await idb.getAllFiles()

    expect(opens.calls).toBe(1)
  })

  it('re-opens after _resetForTests so a fresh indexedDB global is picked up', async () => {
    const opens = countOpens()
    await idb.getAllFiles()
    expect(opens.calls).toBe(1)

    idb._resetForTests()
    await idb.getAllFiles()
    expect(opens.calls).toBe(2)
  })

  it('surfaces a failure to open rather than hanging', async () => {
    globalThis.indexedDB = {
      open: () => {
        const req = { onsuccess: null, onerror: null, error: new Error('open blocked') }
        queueMicrotask(() => req.onerror())
        return req
      },
    }
    const reason = await reasonOf(idb.getAllProgress())
    expect(reason.message).toBe('open blocked')
  })
})
