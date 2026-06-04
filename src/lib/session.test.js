import { describe, it, expect } from 'vitest'
import {
  SESSION_TYPES,
  BUCKETS,
  BUCKET_SHARES,
  sessionSize,
  allocateBuckets,
  buildSession,
  evenWeakness,
  runRepeatMistakes,
  summarize,
} from './session.js'

function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

describe('sessionSize', () => {
  it('standard offers quick / normal / super', () => {
    expect(sessionSize('standard', 'quick')).toBe(4)
    expect(sessionSize('standard', 'normal')).toBe(12)
    expect(sessionSize('standard', 'super')).toBe(20)
  })
  it('standard defaults to normal when no size given', () => {
    expect(sessionSize('standard')).toBe(SESSION_TYPES.standard.sizes.normal)
  })
  it('focused sessions are a fixed four practices', () => {
    for (const type of ['speaking', 'listening', 'words', 'phrases', 'grammar']) {
      expect(sessionSize(type)).toBe(4)
    }
  })
})

describe('allocateBuckets', () => {
  it('splits 25 / 25 / 50 and always sums to size', () => {
    for (const size of [4, 12, 20]) {
      const b = allocateBuckets(size)
      expect(b.atRisk + b.untested + b.current).toBe(size)
    }
    expect(allocateBuckets(4)).toEqual({ atRisk: 1, untested: 1, current: 2 })
    expect(allocateBuckets(12)).toEqual({ atRisk: 3, untested: 3, current: 6 })
    expect(allocateBuckets(20)).toEqual({ atRisk: 5, untested: 5, current: 10 })
  })
  it('the shares are a quarter, a quarter and a half', () => {
    expect(BUCKET_SHARES).toEqual({ atRisk: 0.25, untested: 0.25, current: 0.5 })
    expect(BUCKETS).toEqual(['atRisk', 'untested', 'current'])
  })
})

describe('buildSession', () => {
  it('produces one practice per slot for the requested size', () => {
    const s = buildSession({ type: 'standard', size: 'super', rng: seededRng(1) })
    expect(s.practices).toHaveLength(20)
    expect(s.size).toBe(20)
  })
  it('tags practices with buckets matching the 25/25/50 allocation', () => {
    const s = buildSession({ type: 'standard', size: 'normal', rng: seededRng(2) })
    const counts = { atRisk: 0, untested: 0, current: 0 }
    for (const p of s.practices) counts[p.bucket]++
    expect(counts).toEqual(allocateBuckets(12))
  })
  it('only uses practices eligible for the session type', () => {
    const s = buildSession({ type: 'grammar', rng: seededRng(3) })
    expect(s.practices.every((p) => p.content === 'inflection')).toBe(true)
  })
  it('weights practice choice towards the weakest dimension', () => {
    const weakness = { ...evenWeakness(), usage: 1000 }
    const s = buildSession({ type: 'standard', size: 'super', weakness, rng: seededRng(4) })
    const usage = s.practices.filter((p) => p.dimension === 'usage').length
    expect(usage).toBeGreaterThanOrEqual(15)
  })
})

describe('runRepeatMistakes', () => {
  it('terminates in one round when everything is correct', () => {
    const r = runRepeatMistakes([1, 2, 3], () => true)
    expect(r).toEqual({ rounds: 1, attempts: 3, remaining: 0 })
  })
  it('re-queues wrong items until none remain', () => {
    // Each item is answered correctly only from round 2 onward.
    const r = runRepeatMistakes(['a', 'b', 'c'], (_item, round) => round >= 2)
    expect(r.rounds).toBe(2)
    expect(r.attempts).toBe(6) // 3 wrong in round 1, 3 correct in round 2
    expect(r.remaining).toBe(0)
  })
  it('repeats only the items still wrong, not the whole queue', () => {
    const tries = {}
    // 'hard' needs three attempts; the others pass first time.
    const grade = (item) => {
      tries[item] = (tries[item] ?? 0) + 1
      return item === 'hard' ? tries[item] >= 3 : true
    }
    const r = runRepeatMistakes(['easy1', 'easy2', 'hard'], grade)
    expect(r.rounds).toBe(3)
    expect(r.remaining).toBe(0)
    expect(tries.easy1).toBe(1) // not repeated
    expect(tries.hard).toBe(3)
  })
  it('stops at maxRounds if an item never passes', () => {
    const r = runRepeatMistakes(['x'], () => false, { maxRounds: 5 })
    expect(r.rounds).toBe(5)
    expect(r.remaining).toBe(1)
  })
  it('handles an empty queue', () => {
    expect(runRepeatMistakes([], () => false)).toEqual({ rounds: 0, attempts: 0, remaining: 0 })
  })
})

describe('summarize', () => {
  it('computes percent correct, duration and slipped words', () => {
    const results = [
      { correct: true, word: 'a' },
      { correct: false, word: 'b', slipped: true },
      { correct: true, word: 'c' },
      { correct: false, word: 'b', slipped: true }, // same slipped word again
    ]
    const s = summarize(results, { startedAt: 1000, finishedAt: 4000 })
    expect(s.total).toBe(4)
    expect(s.correct).toBe(2)
    expect(s.percent).toBe(50)
    expect(s.durationMs).toBe(3000)
    expect(s.slipped).toEqual(['b']) // de-duplicated
  })
  it('is safe with no results', () => {
    expect(summarize()).toEqual({ total: 0, correct: 0, percent: 0, durationMs: null, slipped: [] })
  })
})
