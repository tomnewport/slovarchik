// Tiny promise-based IndexedDB wrapper. Object stores:
//   'vocab-files' (keyed by filename)  — cached parsed vocab doc: { file, pos, updated, hash, doc }
//   'meta'        (keyed by name)       — small app settings: { key, value }
//   'progress'    (keyed by word)       — per-word learning record (see stores/progress.js)
//   'issue-reports' (keyed by id)       — offline-queued issue reports
//   'activity'    (keyed by day)        — one day of the streak calendar: { day, count, correct, hue }
//
// Writes come in two shapes: one record at a time, and — since #662 — whole
// batches inside a single transaction. The batch writers exist for atomicity as
// much as for speed: IndexedDB transactions are already all-or-nothing, so a
// restore that fails halfway leaves the store as it was instead of empty.
//
// Every write runs its record through `toPlain` first (#534), so callers can
// hand over reactive store state directly: unwrapping Vue's proxies is this
// boundary's job, not each caller's.
//
// Every export returns a promise and reports failure by rejecting it — never by
// throwing synchronously. Callers depend on that: `progress.js` fires its
// streak writes off with a bare `.catch(() => {})`, which a synchronous throw
// would sail straight past.

import { toPlain } from './plain.js'

const DB_NAME = 'slovarchik'
const FILES_STORE = 'vocab-files'
const META_STORE = 'meta'
const PROGRESS_STORE = 'progress'
const REPORTS_STORE = 'issue-reports'
// One record per day of the streak calendar (#662). Before this the whole
// calendar was a single `meta` blob rewritten on every answer.
const ACTIVITY_STORE = 'activity'
const VERSION = 6

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // Create only what's missing so existing caches survive the upgrade.
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'file' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      // New for the progression model (v4). A fresh store — the old progress
      // records no longer exist, so there is nothing to migrate.
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: 'word' })
      }
      if (!db.objectStoreNames.contains(REPORTS_STORE)) {
        db.createObjectStore(REPORTS_STORE, { keyPath: 'id' })
      }
      // New for the per-day activity calendar (v6). Existing installs still
      // have their calendar in the `streak:activity` meta blob; `loadProgress`
      // adopts it into this store on the next boot, so nothing is migrated
      // here — a fresh store is all that's needed.
      if (!db.objectStoreNames.contains(ACTIVITY_STORE)) {
        db.createObjectStore(ACTIVITY_STORE, { keyPath: 'day' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/**
 * The reason to reject a failed transaction with.
 *
 * A failing request's `error` event *bubbles* to the transaction, and it does
 * so before the abort — at which point `transaction.error` is still null. So
 * the useful error is the one on the event's target (the request that failed);
 * `transaction.error` is the fallback for an abort raised on the transaction
 * itself. Without this the rejection carries `null` and the caller has nothing
 * to report — `SessionView` re-throws it for Vue's global handler to surface.
 */
function txError(event, transaction) {
  return (
    event?.target?.error ??
    transaction.error ??
    new DOMException('The IndexedDB transaction was aborted.', 'AbortError')
  )
}

// `run` is called inside the promise, so a writer can do its `toPlain` there
// and have a DataCloneError reject rather than throw at the call site. It may
// issue any number of requests on the store — the transaction commits when they
// have all succeeded, and aborts as a whole if any one of them fails, which is
// what makes the batch writers below atomic.
function tx(storeName, mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode)
        const store = transaction.objectStore(storeName)
        const result = run(store)
        transaction.oncomplete = () => resolve(result.value)
        transaction.onerror = (event) => reject(txError(event, transaction))
        transaction.onabort = (event) => reject(txError(event, transaction))
      }),
  )
}

/** Read every record in an object store. */
function getAll(storeName) {
  return tx(storeName, 'readonly', (store) => {
    const result = { value: [] }
    store.getAll().onsuccess = (e) => {
      result.value = e.target.result ?? []
    }
    return result
  })
}

/** Read every cached file record. */
export function getAllFiles() {
  return getAll(FILES_STORE)
}

/** Insert or replace a cached file record. */
export function putFile(record) {
  return tx(FILES_STORE, 'readwrite', (store) => {
    const plain = toPlain(record)
    store.put(plain)
    return { value: plain }
  })
}

/** Delete a single cached file record by its filename. */
export function deleteFile(file) {
  return tx(FILES_STORE, 'readwrite', (store) => {
    store.delete(file)
    return { value: file }
  })
}

/** Remove all cached files (used by "reset" / tests). */
export function clearFiles() {
  return tx(FILES_STORE, 'readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Read every per-word progress record. */
export function getAllProgress() {
  return getAll(PROGRESS_STORE)
}

/** Insert or replace a per-word progress record. */
export function putProgress(record) {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    const plain = toPlain(record)
    store.put(plain)
    return { value: plain }
  })
}

/**
 * Insert or replace many per-word progress records in ONE transaction.
 *
 * A per-record loop of {@link putProgress} opens a transaction each — 2,000 of
 * them for a large restore — and leaves the store half-written if one fails.
 * Here every `put` rides one transaction, so the batch either lands whole or
 * not at all.
 */
export function putAllProgress(records) {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    const plain = records.map((record) => toPlain(record))
    for (const record of plain) store.put(record)
    return { value: plain }
  })
}

/**
 * Replace the entire progress store with `records`, atomically.
 *
 * The clear runs inside the same transaction as the writes, which is the whole
 * point: `importData` used to clear first and then write record by record, so a
 * failure partway through left the learner with neither their old progress nor
 * the backup they were restoring. Aborting this transaction restores the
 * pre-clear contents.
 */
export function replaceAllProgress(records) {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    const plain = records.map((record) => toPlain(record))
    store.clear()
    for (const record of plain) store.put(record)
    return { value: plain }
  })
}

/** Delete a single per-word progress record by its word key. */
export function deleteProgress(word) {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    store.delete(word)
    return { value: word }
  })
}

/** Remove all progress records (used by "reset" / tests). */
export function clearProgress() {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Read a single app setting's value (undefined if unset). */
export function getMeta(key) {
  return tx(META_STORE, 'readonly', (store) => {
    const result = { value: undefined }
    store.get(key).onsuccess = (e) => {
      result.value = e.target.result?.value
    }
    return result
  })
}

/** Insert or replace a single app setting. */
export function setMeta(key, value) {
  return tx(META_STORE, 'readwrite', (store) => {
    const plain = toPlain(value)
    store.put({ key, value: plain })
    return { value: plain }
  })
}

/** Read every day of the stored activity calendar. */
export function getAllActivity() {
  return getAll(ACTIVITY_STORE)
}

/** Insert or replace one day of the activity calendar. */
export function putActivityDay(record) {
  return tx(ACTIVITY_STORE, 'readwrite', (store) => {
    const plain = toPlain(record)
    store.put(plain)
    return { value: plain }
  })
}

/** Insert or replace many days of the activity calendar in one transaction. */
export function putAllActivity(records) {
  return tx(ACTIVITY_STORE, 'readwrite', (store) => {
    const plain = records.map((record) => toPlain(record))
    for (const record of plain) store.put(record)
    return { value: plain }
  })
}

/** Replace the whole activity calendar with `records`, atomically. */
export function replaceAllActivity(records) {
  return tx(ACTIVITY_STORE, 'readwrite', (store) => {
    const plain = records.map((record) => toPlain(record))
    store.clear()
    for (const record of plain) store.put(record)
    return { value: plain }
  })
}

/** Remove the whole activity calendar (used by "reset" / tests). */
export function clearActivity() {
  return tx(ACTIVITY_STORE, 'readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Read every queued issue report. */
export function getAllReports() {
  return getAll(REPORTS_STORE)
}

/** Insert or replace a queued issue report. */
export function putReport(record) {
  return tx(REPORTS_STORE, 'readwrite', (store) => {
    const plain = toPlain(record)
    store.put(plain)
    return { value: plain }
  })
}

/** Delete a queued issue report by id. */
export function deleteReport(id) {
  return tx(REPORTS_STORE, 'readwrite', (store) => {
    store.delete(id)
    return { value: id }
  })
}

/** Drop the cached connection so a fresh `indexedDB` global is picked up (tests). */
export function _resetForTests() {
  dbPromise = null
}
