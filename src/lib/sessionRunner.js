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
 * @returns {object} the same (mutated) state
 */
export function submit(s, correct) {
  const ex = currentExercise(s)
  if (!ex) return s
  if (!(ex.id in s.firstAttempt)) s.firstAttempt[ex.id] = !!correct
  s.log.push({ id: ex.id, correct: !!correct, round: s.round })
  if (!correct) s.wrong.push(ex)
  s.pos++
  if (s.pos >= s.queue.length) advanceRound(s)
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
    if (rep) {
      s.queue[i] = rep
      if (!attempted && planIdx !== -1) s.plan[planIdx] = rep
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
      done: ex.id in s.firstAttempt,
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
