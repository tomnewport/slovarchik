// Tiny promise-based IndexedDB wrapper. Two object stores:
//   'vocab-files' (keyed by filename)  — cached vocab YAML: { file, pos, updated, content }
//   'progress'    (keyed by subject id) — per-subject attempt history (see lib/progress.js)

const DB_NAME = 'slovarchik'
const FILES_STORE = 'vocab-files'
const PROGRESS_STORE = 'progress'
const VERSION = 2

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
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(storeName, mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode)
        const store = transaction.objectStore(storeName)
        const result = run(store)
        transaction.oncomplete = () => resolve(result.value)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
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
    store.put(record)
    return { value: record }
  })
}

/** Remove all cached files (used by "reset" / tests). */
export function clearFiles() {
  return tx(FILES_STORE, 'readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Read every stored progress record. */
export function getAllProgress() {
  return getAll(PROGRESS_STORE)
}

/** Insert or replace one subject's progress record. */
export function putProgress(record) {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    store.put(record)
    return { value: record }
  })
}

/** Remove all progress records (used by "reset" / tests). */
export function clearProgress() {
  return tx(PROGRESS_STORE, 'readwrite', (store) => {
    store.clear()
    return { value: undefined }
  })
}

/** Drop the cached connection so a fresh `indexedDB` global is picked up (tests). */
export function _resetForTests() {
  dbPromise = null
}
