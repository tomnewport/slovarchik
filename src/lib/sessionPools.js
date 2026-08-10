// Pure session-assembly engine, extracted from stores/progress.js so the
// non-trivial pool building and weakness weighting — which words each 25/25/50
// bucket draws from, how per-dimension practice weights are boosted toward what
// still blocks batch completion — is unit-testable without the reactive store.
//
// Framework-free (no Vue, no IndexedDB): the store hands in a plain snapshot
// (`records`, the two batches, the at-risk/lost key lists, and a `wordRecord`
// resolver); this module derives `events`/`stateOf` itself from the same pure
// progression model the store uses, so behaviour is identical.

import {
  STATES,
  DIMENSIONS,
  applicableDimensions,
  wordState,
  dimensionProgress,
  dimensionAdvancesAt,
  borderlineDimensions,
  lastAttemptAt,
  levelGapByDimension,
} from './progression.js'
import { wordOverdueness } from './schedule.js'
import { buildSession } from './session.js'
import { practicesForSession } from './practices.js'

// How many of each word's most recent attempts feed the dimension-weakness
// weighting (applied per word, then aggregated across all words).
export const WEAKNESS_WINDOW = 40
// Scale from a dimension's remaining criteria gap to its session weight. At a
// gap of one this reproduces the historical flat boost of 2; larger gaps scale
// linearly above it, so practice concentrates on the furthest-from-done.
export const GAP_WEIGHT = 2

const rank = (stateName) => STATES.indexOf(stateName)

/** Target state a word must reach for a batch of the given level to count it. */
function batchTarget(level) {
  return level === 'mastery' ? 'mastered' : 'learned'
}

/**
 * Wrap a plain store snapshot with the derived `events`/`stateOf` accessors the
 * pool builders need. `wordRecord(key)` resolves a key to its vocab record
 * (folding the learner's "known" flag) — supplied by the store.
 */
export function makeContext({ records, wordRecord, learning, mastery, atRisk, lost }) {
  const events = (k) => records[k]?.events ?? []
  const stateOf = (k) => wordState(events(k), wordRecord(k))
  return { records, wordRecord, learning, mastery, atRisk, lost, events, stateOf }
}

/**
 * Per-dimension weakness weights from recent attempts: a dimension the learner
 * gets wrong (or has barely practised) is weighted up so sessions favour it.
 */
export function dimensionWeakness(records, window = WEAKNESS_WINDOW) {
  const recent = {}
  for (const d of DIMENSIONS) recent[d] = { total: 0, correct: 0 }
  for (const rec of Object.values(records)) {
    for (const e of rec.events.slice(-window)) {
      const bucket = recent[e.dimension]
      if (!bucket) continue
      bucket.total++
      if (e.correct) bucket.correct++
    }
  }
  const weakness = {}
  for (const d of DIMENSIONS) {
    const { total, correct } = recent[d]
    const accuracy = total ? correct / total : 0
    // Lower accuracy (and untested dimensions) get more weight.
    weakness[d] = Math.max(0.05, 1 - accuracy)
  }
  return weakness
}

/**
 * How well a word is understood, lowest (worst) first. Counts the learning-level
 * dimension criteria it meets and adds its recent accuracy as a tiebreaker, so
 * the least-understood words sort to the front of the current pool.
 */
export function understanding(ctx, key) {
  const evs = ctx.events(key)
  const word = ctx.wordRecord(key)
  let met = 0
  // Count only the dimensions this word is actually graded on, so a word whose
  // speaking is waived isn't treated as perpetually one dimension short.
  for (const dim of applicableDimensions('learning', word)) {
    if (dimensionProgress(evs, 'learning', dim, word).met) met++
  }
  const recent = evs.slice(-WEAKNESS_WINDOW)
  const accuracy = recent.length ? recent.filter((e) => e.correct).length / recent.length : 0
  return met + accuracy
}

/**
 * Words in the current batches that have not yet reached their target, ordered
 * worst-understood first. The exercise builder front-biases the current bucket,
 * so this ordering makes the half-learn time favour the worst-understood word.
 */
export function currentPool(ctx) {
  const out = []
  for (const level of ['learning', 'mastery']) {
    const batch = ctx[level]
    if (!batch) continue
    const target = rank(batchTarget(level))
    for (const key of batch.words) if (rank(ctx.stateOf(key)) < target) out.push(key)
  }
  // Words that have slipped below `learned` need re-learning, but they fall
  // through every other pool: the reinforce pools (at-risk / untested) keep only
  // learned-or-better words, and a slipped word is usually no longer in any
  // committed batch. Fold them into the current batch so they get tested again
  // instead of sitting in `lost` forever. They sort to the front via
  // `understanding`, so they get the most practice.
  for (const key of ctx.lost) if (rank(ctx.stateOf(key)) < rank('learned')) out.push(key)
  // A word that failed its confirmation review (#313) is still `learned` by
  // criteria but demonstrably not retained overnight — fold it back into the
  // current pool for focused re-drilling until a later spaced review confirms it.
  for (const [key, rec] of Object.entries(ctx.records)) {
    if (rec.confirmedAt == null && rec.confirmFailedAt != null && rank(ctx.stateOf(key)) >= rank('learned')) {
      out.push(key)
    }
  }
  // Fall back to anything actively being learned if no batch is committed.
  if (out.length === 0) {
    for (const k of Object.keys(ctx.records)) if (ctx.stateOf(k) === 'learning') out.push(k)
  }
  return [...new Set(out)].sort((a, b) => understanding(ctx, a) - understanding(ctx, b))
}

/**
 * At-risk + lost words — the reinforcement priorities. Restricted to words
 * currently learned or mastered: the refresh half of a session is for retaining
 * words already known, not for words still being learned.
 */
export function reinforcePool(ctx) {
  return [...new Set([...ctx.atRisk, ...ctx.lost])].filter(
    (k) => rank(ctx.stateOf(k)) >= rank('learned'),
  )
}

/**
 * The due pool (#313): learned/mastered words ordered by how overdue their
 * scheduled review is — the word whose weakest dimension is closest to being
 * forgotten first, not merely the least-recently-tested. Records that predate
 * the scheduler fall back to last-attempt recency. Like {@link reinforcePool},
 * this refresh pool excludes words still being learned.
 */
export function duePool(ctx, now = Date.now()) {
  const scored = Object.keys(ctx.records)
    .filter((k) => rank(ctx.stateOf(k)) >= rank('learned'))
    .map((k) => [k, wordOverdueness(ctx.records[k]?.schedule, lastAttemptAt(ctx.events(k)), now)])
  return scored.sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/**
 * True when the mastery batch exists and has at least one word that has not yet
 * been mastered AND can still make progress today. Mastery-level practices are
 * only included in sessions when this is true, so a learner is never presented
 * with mastery exercises before they have words actively being mastered — nor
 * once every remaining criterion is day-blocked (#313).
 */
export function masteryBatchActive(ctx, now = Date.now()) {
  const batch = ctx.mastery
  if (!batch) return false
  const target = rank(batchTarget('mastery'))
  return batch.words.some((key) => {
    if (rank(ctx.stateOf(key)) >= target) return false
    const evs = ctx.events(key)
    return applicableDimensions('mastery', ctx.wordRecord(key)).some((d) =>
      dimensionAdvancesAt(evs, 'mastery', d, now, ctx.wordRecord(key)),
    )
  })
}

/**
 * Assemble a session plan from a plain store snapshot. Returns the Phase-1
 * session (practices tagged with their 25/25/50 bucket, weighted to the weakest
 * dimension) augmented with the candidate word pool for each bucket so the
 * session runner can draw exercises.
 *
 * @param snapshot the store snapshot passed to {@link makeContext}
 * @param opts `{ type, size, focusKeys, now }`
 */
export function assembleSession(
  snapshot,
  { type = 'standard', size, focusKeys = null, now = Date.now() } = {},
  rng = Math.random,
) {
  const ctx = makeContext(snapshot)
  const focusSet = focusKeys ? new Set(focusKeys) : null
  // Which learned/mastered words are borderline in which (level, dimension) —
  // the de-risking targets. A word only leaves the at-risk list after a correct
  // answer in exactly the (level, dimension) whose last attempt was wrong, so
  // the practice weighting and word pools below both steer to these pairs.
  const riskByDim = { learning: new Map(), mastery: new Map() }
  for (const key of Object.keys(ctx.records)) {
    if (rank(ctx.stateOf(key)) < rank('learned')) continue
    if (focusSet && !focusSet.has(key)) continue
    for (const { level, dimension } of borderlineDimensions(ctx.events(key), ctx.wordRecord(key))) {
      const dims = riskByDim[level]
      if (!dims.has(dimension)) dims.set(dimension, [])
      dims.get(dimension).push(key)
    }
  }
  // Restrict to learning-level practices when there is neither an active
  // mastery batch nor a word at risk at the mastery level — but only if that
  // leaves at least one eligible practice (e.g. a grammar session has no
  // learning-level practices and would otherwise become empty). Mastery-risky
  // words keep mastery practices in play because only a mastery-level drill can
  // de-risk them: a mastered word never re-enters a mastery batch, so without
  // this it would stay at risk forever.
  const hasLearningPractices = practicesForSession(type).some((p) => p.level === 'learning')
  const masteryActive = masteryBatchActive(ctx, now) || riskByDim.mastery.size > 0
  const levels = !masteryActive && hasLearningPractices ? ['learning'] : null
  // Weakness is computed *per level* so the two levels never steal each other's
  // practice-selection probability. Both start from the same global per-dimension
  // accuracy, then each level boosts only the dimensions still blocking its own
  // words. Crucially the mastery boost (e.g. lifting `identification` to fund the
  // inflection word-bank) lands only in the mastery map, so it can't pull an
  // identification drill into a learning slot whose word finished identification
  // long ago — which previously halved the share of usage drills the unlearned
  // current-batch words actually need.
  const learningWeakness = dimensionWeakness(ctx.records)
  const masteryWeakness = dimensionWeakness(ctx.records)
  // Boost dimensions still unmet for current-pool words so sessions stay
  // targeted at what's blocking batch completion, not just the global accuracy
  // average (which masks remaining gaps when most words are learned). The boost
  // is *proportional* to each dimension's remaining criteria gap — the best-case
  // count of correct answers the current pool still owes there — so a dimension
  // blocking twenty words is weighted far above one blocking a single word. A
  // flat boost (its predecessor) treated those alike, which let slow,
  // one-word-per-exercise dimensions (speaking, spelling) trail the blanket ones
  // (a matching or listening board clears ~ten words at once) indefinitely:
  // every dimension read as merely "unmet" and split the budget evenly, so the
  // furthest-behind never got the extra practice it needed to catch up. Now
  // whichever dimension is furthest from done keeps the largest gap and so the
  // most practice, until it catches up and the weighting rebalances itself.
  const learningGap = levelGapByDimension(
    currentPool(ctx).map((key) => ({ events: ctx.events(key), word: ctx.wordRecord(key) })),
    'learning',
  )
  for (const [d, need] of Object.entries(learningGap)) {
    learningWeakness[d] = Math.max(learningWeakness[d], need * GAP_WEIGHT)
  }
  // Likewise boost dimensions still unmet at the *mastery* level for the words
  // currently being mastered. Without this, a near-complete mastery batch can
  // stall on its last word: if the dimension that word still needs (e.g. the
  // inflection word-bank for identification) has high global accuracy, its
  // weakness weight collapses to ~0 and the practice that would finish the word
  // is almost never chosen.
  // A dimension only earns the boost when a correct answer *today* would move
  // some word forward. One whose every needing word is day-blocked (#313 — the
  // remaining requirement is a correct answer on another calendar day) is
  // instead zeroed, so its practices become a last resort rather than eating
  // session slots that cannot progress until tomorrow.
  if (ctx.mastery) {
    const needed = new Set()
    const advanceable = new Set()
    for (const key of ctx.mastery.words) {
      if (ctx.stateOf(key) !== 'learned') continue
      const evs = ctx.events(key)
      for (const d of applicableDimensions('mastery', ctx.wordRecord(key))) {
        if (dimensionProgress(evs, 'mastery', d, ctx.wordRecord(key)).met) continue
        needed.add(d)
        if (dimensionAdvancesAt(evs, 'mastery', d, now, ctx.wordRecord(key))) advanceable.add(d)
      }
    }
    for (const d of needed) {
      masteryWeakness[d] = advanceable.has(d) ? Math.max(masteryWeakness[d], 2) : 0
    }
  }
  // Dimensions with mastery-level at-risk words always earn a boost (applied
  // after the day-blocking zeroing above): a correct answer there de-risks the
  // word today, so the dimension is never day-blocked.
  for (const [d, keys] of riskByDim.mastery) {
    if (keys.length) masteryWeakness[d] = Math.max(masteryWeakness[d] ?? 0, 2)
  }
  const weakness = { learning: learningWeakness, mastery: masteryWeakness }
  // At-risk slots get their own weights, proportional to how many words are at
  // risk in each dimension, so the slot's practice lands on a drill that can
  // actually de-risk something instead of one whose recent history is clean.
  if (riskByDim.learning.size > 0) {
    const atRiskWeakness = {}
    for (const d of DIMENSIONS) atRiskWeakness[d] = riskByDim.learning.get(d)?.length ?? 0
    weakness.atRisk = atRiskWeakness
  }
  const session = buildSession({ type, size, weakness, rng, levels })
  let pools
  if (focusKeys) {
    // Focused session: every bucket is restricted to the filtered words, which
    // also become the "current" focus.
    const set = new Set(focusKeys)
    pools = {
      atRisk: reinforcePool(ctx).filter((k) => set.has(k)),
      untested: duePool(ctx, now).filter((k) => set.has(k)),
      current: [...focusKeys],
    }
  } else {
    // The `untested` bucket keeps its historical name in the session shape, but
    // it is fed by the scheduler's due queue (most-overdue first) — this is the
    // refresh half that makes the practice spaced repetition (#313).
    pools = { atRisk: reinforcePool(ctx), untested: duePool(ctx, now), current: currentPool(ctx) }
  }
  const masterySet = ctx.mastery ? new Set(ctx.mastery.words) : null
  for (const practice of session.practices) {
    const bucketPool = pools[practice.bucket] ?? []
    // When a non-current bucket pool is empty (e.g. no at-risk words yet),
    // fall back to the current batch pool so exercises stay within known
    // vocabulary rather than drawing random unknown words as filler.
    let base = bucketPool.length > 0 ? bucketPool : pools.current
    // An at-risk slot narrows to the words at risk in ITS dimension — a correct
    // answer in any other dimension cannot de-risk them. When no word is at
    // risk in this dimension the slot keeps the wider reinforce pool.
    if (practice.bucket === 'atRisk' && practice.level === 'learning') {
      const risky = riskByDim.learning.get(practice.dimension) ?? []
      if (risky.length) base = risky
    }
    const masteryRisky = riskByDim.mastery.get(practice.dimension) ?? []
    if (practice.level === 'mastery' && (masterySet || masteryRisky.length)) {
      // Mastery-level practices must only draw from the mastery batch to avoid
      // recording mastery-level events on non-batch words (which corrupts their
      // progression state — see exerciseBuild.buildInflect for the same guard
      // on the top-up path) — plus the words at risk in this dimension: those
      // already carry a met mastery criterion, so further mastery attempts are
      // safe, and a correct one is the only thing that de-risks them.
      const riskySet = new Set(masteryRisky)
      const batchWords = masterySet ? base.filter((k) => masterySet.has(k)) : []
      const candidates = [...new Set([...batchWords, ...masteryRisky])]
      // Prefer words this practice's dimension can still advance today: a word
      // whose criterion is met, or day-blocked (#313 — it just needs another
      // calendar day), gains nothing from more drilling now. An at-risk word
      // always counts as advanceable — its criterion is met, so
      // dimensionAdvancesAt says no, but a correct answer still moves it (off
      // the at-risk list). Fall back to every candidate when nothing can
      // advance (e.g. an all-mastery grammar session with everything blocked)
      // so the session still has content.
      const advancing = candidates.filter(
        (k) =>
          riskySet.has(k) ||
          dimensionAdvancesAt(ctx.events(k), 'mastery', practice.dimension, now, ctx.wordRecord(k)),
      )
      practice.pool = advancing.length > 0 ? advancing : candidates
    } else if (practice.bucket === 'current' && practice.level === 'learning') {
      // The current bucket is the *advance* half of the session: its job is to
      // push unlearned words toward `learned`. The pool is ordered
      // worst-understood first, but `understanding` is a whole-word score — it
      // says nothing about the dimension this slot actually drills. Without the
      // narrowing below, a word that is weak overall but has long since met its
      // usage criterion still outranks a word that has never been spelled at
      // all, so spelling slots keep landing on words spelling cannot move. Keep
      // only the words this slot's dimension can still advance (the same
      // treatment mastery slots already get above), preserving the
      // worst-understood-first order so the front bias still favours the words
      // that need the most work. Falls back to the whole pool when every word
      // has met this dimension, so the slot always has content.
      const advancing = base.filter((k) =>
        dimensionAdvancesAt(ctx.events(k), 'learning', practice.dimension, now, ctx.wordRecord(k)),
      )
      practice.pool = advancing.length > 0 ? advancing : base
    } else {
      practice.pool = base
    }
  }
  return { ...session, focusKeys: focusKeys ?? null, pools }
}
