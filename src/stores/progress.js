// Reactive progress store — Phase 2 of #79.
//
// Wires the pure Phase-1 engine (progression / batches / session) into Vue's
// reactivity and IndexedDB. It records every attempt per word per dimension and
// derives all higher-level facts (states, counts, at-risk/lost, current-batch
// completion) from those attempts via the pure model — no progression logic is
// duplicated here.
//
// Persistence: one record per word in the `progress` IndexedDB store, plus the
// two current batches in `meta`. Everything survives reload and works offline.
//
// The implementation lives in `stores/progress/`, split along the section
// banners this file used to carry (#667). This barrel is the public face of the
// store and the only thing consumers import; see `stores/progress/index.js` for
// what each section owns and which way the dependencies point.
export * from './progress/index.js'
