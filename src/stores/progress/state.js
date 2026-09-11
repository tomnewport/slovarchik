// The reactive store object itself, and the lookups every other part of the
// store needs to read it.
//
// This module is the floor of `stores/progress/`: it imports from `src/lib/`
// and the vocab store, and from nothing else in here. Everything else in the
// directory imports it, which is what keeps the dependencies between the
// sections one-directional (#667) — `records` → `activity`, `batches` →
// `records`, and so on, with no edge pointing back.
import { computed, reactive } from 'vue'

import { state as vocabState } from '../vocab.js'
import { STATES } from '../../lib/progression.js'
import { learnableWords } from '../../lib/vocabBuild.js'

export const BATCH_META_KEY = (level) => `batch:${level}`

export const state = reactive({
  loaded: false,
  /** word key → { word, events, learnedAt, masteredAt, peak, confirmedAt,
   *  confirmFailedAt, schedule, agg } */
  records: {},
  /** the committed current batches, or null */
  learning: null,
  mastery: null,
  /** epoch ms of first use (for the "how long" stat on the Data screen) */
  firstUseAt: null,
  /** Set of achievement IDs the user has already been notified about. */
  seenAchievements: new Set(),
  /** Achievement ID → epoch ms first earned. Grows only; see `stampEarned`. */
  achievementsEarnedAt: {},
  /** Word key → epoch ms first met in a phrase the learner got right (#675). */
  metWords: {},
  /** day key → { count, correct, hue } — the contribution calendar / streak. */
  activity: {},
  /** Hue (0..359) currently assigned to days; rerolled when the batch changes. */
  streakHue: 0,
  /** Signature of the active batches when the hue was last rerolled. */
  batchSig: '',
})

// ---------------------------------------------------------------------------
// Word lookup (for inflection awareness) — sourced from the vocab store.
// ---------------------------------------------------------------------------

export const wordIndex = computed(() => {
  const map = new Map()
  for (const w of vocabState.words) map.set(w.key, w)
  return map
})

export function wordRecord(key) {
  const base = wordIndex.value.get(key) ?? { key, hasInflections: false }
  // Fold the learner's "I know this word" flag onto the vocab record so the pure
  // progression model applies the relaxed single-answer criteria for it. Only
  // spread when actually known — the common path stays a plain lookup.
  return state.records[key]?.known ? { ...base, known: true } : base
}

// ---------------------------------------------------------------------------
// Core state derivation — all delegated to the pure progression model.
// ---------------------------------------------------------------------------

export function rank(stateName) {
  return STATES.indexOf(stateName)
}

export function events(key) {
  return state.records[key]?.events ?? []
}

/**
 * The learnable slice of the vocab, as its own computed: it depends only on the
 * vocab, so filtering all ~6,700 entries shouldn't be redone every time progress
 * changes underneath a consumer (#531). Shared by the CEFR stats and the
 * encounter log so there is one copy, not one each (#668).
 */
export const learnableVocab = computed(() => learnableWords(vocabState.words))

/** All learnable vocab words as the batch engine expects them. */
export function vocabWords() {
  return learnableWords(vocabState.words)
}
