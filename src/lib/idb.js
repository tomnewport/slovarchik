// Tiny promise-based IndexedDB wrapper for caching vocab files offline.
// One object store keyed by filename; each record is
// { file, pos, updated, content }.

const DB_NAME = 'slovarchik'
const STORE = 'vocab-files'
const VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'file' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const store = transaction.objectStore(STORE)
        const result = run(store)
        transaction.oncomplete = () => resolve(result.value)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

/** Read every cached file record. */
export function getAllFiles() {
  return tx('readonly', (store) => {
    const result = { value: [] }
    store.getAll().onsuccess = (e) => {
      result.value = e.target.result ?? []
    }
    return result
  })
}

/** Insert or replace a cached file record. */
export function putFile(record) {
  return tx('readwrite', (store) => {
    store.put(record)
    return { value: record }
  })
}

/** Remove all cached files (used by "reset" / tests). */
export function clearFiles() {
  return tx('readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Drop the cached connection so a fresh `indexedDB` global is picked up (tests). */
export function _resetForTests() {
  dbPromise = null
}
