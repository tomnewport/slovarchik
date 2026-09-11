import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS, earnedSet, newlyUnlocked, achievementById, buildCefrStats, stampEarned } from './achievements.js'

describe('ACHIEVEMENTS', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has required fields', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.id, a.id).toBeTypeOf('string')
      expect(a.icon, a.id).toBeTypeOf('string')
      expect(a.label, a.id).toBeTypeOf('string')
      expect(a.type, a.id).toMatch(/^(learned|mastered|cefr)$/)
    }
  })

  it('learned/mastered entries have positive thresholds', () => {
    for (const a of ACHIEVEMENTS.filter((a) => a.type !== 'cefr')) {
      expect(a.threshold, a.id).toBeGreaterThan(0)
    }
  })
})

describe('earnedSet', () => {
  const emptyStats = { A1: { total: 0, learned: 0 }, A2: { total: 0, learned: 0 }, B1: { total: 0, learned: 0 }, B2: { total: 0, learned: 0 }, C1: { total: 0, learned: 0 } }

  it('returns empty set when nothing is earned', () => {
    expect(earnedSet(0, 0, emptyStats).size).toBe(0)
  })

  it('grants learn-1 at learnedCount=1', () => {
    expect(earnedSet(1, 0, emptyStats).has('learn-1')).toBe(true)
  })

  it('does not grant learn-5 at learnedCount=4', () => {
    expect(earnedSet(4, 0, emptyStats).has('learn-5')).toBe(false)
  })

  it('grants learn-5 at learnedCount=5', () => {
    expect(earnedSet(5, 0, emptyStats).has('learn-5')).toBe(true)
  })

  it('grants all lower thresholds when count exceeds them', () => {
    const earned = earnedSet(100, 0, emptyStats)
    expect(earned.has('learn-1')).toBe(true)
    expect(earned.has('learn-5')).toBe(true)
    expect(earned.has('learn-10')).toBe(true)
    expect(earned.has('learn-20')).toBe(true)
    expect(earned.has('learn-50')).toBe(true)
    expect(earned.has('learn-100')).toBe(true)
    expect(earned.has('learn-150')).toBe(false)
  })

  it('grants master-1 only from masteredCount, not learnedCount', () => {
    const earned = earnedSet(50, 0, emptyStats)
    expect(earned.has('master-1')).toBe(false)
    const earned2 = earnedSet(50, 1, emptyStats)
    expect(earned2.has('master-1')).toBe(true)
  })

  it('does not grant cefr achievement when total is 0', () => {
    const stats = { ...emptyStats, A1: { total: 0, learned: 0 } }
    expect(earnedSet(0, 0, stats).has('cefr-A1')).toBe(false)
  })

  it('does not grant cefr achievement when not all learned', () => {
    const stats = { ...emptyStats, A1: { total: 10, learned: 9 } }
    expect(earnedSet(9, 0, stats).has('cefr-A1')).toBe(false)
  })

  it('grants cefr achievement when all words learned', () => {
    const stats = { ...emptyStats, A1: { total: 10, learned: 10 } }
    expect(earnedSet(10, 0, stats).has('cefr-A1')).toBe(true)
  })
})

describe('newlyUnlocked', () => {
  it('returns ids in next but not prev', () => {
    const prev = new Set(['learn-1', 'learn-5'])
    const next = new Set(['learn-1', 'learn-5', 'learn-10'])
    expect(newlyUnlocked(prev, next)).toEqual(['learn-10'])
  })

  it('returns empty array when nothing new', () => {
    const s = new Set(['learn-1'])
    expect(newlyUnlocked(s, s)).toEqual([])
  })

  it('returns all ids when prev is empty', () => {
    const next = new Set(['learn-1', 'master-1'])
    const result = newlyUnlocked(new Set(), next)
    expect(result.sort()).toEqual(['learn-1', 'master-1'].sort())
  })
})

describe('achievementById', () => {
  it('finds an achievement by id', () => {
    const a = achievementById('learn-100')
    expect(a).toBeDefined()
    expect(a.threshold).toBe(100)
  })

  it('returns undefined for unknown id', () => {
    expect(achievementById('not-real')).toBeUndefined()
  })
})

describe('buildCefrStats', () => {
  const words = [
    { key: 'кот', cefr: 'A1' },
    { key: 'дом', cefr: 'A1' },
    { key: 'год', cefr: 'A2' },
    { key: 'работа', cefr: 'A2' },
    { key: 'успех', cefr: 'B1' },
    { key: 'noLevel', cefr: null },
  ]

  it('counts total words per level', () => {
    const stats = buildCefrStats(words, () => 'unknown')
    expect(stats.A1.total).toBe(2)
    expect(stats.A2.total).toBe(2)
    expect(stats.B1.total).toBe(1)
    expect(stats.B2.total).toBe(0)
    expect(stats.C1.total).toBe(0)
  })

  it('counts learned words correctly', () => {
    const states = { кот: 'learned', дом: 'mastered', год: 'learning', работа: 'unknown', успех: 'learned' }
    const stats = buildCefrStats(words, (k) => states[k] ?? 'unknown')
    expect(stats.A1.learned).toBe(2) // кот learned, дом mastered — both count
    expect(stats.A2.learned).toBe(0) // год=learning, работа=unknown — neither counts
    expect(stats.B1.learned).toBe(1) // успех learned
  })

  it('counts mastered words as a subset of learned', () => {
    const states = { кот: 'mastered', дом: 'learned', год: 'mastered', работа: 'learning' }
    const stats = buildCefrStats(words, (k) => states[k] ?? 'unknown')
    expect(stats.A1).toEqual({ total: 2, met: 2, learned: 2, mastered: 1 })
    expect(stats.A2).toEqual({ total: 2, met: 2, learned: 1, mastered: 1 })
    expect(stats.B1).toEqual({ total: 1, met: 0, learned: 0, mastered: 0 })
  })

  it('counts a met word that has never been drilled', () => {
    const met = new Set(['кот'])
    const stats = buildCefrStats(words, () => 'unknown', (k) => met.has(k))
    expect(stats.A1).toEqual({ total: 2, met: 1, learned: 0, mastered: 0 })
  })

  it('counts a drilled word as met without the log saying so', () => {
    // The nesting has to hold by construction: a word being drilled has plainly
    // been met, whether or not a phrase ever logged it.
    const stats = buildCefrStats(words, (k) => (k === 'кот' ? 'learning' : 'unknown'))
    expect(stats.A1.met).toBe(1)
    expect(stats.A1.learned).toBe(0)
  })

  it('does not double-count a word that is both drilled and logged', () => {
    const stats = buildCefrStats(words, (k) => (k === 'кот' ? 'mastered' : 'unknown'), () => true)
    expect(stats.A1).toEqual({ total: 2, met: 2, learned: 1, mastered: 1 })
  })

  it('ignores words with null cefr', () => {
    const stats = buildCefrStats(words, () => 'learned')
    // 'noLevel' should not appear in any bucket
    const total = Object.values(stats).reduce((s, v) => s + v.total, 0)
    expect(total).toBe(5) // 6 words minus the null-cefr one
  })
})

describe('stampEarned', () => {
  it('stamps a newly-earned id with the time it was earned', () => {
    const { next, added } = stampEarned({}, new Set(['learn-1']), 1000)
    expect(next).toEqual({ 'learn-1': 1000 })
    expect(added).toEqual(['learn-1'])
  })

  it('keeps the original timestamp when the id is earned again', () => {
    const { next, added } = stampEarned({ 'learn-1': 1000 }, new Set(['learn-1']), 9999)
    expect(next['learn-1']).toBe(1000)
    expect(added).toEqual([])
  })

  it('never drops an id that has stopped meeting its threshold', () => {
    // The whole point: the corpus grew, so cefr-A1 is no longer live-earned.
    const { next } = stampEarned({ 'cefr-A1': 1000 }, new Set([]), 2000)
    expect(next).toEqual({ 'cefr-A1': 1000 })
  })

  it('returns the same object when nothing was added, so callers can skip a write', () => {
    const stamped = { 'learn-1': 1000 }
    expect(stampEarned(stamped, new Set(['learn-1']), 2000).next).toBe(stamped)
  })

  it('treats a missing stamp as empty', () => {
    expect(stampEarned(undefined, new Set(['learn-1']), 5).next).toEqual({ 'learn-1': 5 })
  })
})
