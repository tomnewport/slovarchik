// Writing the store to IndexedDB, and noticing when that fails.
//
// Two kinds of write live here: the awaited per-record `persist`, whose
// rejection the caller is expected to handle, and `saveInBackground`, for the
// fire-and-forget writes on the hot path of a drill.
import * as idb from '../../lib/idb.js'
import { raiseError } from '../errorToast.js'

/**
 * The persisted shape of a record. Nested fields may still be reactive proxies;
 * unwrapping them is the job of whoever serialises the result (`idb.putProgress`
 * on the way to storage, `toPlain` on the way into an export).
 */
export function persistedShape(rec) {
  return {
    word: rec.word,
    events: rec.events.map((e) => ({ ...e })),
    known: !!rec.known,
    learnedAt: rec.learnedAt,
    masteredAt: rec.masteredAt,
    peak: rec.peak ?? 0,
    confirmedAt: rec.confirmedAt ?? null,
    confirmFailedAt: rec.confirmFailedAt ?? null,
    schedule: rec.schedule ?? {},
    agg: rec.agg ?? { firstSeenAt: null, lastSeenAt: null, dims: {} },
    introducedAt: rec.introducedAt ?? null,
    tables: { ...(rec.tables ?? {}) },
  }
}

export function persist(rec) {
  return idb.putProgress(persistedShape(rec))
}

// How many background writes must fail in a row before we tell the learner.
// One toast for a run of failures, not one per answer: exhausted quota fails
// every write, and the message worth delivering is "your progress isn't being
// saved", once.
const PERSIST_FAILURES_BEFORE_TOAST = 3
let consecutivePersistFailures = 0
/** Outstanding background writes, so tests (and `loadProgress`) can settle. */
const pendingPersists = new Set()

/**
 * Fire-and-forget write on the hot path. The rejection is still absorbed rather
 * than rethrown — `idb.js`'s header explains why these must never become
 * unhandled — but it is no longer *discarded*. Before this, a learner whose
 * IndexedDB quota was exhausted lost their streak with no toast, no console
 * warning, and a `currentStreak` that read correctly until the next reload
 * silently reset it to zero (#662).
 */
export function saveInBackground(label, write) {
  const settled = write.then(
    () => {
      consecutivePersistFailures = 0
    },
    (err) => {
      consecutivePersistFailures += 1
      console.warn(`[Slovarchik] could not persist ${label}`, err)
      if (consecutivePersistFailures === PERSIST_FAILURES_BEFORE_TOAST) {
        raiseError(
          new Error(
            "Your progress isn't being saved — this device's storage is full or unavailable.",
          ),
        )
      }
    },
  )
  pendingPersists.add(settled)
  settled.finally(() => pendingPersists.delete(settled))
  return settled
}

/** Await every background write started so far (tests, and reset/import). */
export function persistenceSettled() {
  return Promise.all([...pendingPersists])
}

/** Fire-and-forget meta write — reports failure without rejecting (see above). */
export function saveMeta(key, value) {
  return saveInBackground(key, idb.setMeta(key, value))
}
