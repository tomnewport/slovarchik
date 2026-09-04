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
  it('never rounds the current bucket away in a short session', () => {
    // Refresh buckets round down, so the current batch keeps at least ⌈size/2⌉
    // slots — a one- or two-slot learning portion is spent on the current batch
    // rather than lost to retention.
    expect(allocateBuckets(1)).toEqual({ atRisk: 0, untested: 0, current: 1 })
    expect(allocateBuckets(2)).toEqual({ atRisk: 0, untested: 0, current: 2 })
    expect(allocateBuckets(3)).toEqual({ atRisk: 0, untested: 0, current: 3 })
    expect(allocateBuckets(0)).toEqual({ atRisk: 0, untested: 0, current: 0 })
    for (const size of [1, 2, 3, 5, 6, 9, 10]) {
      const b = allocateBuckets(size)
      expect(b.atRisk + b.untested + b.current).toBe(size)
      expect(b.current).toBeGreaterThanOrEqual(Math.ceil(size / 2))
    }
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
  it('tags learning-only sessions with buckets matching the 25/25/50 allocation', () => {
    const s = buildSession({ type: 'standard', size: 'normal', levels: ['learning'], rng: seededRng(2) })
    const counts = { atRisk: 0, untested: 0, current: 0 }
    for (const p of s.practices) counts[p.bucket]++
    expect(counts).toEqual(allocateBuckets(12))
  })
  it('reserves a third of the session for mastery when both levels are available', () => {
    // Both learning and mastery practices eligible (no `levels` filter).
    const s = buildSession({ type: 'standard', size: 'normal', rng: seededRng(2) })
    expect(s.practices).toHaveLength(12)
    const mastery = s.practices.filter((p) => p.level === 'mastery')
    // A third of 12 = 4 mastery slots, all targeting the current batch —
    // learning keeps the majority so new words aren't crowded out.
    expect(mastery).toHaveLength(4)
    expect(mastery.every((p) => p.bucket === 'current')).toBe(true)
    // The remaining eight learning slots keep the 25/25/50 split.
    const learning = s.practices.filter((p) => p.level === 'learning')
    const counts = { atRisk: 0, untested: 0, current: 0 }
    for (const p of learning) counts[p.bucket]++
    expect(counts).toEqual(allocateBuckets(8))
  })
  it('always reserves at least one mastery slot in a small session', () => {
    const s = buildSession({ type: 'standard', size: 'quick', rng: seededRng(7) })
    expect(s.practices).toHaveLength(4)
    expect(s.practices.filter((p) => p.level === 'mastery').length).toBeGreaterThanOrEqual(1)
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
  it('weights each level by its own needs when given a per-level weakness map', () => {
    // identification is heavy only for mastery; usage heavy only for learning.
    // A flat map would let the mastery identification boost bleed into learning
    // slots; the per-level map must keep them isolated.
    const weakness = {
      learning: { identification: 0.05, usage: 1000, hearing: 0.05, speaking: 0.05 },
      mastery: { identification: 1000, usage: 0.05, context: 0.05 },
    }
    const s = buildSession({ type: 'standard', size: 'super', weakness, rng: seededRng(8) })
    const learning = s.practices.filter((p) => p.level === 'learning')
    const mastery = s.practices.filter((p) => p.level === 'mastery')
    // Learning slots favour usage (its heavy dimension), not identification.
    expect(learning.filter((p) => p.dimension === 'usage').length).toBeGreaterThan(
      learning.filter((p) => p.dimension === 'identification').length,
    )
    // Mastery slots favour identification, not usage — the learning usage boost
    // does not leak across.
    expect(mastery.filter((p) => p.dimension === 'identification').length).toBeGreaterThan(
      mastery.filter((p) => p.dimension === 'usage').length,
    )
  })
  it('weights at-risk slots by the atRisk map without disturbing other slots', () => {
    // Learning slots are steered hard toward identification; at-risk slots hard
    // toward hearing. Each must follow its own map.
    const weakness = {
      learning: { identification: 1000, usage: 0.05, hearing: 0.05, speaking: 0.05 },
      atRisk: { identification: 0.05, usage: 0.05, hearing: 1000, speaking: 0.05 },
    }
    const s = buildSession({ type: 'standard', size: 'super', levels: ['learning'], weakness, rng: seededRng(9) })
    const atRisk = s.practices.filter((p) => p.bucket === 'atRisk')
    expect(atRisk.length).toBeGreaterThan(0)
    expect(atRisk.filter((p) => p.dimension === 'hearing').length).toBeGreaterThan(
      atRisk.filter((p) => p.dimension !== 'hearing').length,
    )
    const rest = s.practices.filter((p) => p.bucket !== 'atRisk')
    expect(rest.filter((p) => p.dimension === 'identification').length).toBeGreaterThan(
      rest.filter((p) => p.dimension === 'hearing').length,
    )
  })
  it('restricts practice levels when levels parameter is supplied', () => {
    const s = buildSession({ type: 'standard', size: 'super', levels: ['learning'], rng: seededRng(5) })
    expect(s.practices.every((p) => p.level === 'learning')).toBe(true)
    expect(s.practices).toHaveLength(20)
  })
  it('mastery identification always comes before mastery usage', () => {
    // Force max weight on mastery dimensions to guarantee both types appear.
    const weakness = { identification: 1000, usage: 1000, hearing: 0, speaking: 0 }
    const s = buildSession({ type: 'grammar', size: 'normal', weakness, rng: seededRng(6) })
    const masteryPractices = s.practices.filter((p) => p.level === 'mastery')
    const firstUsageIdx = masteryPractices.findIndex((p) => p.dimension === 'usage')
    const lastIdIdx = [...masteryPractices].map((p, i) => p.dimension === 'identification' ? i : -1).filter(i => i >= 0).at(-1) ?? -1
    if (firstUsageIdx >= 0 && lastIdIdx >= 0) {
      expect(lastIdIdx).toBeLessThan(firstUsageIdx)
    }
  })
  it('keeps that order when learning practices sit between the mastery ones', () => {
    // A standard session interleaves both levels; the ordering must survive it
    // (#645). Learning slots keep their own shuffled positions either way.
    for (let seed = 1; seed <= 30; seed++) {
      const s = buildSession({ type: 'standard', size: 'super', rng: seededRng(seed) })
      const mastery = s.practices.filter((p) => p.level === 'mastery')
      const lastId = mastery.map((p) => p.dimension).lastIndexOf('identification')
      const firstUsage = mastery.findIndex((p) => p.dimension === 'usage')
      if (lastId >= 0 && firstUsage >= 0) expect(lastId).toBeLessThan(firstUsage)
      const firstContext = mastery.findIndex((p) => p.dimension === 'context')
      const lastUsage = mastery.map((p) => p.dimension).lastIndexOf('usage')
      if (firstContext >= 0 && lastUsage >= 0) expect(lastUsage).toBeLessThan(firstContext)
      // The learning practices are untouched by the mastery reordering.
      expect(s.practices.filter((p) => p.level === 'learning').length).toBe(
        s.practices.length - mastery.length,
      )
    }
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
