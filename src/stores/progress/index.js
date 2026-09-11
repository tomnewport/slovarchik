// The progress store, assembled from its sections (#667).
//
// `stores/progress.js` re-exports this module wholesale, so every existing
// consumer — 13 views and components plus main.js, almost all via
// `import * as progress from '../stores/progress.js'` — is unchanged by the
// split.
//
// The sections, and the direction of the dependencies between them:
//
//   state.js        the reactive `state` and the lookups over it — imports
//                   nothing else in here, so everything can import it
//   persistence.js  writing to IndexedDB, and noticing when that fails
//   migrations.js   bringing an older record up to the current shape, in ONE
//                   place, called by both the load path and an import
//   activity.js     streak + activity calendar        → state, persistence
//   records.js      the memo, the derived computeds,
//                   and every path that records an attempt
//                                                     → state, persistence, activity
//   batches.js      the current learning/mastery batches → state, records
//   sessions.js     session assembly and per-word views → state, records
//   analytics.js    the Progress screen's history       → state, records
//   lifecycle.js    load / reset                        → most of the above
//   backup.js       export / import                     → most of the above
//
// No edge points backwards. The memo has exactly one owner (records.js); the
// lifecycle and an import invalidate it through the exported `clearMemo`.

export { state } from './state.js'
export { persistenceSettled } from './persistence.js'
export { hasMet, metCount, markMet, recordEncounter } from './encounters.js'

export {
  stateOf,
  learnedCount,
  masteredCount,
  cefrStats,
  earnedAchievements,
  pendingAchievements,
  acknowledgeAchievements,
  lost,
  atRisk,
  isPendingConfirmation,
  pendingConfirmation,
  recentlyLearned,
  recordAttempt,
  isKnown,
  markKnown,
  unmarkKnown,
  markIntroduced,
  wasIntroduced,
  isTableClean,
  markTableClean,
  hasInflections,
  hasContextDrill,
} from './records.js'

export {
  currentStreak,
  longestStreak,
  dailyRecord,
  totalExercises,
  activityCalendar,
} from './activity.js'

export {
  getBatchOptions,
  autoCommitMasteryBatch,
  ensureMasteryBatch,
  commitBatch,
  batchProgress,
  batchExerciseProgress,
  batchComplete,
  advanceBatch,
  deleteRecord,
  removeFromBatch,
  leaveForLater,
} from './batches.js'

export {
  dimensionWeakness,
  startSession,
  encounterCount,
  hasBeenCorrect,
  wordProgressDetail,
  focusKeysFor,
  weakestSkills,
} from './sessions.js'

export { learnedWords, masteredWords, history } from './analytics.js'

export { loadProgress, resetProgress } from './lifecycle.js'

export { EXPORT_VERSION, exportData, validateImport, importData } from './backup.js'
