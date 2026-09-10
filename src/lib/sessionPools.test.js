import { describe, it, expect } from 'vitest'

import {
  makeContext,
  dimensionWeakness,
  understanding,
  currentPool,
  masteryLostPool,
  reinforcePool,
  duePool,
  masteryBatchActive,
  assembleSession,
} from './sessionPools.js'

const ev = (dimension, level, correct, ts = 1) => ({ dimension, level, correct, ts })

// A "known" word clears each learning dimension on a single correct answer.
const learnedEvents = (ts = 1) =>
  ['identification', 'usage', 'hearing', 'speaking'].map((d) => ev(d, 'learning', true, ts))

// wordRecord resolver: words are `known` (relaxed criteria) so a handful of
// correct answers is enough to reach a deterministic state. `inflected` decides
// whether a learned word can still be mastered (`learned`) or is done (`mastered`).
const resolver = (inflected = {}) => (key) => ({
  key,
  hasInflections: !!inflected[key],
  known: true,
})

const snapshot = (records, opts = {}) => ({
  records,
  wordRecord: opts.wordRecord ?? resolver(opts.inflected),
  learning: opts.learning ?? null,
  mastery: opts.mastery ?? null,
  atRisk: opts.atRisk ?? [],
  lost: opts.lost ?? [],
})

describe('dimensionWeakness', () => {
  it('weights dimensions answered wrong above ones answered right', () => {
    const records = {
      w0: {
        events: [
          ev('identification', 'learning', true),
          ev('usage', 'learning', false),
          ev('usage', 'learning', false),
        ],
      },
    }
    const w = dimensionWeakness(records)
    expect(w.identification).toBeCloseTo(0.05) // all correct → floored
    expect(w.usage).toBe(1) // all wrong → max weight
    expect(w.usage).toBeGreaterThan(w.identification)
  })

  it('gives untested dimensions the maximum weight', () => {
    const w = dimensionWeakness({})
    expect(w.speaking).toBe(1)
    expect(w.context).toBe(1)
  })

  it('honours the recency window', () => {
    const events = [
      ev('identification', 'learning', false, 1),
      ev('identification', 'learning', true, 2),
    ]
    // Window of 1 keeps only the last (correct) attempt → floored weight.
    expect(dimensionWeakness({ w0: { events } }, 1).identification).toBeCloseTo(0.05)
    // The full window sees one wrong of two → weight 0.5.
    expect(dimensionWeakness({ w0: { events } }).identification).toBeCloseTo(0.5)
  })
})

describe('makeContext', () => {
  it('derives events and state from the snapshot', () => {
    const ctx = makeContext(snapshot({ w0: { events: learnedEvents() } }, { inflected: { w0: true } }))
    expect(ctx.events('w0')).toHaveLength(4)
    expect(ctx.events('missing')).toEqual([])
    // Learning met, mastery not (inflected) → learned.
    expect(ctx.stateOf('w0')).toBe('learned')
    expect(ctx.stateOf('missing')).toBe('unknown')
  })

  it('collapses a non-inflected learned word straight to mastered', () => {
    const ctx = makeContext(snapshot({ w0: { events: learnedEvents() } }))
    expect(ctx.stateOf('w0')).toBe('mastered')
  })
})

describe('currentPool', () => {
  it('lists batch words below target, worst-understood first, and skips done ones', () => {
    const records = {
      w0: { events: learnedEvents() }, // learned → done for a learning batch
      w1: { events: [ev('identification', 'learning', true)] }, // learning
      w2: { events: [ev('identification', 'learning', true), ev('usage', 'learning', true)] }, // learning, better
    }
    const ctx = makeContext(
      snapshot(records, {
        inflected: { w0: true },
        learning: { words: ['w0', 'w1', 'w2'] },
      }),
    )
    const pool = currentPool(ctx)
    expect(pool).not.toContain('w0')
    expect(pool).toContain('w1')
    expect(pool).toContain('w2')
    // w1 understands less than w2, so it sorts to the front.
    expect(pool.indexOf('w1')).toBeLessThan(pool.indexOf('w2'))
  })

  it('folds slipped (below-learned) lost words into the pool', () => {
    const records = { wx: { events: [ev('identification', 'learning', true)] } }
    const ctx = makeContext(snapshot(records, { lost: ['wx'] }))
    expect(currentPool(ctx)).toContain('wx')
  })

  it('ranks a slipped word ahead of the batch, despite its high understanding', () => {
    const records = {
      // Slipped: three of the four learning dimensions still met, so its
      // `understanding` score is the highest in the pool.
      wx: {
        events: [
          ...learnedEvents(),
          ev('usage', 'learning', false, 2),
          ev('usage', 'learning', false, 3),
        ],
      },
      w1: { events: [ev('identification', 'learning', true)] },
      w2: { events: [ev('identification', 'learning', true), ev('usage', 'learning', true)] },
    }
    const ctx = makeContext(
      snapshot(records, { learning: { words: ['w1', 'w2'] }, lost: ['wx'] }),
    )
    expect(understanding(ctx, 'wx')).toBeGreaterThan(understanding(ctx, 'w1'))
    // The current bucket is front-biased, so position is practice frequency:
    // scoring highest must not bury the word that needs re-learning.
    expect(currentPool(ctx)[0]).toBe('wx')
  })

  it('ranks a confirmation-failed word ahead of the batch too', () => {
    const records = {
      wc: { events: learnedEvents(), confirmedAt: null, confirmFailedAt: 500 },
      w1: { events: [ev('identification', 'learning', true)] },
    }
    const ctx = makeContext(
      snapshot(records, { inflected: { wc: true }, learning: { words: ['w1'] } }),
    )
    expect(currentPool(ctx)[0]).toBe('wc')
  })

  it('falls back to actively-learning words when no batch is committed', () => {
    const records = { wa: { events: [ev('identification', 'learning', true)] } }
    const ctx = makeContext(snapshot(records))
    expect(currentPool(ctx)).toEqual(['wa'])
  })
})

describe('reinforcePool', () => {
  it('keeps only learned-or-better at-risk / lost words', () => {
    const records = {
      w0: { events: learnedEvents() }, // mastered (no inflections)
      w1: { events: [ev('identification', 'learning', true)] }, // learning — excluded
    }
    const ctx = makeContext(snapshot(records, { atRisk: ['w0'], lost: ['w1'] }))
    expect(reinforcePool(ctx)).toEqual(['w0'])
  })
})

describe('masteryLostPool', () => {
  it('keeps a word that fell out of mastery back to learned', () => {
    const records = { w0: { events: learnedEvents(), peak: 3 } }
    const ctx = makeContext(snapshot(records, { inflected: { w0: true }, lost: ['w0'] }))
    expect(masteryLostPool(ctx)).toEqual(['w0'])
  })

  it('excludes a word that fell further than learned', () => {
    // Its learning level is broken too, so mastery drills would record mastery
    // events on a word that is no longer learned.
    const records = { w0: { events: [ev('identification', 'learning', true)], peak: 3 } }
    const ctx = makeContext(snapshot(records, { inflected: { w0: true }, lost: ['w0'] }))
    expect(masteryLostPool(ctx)).toEqual([])
  })

  it('excludes a word that never reached mastery', () => {
    const records = { w0: { events: learnedEvents(), peak: 2 } }
    const ctx = makeContext(snapshot(records, { inflected: { w0: true }, lost: ['w0'] }))
    expect(masteryLostPool(ctx)).toEqual([])
  })
})

describe('duePool', () => {
  it('returns only learned-or-better words', () => {
    const records = {
      w0: { events: learnedEvents() }, // mastered
      w1: { events: [ev('identification', 'learning', true)] }, // learning
    }
    const ctx = makeContext(snapshot(records))
    const due = duePool(ctx, 1000)
    expect(due).toContain('w0')
    expect(due).not.toContain('w1')
  })
})

describe('masteryBatchActive', () => {
  it('is false without a mastery batch', () => {
    const ctx = makeContext(snapshot({}))
    expect(masteryBatchActive(ctx)).toBe(false)
  })

  it('is false when every batch word is already mastered', () => {
    const records = { w0: { events: learnedEvents() } } // no inflections → mastered
    const ctx = makeContext(snapshot(records, { mastery: { words: ['w0'] } }))
    expect(masteryBatchActive(ctx)).toBe(false)
  })

  it('is true when a batch word can still be advanced', () => {
    const records = { w0: { events: learnedEvents() } } // inflected → learned, mastery open
    const ctx = makeContext(
      snapshot(records, { inflected: { w0: true }, mastery: { words: ['w0'] } }),
    )
    expect(masteryBatchActive(ctx, 10 * 24 * 3600 * 1000)).toBe(true)
  })
})

describe('understanding', () => {
  it('scores a word by met learning criteria plus recent accuracy', () => {
    const strong = makeContext(snapshot({ w0: { events: learnedEvents() } }))
    const weak = makeContext(snapshot({ w1: { events: [ev('identification', 'learning', false)] } }))
    expect(understanding(strong, 'w0')).toBeGreaterThan(understanding(weak, 'w1'))
  })
})

describe('assembleSession', () => {
  it('builds a sized session with a pool per practice', () => {
    const records = {}
    for (let i = 0; i < 5; i++) records[`w${i}`] = { events: [ev('identification', 'learning', true)] }
    const session = assembleSession(
      snapshot(records, { learning: { words: ['w0', 'w1', 'w2'] } }),
      { type: 'standard', size: 'normal' },
    )
    expect(session.practices.length).toBeGreaterThan(0)
    expect(session.pools).toHaveProperty('current')
    for (const p of session.practices) {
      expect(Array.isArray(p.pool)).toBe(true)
      expect(['atRisk', 'untested', 'current']).toContain(p.bucket)
    }
  })

  it('passes focusKeys through and restricts current to them', () => {
    const records = { w0: { events: learnedEvents() }, w1: { events: learnedEvents() } }
    const session = assembleSession(snapshot(records), {
      type: 'words',
      focusKeys: ['w0', 'w1'],
    })
    expect(session.focusKeys).toEqual(['w0', 'w1'])
    expect(session.pools.current).toEqual(['w0', 'w1'])
  })

  it('defaults focusKeys to null for an unfocused session', () => {
    const session = assembleSession(snapshot({}), { type: 'standard', size: 'quick' })
    expect(session.focusKeys).toBeNull()
  })

  it('narrows a current-bucket learning slot to words its own dimension can advance', () => {
    // Both words are still being learned and both sit in the current pool, but
    // only `wUnheard` can be moved by a listening drill — `wHeard` met hearing
    // already, so drilling it there advances nothing.
    const records = {
      wUnheard: { events: [ev('identification', 'learning', true)] },
      wHeard: {
        events: [ev('identification', 'learning', true), ev('hearing', 'learning', true)],
      },
    }
    const session = assembleSession(
      snapshot(records, { learning: { words: ['wUnheard', 'wHeard'] } }),
      { type: 'listening' },
    )
    const current = session.practices.filter((p) => p.bucket === 'current')
    expect(current.length).toBeGreaterThan(0)
    for (const p of current) expect(p.pool).toEqual(['wUnheard'])
  })

  it('keeps the whole current pool when every word has already met the slot dimension', () => {
    const records = {
      w0: { events: [ev('hearing', 'learning', true)] },
      w1: { events: [ev('hearing', 'learning', true)] },
    }
    const session = assembleSession(snapshot(records, { learning: { words: ['w0', 'w1'] } }), {
      type: 'listening',
    })
    const current = session.practices.filter((p) => p.bucket === 'current')
    expect(current.length).toBeGreaterThan(0)
    for (const p of current) expect([...p.pool].sort()).toEqual(['w0', 'w1'])
  })

  it('offers mastery practices for a word that dropped out of mastery, with no mastery batch', () => {
    // Its only route back is a correct mastery answer. Nothing else reaches it:
    // it is not borderline (the criterion is unmet, not one miss from unmet),
    // and every pool a `learned` word lands in is drilled at the learning level,
    // whose criteria it already meets — so it would sit in `lost` indefinitely.
    const records = { w0: { events: learnedEvents(), peak: 3 } }
    const session = assembleSession(
      snapshot(records, { inflected: { w0: true }, lost: ['w0'] }),
      { type: 'standard', size: 'normal' },
    )
    const mastery = session.practices.filter((p) => p.level === 'mastery')
    expect(mastery.length).toBeGreaterThan(0)
    for (const p of mastery) expect(p.pool).toContain('w0')
  })

  it('puts a dropped-out-of-mastery word ahead of the mastery batch', () => {
    const records = {
      w0: { events: learnedEvents(), peak: 3 },
      w1: { events: learnedEvents(), peak: 2 },
    }
    const session = assembleSession(
      snapshot(records, {
        inflected: { w0: true, w1: true },
        mastery: { words: ['w1'] },
        lost: ['w0'],
      }),
      { type: 'standard', size: 'normal' },
    )
    const mastery = session.practices.filter((p) => p.level === 'mastery')
    expect(mastery.length).toBeGreaterThan(0)
    // Mastery slots all sit in the front-biased `current` bucket, so leading the
    // list is what makes the word actually get drilled.
    for (const p of mastery) expect(p.pool[0]).toBe('w0')
  })

  it('keeps a dropped-out-of-mastery word out of a focused session it does not match', () => {
    const records = {
      w0: { events: learnedEvents(), peak: 3 },
      w1: { events: learnedEvents(), peak: 3 },
    }
    const session = assembleSession(
      snapshot(records, { inflected: { w0: true, w1: true }, lost: ['w0', 'w1'] }),
      { type: 'standard', size: 'normal', focusKeys: ['w1'] },
    )
    for (const p of session.practices) expect(p.pool).not.toContain('w0')
  })

  it('leaves the refresh buckets drilling met dimensions — that is what retention is', () => {
    // A finished word has met every dimension, so the advance-half narrowing
    // would empty its pool; the refresh buckets must still schedule it.
    const records = { w0: { events: learnedEvents() } }
    const session = assembleSession(snapshot(records), { type: 'listening' })
    expect(session.pools.untested).toContain('w0')
    const refresh = session.practices.filter((p) => p.bucket === 'untested')
    expect(refresh.length).toBeGreaterThan(0)
    for (const p of refresh) expect(p.pool).toContain('w0')
  })
})
