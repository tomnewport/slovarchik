import { describe, it, expect } from 'vitest'
import {
  PRACTICE_TYPES,
  PRACTICE_BY_ID,
  SESSION_PRACTICE_FILTERS,
  practicesForSession,
} from './practices.js'
import { DIMENSIONS } from './progression.js'

describe('catalogue shape', () => {
  it('every practice declares a valid dimension, level and content', () => {
    for (const p of PRACTICE_TYPES) {
      expect(DIMENSIONS).toContain(p.dimension)
      expect(['learning', 'mastery']).toContain(p.level)
      expect(['word', 'phrase', 'inflection']).toContain(p.content)
      expect(p.exercises).toBeGreaterThan(0)
    }
  })
  it('has unique ids indexed by PRACTICE_BY_ID', () => {
    const ids = PRACTICE_TYPES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(PRACTICE_BY_ID[id].id).toBe(id)
  })
  it('only the mastery practices use inflection tables', () => {
    for (const p of PRACTICE_TYPES) {
      if (p.content === 'inflection') expect(p.level).toBe('mastery')
      if (p.level === 'mastery') expect(p.content).toBe('inflection')
    }
  })
})

describe('practicesForSession', () => {
  it('standard draws from every practice type', () => {
    expect(practicesForSession('standard')).toHaveLength(PRACTICE_TYPES.length)
  })
  it('speaking only draws speaking practices', () => {
    const ps = practicesForSession('speaking')
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.every((p) => p.dimension === 'speaking')).toBe(true)
  })
  it('listening only draws hearing practices', () => {
    expect(practicesForSession('listening').every((p) => p.dimension === 'hearing')).toBe(true)
  })
  it('words draws word-content identification/usage practices', () => {
    const ps = practicesForSession('words')
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.every((p) => p.content === 'word')).toBe(true)
    expect(ps.every((p) => p.dimension === 'identification' || p.dimension === 'usage')).toBe(true)
  })
  it('phrases draws phrase-content identification/usage practices', () => {
    const ps = practicesForSession('phrases')
    expect(ps.every((p) => p.content === 'phrase')).toBe(true)
  })
  it('grammar draws only inflection-table practices', () => {
    expect(practicesForSession('grammar').every((p) => p.content === 'inflection')).toBe(true)
  })
  it('an unknown type falls back to the standard filter', () => {
    expect(SESSION_PRACTICE_FILTERS.standard({})).toBe(true)
    expect(practicesForSession('nope')).toHaveLength(PRACTICE_TYPES.length)
  })
})
