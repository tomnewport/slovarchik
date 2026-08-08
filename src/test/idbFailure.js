// Inducing IndexedDB write failures in tests (#535).
//
// `idb.js` owns the transactions it creates, so the only way to fail one the
// way a browser would — quota exhausted, a corrupt store — is from the
// `IDBDatabase` prototype underneath it. A request whose `error` event goes
// unhandled aborts its whole transaction, and that abort is precisely the
// failure the stores' error handling is written against: `recordAttempt`
// rejects so `SessionView` can surface it, while the streak's `saveMeta`
// swallows its rejection so a lost write never reaches the learner.

const DB_NAME = 'slovarchik'

/** The shared `IDBDatabase` prototype, reached through a throwaway connection. */
async function databasePrototype(dbName) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const proto = Object.getPrototypeOf(db)
  db.close()
  return proto
}

/**
 * Make readwrite transactions abort with a `ConstraintError`.
 *
 * Open the database first (any `idb` call does it) — this attaches to the
 * existing one rather than creating a storeless v1. Pass `stores` to break only
 * some of them, so a test can fail the meta writes while the progress writes
 * still commit. Returns a restore function; call it from a `finally`.
 */
export async function failWrites({ dbName = DB_NAME, stores = null } = {}) {
  const proto = await databasePrototype(dbName)
  const original = proto.transaction
  proto.transaction = function (storeName, mode) {
    const transaction = original.call(this, storeName, mode)
    if (mode === 'readwrite' && (!stores || stores.includes(storeName))) {
      const store = transaction.objectStore(storeName)
      // Every store here is keyed by a single in-line path, so one duplicate
      // key works for all of them.
      const duplicate = { [store.keyPath]: '__idb-failure__' }
      store.add(duplicate)
      store.add(duplicate) // ConstraintError → aborts the whole transaction
    }
    return transaction
  }
  return () => {
    proto.transaction = original
  }
}
