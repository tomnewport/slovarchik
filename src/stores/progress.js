// Reactive progression store: the one place the whole app records attempts and
// reads back rankings. Recording stores nothing but the subject and a graded
// event (see lib/progress.js); facets like gender and case are derived on demand
// from the live vocab, so this stays a thin, persistence-backed wrapper around
// the pure model.
import { computed, ref } from 'vue'

import { state as vocabState } from './vocab.js'
import * as idb from '../lib/idb.js'
import {
  applyEvent,
  combined,
  describeStat,
  emptyStat,
  mistakenByFacet,
  mostMistakenCollections,
  mostMistakenForms,
  mostMistakenWords,
  subjectId,
} from '../lib/progress.js'

// Plain (non-reactive) backing map of subject id -> stored stat record. We keep
// it plain so records persist to IndexedDB cleanly (no Vue proxies to clone) and
// expose reactivity through a revision counter that query consumers depend on.
const stats = new Map()
const revision = ref(0)
let loaded = false

/** Load every stored attempt history into memory. Safe to call more than once. */
export async function initProgress() {
  if (loaded) return
  loaded = true
  try {
    for (const record of await idb.getAllProgress()) stats.set(record.id, record)
    revision.value += 1
  } catch {
    // No cache yet (or storage unavailable): start from an empty history.
  }
}

/**
 * Record one graded attempt at a subject. Best-effort and non-blocking: the
 * in-memory tally always updates so drills can fire-and-forget, and a failed
 * write (e.g. private-mode storage) is swallowed rather than breaking the drill.
 * @param {{kind: string, key: string, slot?: string}} subject
 * @param {number} grade  a GRADES value
 * @param {number} [at]   event timestamp (epoch ms)
 * @returns {object} the updated stat record
 */
export function record(subject, grade, at = Date.now()) {
  const id = subjectId(subject)
  const updated = applyEvent(stats.get(id) ?? emptyStat(subject), grade, at)
  stats.set(id, updated)
  revision.value += 1
  Promise.resolve()
    .then(() => idb.putProgress(updated))
    .catch(() => {})
  return updated
}

/** Current vocab keyed by natural key, for resolving a subject's facets. */
const wordsByKey = computed(() => new Map(vocabState.words.map((w) => [w.key, w])))

/**
 * Every tracked subject resolved against the current vocab — the input to the
 * ranking/aggregation helpers below. Recomputes when an attempt is recorded or
 * the vocab changes.
 */
export const describedStats = computed(() => {
  revision.value // track recordings
  const index = wordsByKey.value
  return [...stats.values()].map((record) => describeStat(record, index))
})

// Convenience query wrappers bound to the live data, so callers (and a future
// stats screen) can ask the four headline questions in one line.
export const progressQueries = {
  /** Most mistaken words. */
  words: (opts) => mostMistakenWords(describedStats.value, opts),
  /** Most mistaken individual word-forms. */
  forms: (opts) => mostMistakenForms(describedStats.value, opts),
  /** Rank groups by any facet, e.g. byFacet('gender') or byFacet('case', { kind: 'form' }). */
  byFacet: (facet, opts) => mistakenByFacet(describedStats.value, facet, opts),
  /** Most mistaken collections. */
  collections: (opts) => mostMistakenCollections(describedStats.value, opts),
  /** A single error-rate summary over an arbitrary subset (e.g. nominative neuter forms). */
  combined: (filter) => combined(describedStats.value, filter),
}

/** Drop all in-memory history (tests). */
export function _resetForTests() {
  stats.clear()
  revision.value += 1
  loaded = false
}
