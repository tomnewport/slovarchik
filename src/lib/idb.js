// Tiny promise-based IndexedDB wrapper. Three object stores:
//   'vocab-files' (keyed by filename)  — cached parsed vocab doc: { file, pos, updated, hash, doc }
//   'meta'        (keyed by name)       — small app settings: { key, value }
//   'progress'    (keyed by word)       — per-word learning record (see stores/progress.js)
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
const VERSION = 5

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
// and have a DataCloneError reject rather than throw at the call site.
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
