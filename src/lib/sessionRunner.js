// Session runner state machine — Phase 3 of #79.
//
// Drives a built session through to completion: step through the planned
// exercises, collect the ones answered wrong, then repeat just those until none
// remain, and finally produce a summary. It also supports skipping a whole
// modality (listening / speaking) mid-session, backfilling the skipped
// exercises with replacements.
//
// Pure and framework-free: a plain state object plus reducer-style functions
// that mutate it in place. The Vue view wraps the state in `reactive()` so the
// mutations drive the UI, and the same functions are unit-tested directly.
//
// An "exercise" here is an opaque descriptor that must carry at least:
//   { id: string|number, dimension: string, practiceIndex: number }
// (see exerciseBuild.js for the concrete shape).
//
// A descriptor may also be **non-graded** (`graded: false`) — an intro card
// (#587) is a step the learner walks through, not something they can get wrong.
// Those move on via `advance()` rather than `submit()`, and never enter
// `firstAttempt`, so they cannot dilute the session's accuracy.

/** Create the initial runner state for a list of planned exercises. */
export function initRunner(exercises = []) {
  const plan = exercises.slice()
  return {
    plan, // the original planned exercises (immutable order)
    queue: plan.slice(), // exercises remaining in the current round
    pos: 0, // index into queue
    round: 1, // 1 = planned pass; >1 = repeat-mistakes rounds
    wrong: [], // exercises answered wrong this round (next round's queue)
    firstAttempt: {}, // exercise id → was the first attempt correct
    // Non-graded steps already walked past. Kept apart from `firstAttempt` so
    // the summary can't see them, but the progress bar can (they are real steps
    // and a cell that never fills would look stuck).
    visited: [],
    log: [], // every submission: { id, correct, round }
    skipped: [], // dimensions the learner chose to skip
    phase: plan.length ? 'exercise' : 'summary',
  }
}

/** The exercise currently in front of the learner, or null at the summary. */
export function currentExercise(s) {
  return s.phase === 'exercise' ? (s.queue[s.pos] ?? null) : null
}

/** Move to the next round (repeat the wrong ones) or finish the session. */
function advanceRound(s) {
  if (s.wrong.length === 0) {
    s.phase = 'summary'
    s.queue = []
    s.pos = 0
    return
  }
  s.queue = s.wrong.slice()
  s.wrong = []
  s.pos = 0
  s.round++
}

/**
 * Record the result of the current exercise and advance. Wrong answers are
 * re-queued for a later round; the loop ends once a whole round passes clean.
 *
 * `requeue: false` records the result (so the summary and progress bar stay
 * honest) but does not re-queue the exercise even when it was wrong. Flashcard
 * boards use this: their misses are collected at word granularity and replayed
 * as one combined board at the end, rather than replaying whole boards (#472).
 * @returns {object} the same (mutated) state
 */
export function submit(s, correct, { requeue = true } = {}) {
  const ex = currentExercise(s)
  if (!ex) return s
  if (!(ex.id in s.firstAttempt)) s.firstAttempt[ex.id] = !!correct
  s.log.push({ id: ex.id, correct: !!correct, round: s.round })
  if (!correct && requeue) s.wrong.push(ex)
  s.pos++
  if (s.pos >= s.queue.length) advanceRound(s)
  return s
}

/**
 * Step past the current exercise without logging a result or re-queueing it —
 * the way through the machine for a non-graded step (an intro card, #587).
 * Nothing is written to `firstAttempt`, so `runnerSummary()` percentages are
 * exactly what they would have been without the card.
 * @returns {object} the same (mutated) state
 */
export function advance(s) {
  const ex = currentExercise(s)
  if (!ex) return s
  if (!s.visited.includes(ex.id)) s.visited.push(ex.id)
  s.pos++
  if (s.pos >= s.queue.length) advanceRound(s)
  return s
}

/**
 * Start an extra round from a fresh set of exercises, reviving the session if it
 * had reached the summary. Used to append the combined flashcard-repeat board
 * once the planned pass (and any normal repeats) are done (#472). No-op when the
 * list is empty. The exercises are not added to the plan — like every repeat
 * round they sit outside the first-pass progress bar.
 * @returns {object} the mutated state
 */
export function startExtraRound(s, exercises = []) {
  const list = (exercises ?? []).filter(Boolean)
  if (!list.length) return s
  s.queue = list
  s.pos = 0
  s.wrong = []
  s.round++
  s.phase = 'exercise'
  return s
}

/**
 * Skip a whole modality for the rest of the session. Not-yet-attempted
 * exercises of that dimension in the current round are replaced (via
 * `makeReplacement(ex)`, which may return null to simply drop them), and any
 * already-collected wrong ones of that dimension are discarded.
 * @returns {object} the mutated state
 */
export function skipDimension(s, dimension, makeReplacement = () => null) {
  if (s.skipped.includes(dimension)) return s
  s.skipped.push(dimension)

  for (let i = s.pos; i < s.queue.length; i++) {
    if (s.queue[i].dimension !== dimension) continue
    const original = s.queue[i]
    const rep = makeReplacement(original)
    // Keep the plan in sync so the segmented progress bar stays consistent, but
    // only for items not yet attempted — an item being repeated has already had
    // its plan cell marked and must keep that status.
    const attempted = original.id in s.firstAttempt
    const planIdx = s.plan.findIndex((e) => e.id === original.id)
    // makeReplacement may return a single exercise, an array (e.g. a match
    // board expanded into individual type exercises), or null to drop the item.
    const reps = rep == null ? [] : Array.isArray(rep) ? rep : [rep]
    if (reps.length) {
      s.queue.splice(i, 1, ...reps)
      if (!attempted && planIdx !== -1) s.plan.splice(planIdx, 1, ...reps)
      i += reps.length - 1
    } else {
      s.queue.splice(i, 1)
      i--
      if (!attempted && planIdx !== -1) s.plan.splice(planIdx, 1)
    }
  }
  s.wrong = s.wrong.filter((e) => e.dimension !== dimension)

  // Dropping items may have emptied (or already passed the end of) the round.
  if (s.phase === 'exercise' && s.pos >= s.queue.length) advanceRound(s)
  return s
}

/** Total planned exercises (the first-pass denominator). */
export function plannedTotal(s) {
  return s.plan.length
}

/** Fraction of the first (planned) pass completed, 0..1. */
export function firstPassProgress(s) {
  if (s.plan.length === 0) return 1
  return s.round === 1 ? Math.min(1, s.pos / s.plan.length) : 1
}

/** Are we past the planned pass, repeating mistakes? */
export function isRepeating(s) {
  return s.round > 1 && s.phase === 'exercise'
}

/** Exercises left in the current round (including the current one). */
export function remainingInRound(s) {
  return Math.max(0, s.queue.length - s.pos)
}

/**
 * Group the plan into its practices, marking each exercise's status, so the UI
 * can draw a progress bar segmented by practice and by exercise.
 * @returns {Array<{practiceIndex, exercises: Array<{id, done, correct}>}>}
 */
export function practiceSegments(s) {
  const byPractice = new Map()
  for (const ex of s.plan) {
    const pi = ex.practiceIndex ?? 0
    if (!byPractice.has(pi)) byPractice.set(pi, [])
    byPractice.get(pi).push({
      id: ex.id,
      // A walked-past non-graded step is done, but never right or wrong.
      done: ex.id in s.firstAttempt || s.visited.includes(ex.id),
      correct: s.firstAttempt[ex.id] ?? null,
    })
  }
  return [...byPractice.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([practiceIndex, exercises]) => ({ practiceIndex, exercises }))
}

/** Summary of the session: total distinct exercises, first-attempt correct, %. */
export function runnerSummary(s) {
  const ids = Object.keys(s.firstAttempt)
  const total = ids.length
  const correct = ids.filter((id) => s.firstAttempt[id]).length
  const percent = total ? Math.round((correct / total) * 100) : 0
  return { total, correct, percent }
}
