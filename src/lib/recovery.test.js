import { describe, it, expect } from 'vitest'

import { recoveryPlan, repairLevel } from './recovery.js'

const DAY = 86400000
const ev = (dimension, level, correct, ts) => ({ dimension, level, correct, ts })

/** Enough correct answers to satisfy a level's criteria, spread over two days. */
const met = (level, dims) =>
  dims.flatMap((d, i) => [
    ev(d, level, true, DAY * 10 + i),
    ev(d, level, true, DAY * 13 + i),
    ev(d, level, true, DAY * 14 + i),
  ])

const LEARNING = ['identification', 'usage', 'hearing', 'speaking']
const MASTERY = ['identification', 'usage', 'context']

/** An inflecting noun with a phrase-completion drill: every criterion applies. */
const noun = { pos: 'noun', hasInflections: true, hasContextDrill: true }
const fully = [...met('learning', LEARNING), ...met('mastery', MASTERY)]
const NOW = DAY * 20

describe('repairLevel', () => {
  it('picks the lower level when both owe something', () => {
    expect(repairLevel([ev('identification', 'learning', true, 1)], noun)).toBe('learning')
  })

  it('picks mastery when only mastery owes something', () => {
    expect(repairLevel(met('learning', LEARNING), noun)).toBe('mastery')
  })

  it('never picks mastery for a word with no inflection table', () => {
    const flat = { pos: 'adverb', hasInflections: false }
    expect(repairLevel(met('learning', LEARNING), flat)).toBe('learning')
  })
})

describe('recoveryPlan', () => {
  it('names the drop and prices the repair for a word that slipped out of mastery', () => {
    const events = [...fully, ev('usage', 'mastery', false, NOW), ev('usage', 'mastery', false, NOW + 1)]
    const plan = recoveryPlan(events, noun, { peak: 'mastered', state: 'learned', now: NOW + 2 })

    expect(plan.status).toBe('slipped')
    expect(plan.from).toBe('Mastered')
    expect(plan.to).toBe('Learned')
    // Only the skill that actually broke is asked for — the two mastery
    // dimensions still met contribute nothing.
    expect(plan.steps.map((s) => s.dimension)).toEqual(['usage'])
    expect(plan.steps[0]).toMatchObject({ level: 'mastery', kind: 'recover', need: 2 })
    expect(plan.steps[0].text).toBe('2 correct answers')
    expect(plan.total).toBe(2)
    expect(plan.headline).toBe('Slipped from Mastered back to Learned — 2 correct answers to go')
  })

  it('accepts the stored numeric peak rank as well as a state name', () => {
    const events = [ev('identification', 'learning', true, 1)]
    // 2 is `learned` in STATES — the rank the store keeps on each record.
    expect(recoveryPlan(events, noun, { peak: 2, state: 'learning', now: NOW }).from).toBe('Learned')
  })

  it('asks for one correct answer in exactly the dimension riding on a miss', () => {
    const events = [...fully, ev('hearing', 'learning', false, NOW)]
    const plan = recoveryPlan(events, noun, { peak: 'mastered', state: 'mastered', now: NOW + 1 })

    expect(plan.status).toBe('at-risk')
    expect(plan.from).toBeNull()
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({ level: 'learning', dimension: 'hearing', kind: 'defend', need: 1 })
    expect(plan.headline).toBe('One wrong answer from slipping — Hearing is riding on a miss')
    // The row's pips follow the plan, so they must show the level the risk is
    // at — not the level the word's *state* would suggest (mastery, here).
    expect(plan.level).toBe('learning')
  })

  it('says when the missing piece is another day, not another answer (#313)', () => {
    // Two correct mastery answers, both today: the ratio is satisfied and only
    // the day-spacing rule is outstanding, which no amount of practice now can
    // clear.
    const events = [
      ...met('learning', LEARNING),
      ...MASTERY.flatMap((d) => [ev(d, 'mastery', true, NOW), ev(d, 'mastery', true, NOW + 1)]),
    ]
    const plan = recoveryPlan(events, noun, { peak: 'mastered', state: 'learned', now: NOW + 2 })
    expect(plan.steps).toHaveLength(3)
    expect(plan.steps.every((s) => s.anotherDay)).toBe(true)
    expect(plan.steps[0].text).toBe('1 correct answer, tomorrow at the earliest')
  })

  it('counts a speaking shortfall in attempts, which need not be correct', () => {
    const plan = recoveryPlan([ev('speaking', 'learning', false, 1)], noun, { now: NOW })
    const speaking = plan.steps.find((s) => s.dimension === 'speaking')
    expect(speaking.text).toBe('2 attempts')
  })

  it('reports a word that is neither slipped nor borderline as steady', () => {
    const plan = recoveryPlan(fully, noun, { peak: 'mastered', state: 'mastered', now: NOW })
    expect(plan.status).toBe('steady')
    expect(plan.steps).toEqual([])
    expect(plan.headline).toBe('Every criterion met')
  })

  it('honours the relaxed criteria of a word the learner flagged as known', () => {
    const known = { ...noun, known: true }
    const events = [...met('learning', LEARNING), ...met('mastery', MASTERY), ev('usage', 'mastery', false, NOW)]
    const plan = recoveryPlan(events, known, { peak: 'mastered', state: 'learned', now: NOW + 1 })
    // One correct answer is the whole of the known-word criterion.
    expect(plan.steps.find((s) => s.dimension === 'usage').need).toBe(1)
  })

  it('leaves the context requirement out for a word with no phrase drill', () => {
    const noPhrase = { pos: 'noun', hasInflections: true, hasContextDrill: false }
    const plan = recoveryPlan(met('learning', LEARNING), noPhrase, {
      peak: 'mastered',
      state: 'learned',
      now: NOW,
    })
    expect(plan.steps.map((s) => s.dimension)).toEqual(['identification', 'usage'])
  })
})
