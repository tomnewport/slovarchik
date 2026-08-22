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
  advance,
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

  it('expands array replacements inline (e.g. match board → multiple type exercises)', () => {
    const s = initRunner(plan())
    submit(s, true) // a done
    // makeReplacement returns an array of two for the hearing exercise (c)
    skipDimension(s, 'hearing', (e) => [
      ex(`${e.id}-0`, 'usage', e.practiceIndex),
      ex(`${e.id}-1`, 'usage', e.practiceIndex),
    ])
    const ids = s.queue.map((e) => e.id)
    expect(ids).toContain('c-0')
    expect(ids).toContain('c-1')
    expect(ids).not.toContain('c')
    // Progress bar reflects both replacements in the same practice segment.
    const segs = practiceSegments(s)
    const segIds = segs.flatMap((p) => p.exercises.map((e) => e.id))
    expect(segIds).toContain('c-0')
    expect(segIds).toContain('c-1')
    expect(segIds).not.toContain('c')
  })

  it('does not jump to summary when all remaining are match exercises replaced by arrays', () => {
    const matchExercise = { id: 'm', dimension: 'hearing', practiceIndex: 0 }
    const s = initRunner([matchExercise])
    skipDimension(s, 'hearing', (e) => [
      ex(`${e.id}-0`, 'identification', e.practiceIndex),
      ex(`${e.id}-1`, 'identification', e.practiceIndex),
    ])
    expect(s.phase).toBe('exercise')
    expect(s.queue.map((e) => e.id)).toEqual(['m-0', 'm-1'])
  })
})

// ── Non-graded steps (#587) ─────────────────────────────────────────────────
describe('advance (a step the learner cannot get wrong)', () => {
  const card = { id: 'i1', kind: 'intro', graded: false, dimension: 'usage', practiceIndex: 0 }
  const ex = (id) => ({ id, dimension: 'usage', practiceIndex: 0 })

  it('steps past without logging anything', () => {
    const s = initRunner([card, ex('a')])
    advance(s)
    expect(s.log).toEqual([])
    expect(s.firstAttempt).toEqual({})
    expect(currentExercise(s).id).toBe('a')
  })

  it('never re-queues, however the session goes', () => {
    const s = initRunner([card, ex('a')])
    advance(s)
    submit(s, true)
    expect(s.phase).toBe('summary')
  })

  it('leaves the accuracy figures exactly as they would have been', () => {
    const withCard = initRunner([card, ex('a'), ex('b')])
    advance(withCard)
    submit(withCard, true)
    submit(withCard, false)

    const without = initRunner([ex('a'), ex('b')])
    submit(without, true)
    submit(without, false)

    expect(runnerSummary(withCard)).toEqual(runnerSummary(without))
    expect(runnerSummary(withCard).total).toBe(2)
  })

  it('still counts as a planned step, so the progress bar moves', () => {
    const s = initRunner([card, ex('a')])
    expect(plannedTotal(s)).toBe(2)
    advance(s)
    expect(firstPassProgress(s)).toBeCloseTo(0.5)
  })

  it('fills its progress cell — done, but neither right nor wrong', () => {
    const s = initRunner([card, ex('a')])
    advance(s)
    const cells = practiceSegments(s)[0].exercises
    expect(cells[0]).toEqual({ id: 'i1', done: true, correct: null })
    expect(cells[1].done).toBe(false)
  })

  it('reaches the summary when the session is nothing but cards', () => {
    const s = initRunner([card, { ...card, id: 'i2' }])
    advance(s)
    advance(s)
    expect(s.phase).toBe('summary')
    expect(runnerSummary(s)).toEqual({ total: 0, correct: 0, percent: 0 })
  })

  it('is a no-op at the summary', () => {
    const s = initRunner([])
    expect(advance(s)).toBe(s)
    expect(s.phase).toBe('summary')
  })

  it('does not double-count a card walked past twice', () => {
    const s = initRunner([card, ex('a')])
    advance(s)
    s.pos = 0 // contrive a revisit
    advance(s)
    expect(s.visited).toEqual(['i1'])
  })
})
