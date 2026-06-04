import { describe, it, expect } from 'vitest'
import {
  initRunner,
  currentExercise,
  submit,
  skipDimension,
  plannedTotal,
  firstPassProgress,
  isRepeating,
  remainingInRound,
  practiceSegments,
  runnerSummary,
} from './sessionRunner.js'

// Minimal exercise descriptors.
function ex(id, dimension = 'usage', practiceIndex = 0) {
  return { id, dimension, practiceIndex }
}

function plan() {
  return [
    ex('a', 'usage', 0),
    ex('b', 'usage', 0),
    ex('c', 'hearing', 1),
    ex('d', 'speaking', 2),
  ]
}

describe('initRunner', () => {
  it('starts on the first exercise', () => {
    const s = initRunner(plan())
    expect(s.phase).toBe('exercise')
    expect(currentExercise(s).id).toBe('a')
    expect(plannedTotal(s)).toBe(4)
  })
  it('an empty session goes straight to the summary', () => {
    const s = initRunner([])
    expect(s.phase).toBe('summary')
    expect(currentExercise(s)).toBe(null)
  })
})

describe('submit & the repeat-mistakes loop', () => {
  it('advances through the planned pass and finishes when all correct', () => {
    const s = initRunner(plan())
    for (let i = 0; i < 4; i++) submit(s, true)
    expect(s.phase).toBe('summary')
    expect(s.round).toBe(1)
  })

  it('re-queues wrong answers and repeats until none remain', () => {
    const s = initRunner(plan())
    submit(s, true) // a ✓
    submit(s, false) // b ✗
    submit(s, true) // c ✓
    submit(s, false) // d ✗
    // Planned pass done; round 2 repeats b and d.
    expect(isRepeating(s)).toBe(true)
    expect(s.round).toBe(2)
    expect(s.queue.map((e) => e.id)).toEqual(['b', 'd'])

    submit(s, true) // b ✓
    submit(s, false) // d ✗ again
    expect(s.round).toBe(3)
    expect(s.queue.map((e) => e.id)).toEqual(['d'])

    submit(s, true) // d ✓
    expect(s.phase).toBe('summary')
  })

  it('records only the first attempt for the summary', () => {
    const s = initRunner(plan())
    submit(s, false) // a ✗ (first attempt counts)
    submit(s, true) // b
    submit(s, true) // c
    submit(s, true) // d
    submit(s, true) // a ✓ on repeat — does not change first-attempt stats
    const sum = runnerSummary(s)
    expect(sum.total).toBe(4)
    expect(sum.correct).toBe(3)
    expect(sum.percent).toBe(75)
  })
})

describe('progress reporting', () => {
  it('tracks first-pass progress and resets to full once repeating', () => {
    const s = initRunner(plan())
    expect(firstPassProgress(s)).toBe(0)
    submit(s, true)
    submit(s, true)
    expect(firstPassProgress(s)).toBe(0.5)
    submit(s, false)
    submit(s, true)
    // Now repeating (one wrong) — first pass shows complete.
    expect(firstPassProgress(s)).toBe(1)
    expect(remainingInRound(s)).toBe(1)
  })

  it('segments the plan by practice with per-exercise status', () => {
    const s = initRunner(plan())
    submit(s, true) // a
    const segs = practiceSegments(s)
    expect(segs.map((p) => p.practiceIndex)).toEqual([0, 1, 2])
    expect(segs[0].exercises).toHaveLength(2)
    expect(segs[0].exercises[0]).toMatchObject({ id: 'a', done: true, correct: true })
    expect(segs[0].exercises[1]).toMatchObject({ id: 'b', done: false, correct: null })
  })
})

describe('skipDimension', () => {
  it('replaces not-yet-attempted exercises of a skipped modality', () => {
    const s = initRunner(plan())
    submit(s, true) // a done
    // Skip hearing; replace the hearing exercise (c) with a usage backfill.
    skipDimension(s, 'hearing', (e) => ex(`rep-${e.id}`, 'usage', e.practiceIndex))
    expect(s.skipped).toContain('hearing')
    const ids = s.queue.map((e) => e.id)
    expect(ids).toContain('rep-c')
    expect(ids).not.toContain('c')
  })

  it('drops skipped exercises when no replacement is supplied', () => {
    const s = initRunner(plan())
    skipDimension(s, 'speaking') // default makeReplacement → drop
    expect(s.queue.some((e) => e.dimension === 'speaking')).toBe(false)
    expect(s.queue.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('discards already-wrong exercises of the skipped modality', () => {
    const s = initRunner(plan())
    submit(s, true) // a
    submit(s, true) // b
    submit(s, false) // c (hearing) wrong → queued for repeat
    submit(s, true) // d
    // Round 2 would repeat c; skipping hearing should drop it and finish.
    skipDimension(s, 'hearing')
    expect(s.phase).toBe('summary')
  })

  it('keeps the plan in sync so the progress bar reflects replacements', () => {
    const s = initRunner(plan())
    submit(s, true) // a done
    skipDimension(s, 'hearing', (e) => ex(`rep-${e.id}`, 'usage', e.practiceIndex))
    // The hearing exercise (c) was never attempted, so its plan cell becomes
    // the replacement — answering it will flip the segment to done.
    const segs = practiceSegments(s)
    const ids = segs.flatMap((p) => p.exercises.map((e) => e.id))
    expect(ids).toContain('rep-c')
    expect(ids).not.toContain('c')
  })

  it('does not disturb an already-completed plan cell when skipping a repeat', () => {
    const s = initRunner(plan())
    submit(s, true) // a
    submit(s, true) // b
    submit(s, false) // c (hearing) wrong → attempted, queued for repeat
    submit(s, true) // d
    skipDimension(s, 'hearing', (e) => ex(`rep-${e.id}`, 'usage', e.practiceIndex))
    // c stays in the plan (already attempted/done); it is not swapped out.
    const ids = practiceSegments(s).flatMap((p) => p.exercises.map((e) => e.id))
    expect(ids).toContain('c')
  })

  it('is idempotent for a dimension already skipped', () => {
    const s = initRunner(plan())
    skipDimension(s, 'hearing')
    const before = s.queue.length
    skipDimension(s, 'hearing')
    expect(s.queue.length).toBe(before)
  })
})
