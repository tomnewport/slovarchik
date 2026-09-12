import { describe, it, expect } from 'vitest'

import { INSTALLED, parseVersion, compareVersions, describeAge } from './appVersion.js'

const at = (iso) => ({ commit: 'aaaaaaa', released: iso })

describe('parseVersion', () => {
  it('reads a version document', () => {
    expect(parseVersion({ commit: 'abc1234', released: '2026-09-01T10:00:00Z' })).toEqual({
      commit: 'abc1234',
      released: '2026-09-01T10:00:00Z',
    })
  })

  it('keeps a half-populated document — either half is usable', () => {
    expect(parseVersion({ released: '2026-09-01T10:00:00Z' })).toEqual({
      commit: null,
      released: '2026-09-01T10:00:00Z',
    })
    expect(parseVersion({ commit: 'abc1234' })).toEqual({ commit: 'abc1234', released: null })
  })

  it('rejects everything that is not a version document', () => {
    // A 404 body, an HTML error page parsed as JSON, a deploy older than the
    // file itself: all of them have to read as "no answer", not as a version.
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion('<!doctype html>')).toBeNull()
    expect(parseVersion(42)).toBeNull()
    expect(parseVersion({})).toBeNull()
    expect(parseVersion({ commit: '', released: '' })).toBeNull()
    expect(parseVersion({ commit: 7, released: {} })).toBeNull()
  })
})

describe('compareVersions', () => {
  it('is unknown with nothing deployed to compare against', () => {
    expect(compareVersions(at('2026-09-01T00:00:00Z'), null)).toBe('unknown')
  })

  it('calls the same commit current, whatever the timestamps say', () => {
    const installed = { commit: 'abc1234', released: '2026-09-01T00:00:00Z' }
    const deployed = { commit: 'abc1234', released: '2026-09-02T00:00:00Z' }
    expect(compareVersions(installed, deployed)).toBe('current')
  })

  it('calls a later release newer, and an earlier one older', () => {
    expect(
      compareVersions(
        { commit: 'aaa', released: '2026-09-01T00:00:00Z' },
        { commit: 'bbb', released: '2026-09-02T00:00:00Z' },
      ),
    ).toBe('newer')
    // A rollback. Worth its own answer: reloading moves the learner *back*.
    expect(
      compareVersions(
        { commit: 'bbb', released: '2026-09-02T00:00:00Z' },
        { commit: 'aaa', released: '2026-09-01T00:00:00Z' },
      ),
    ).toBe('older')
  })

  it('will not order two builds it cannot date', () => {
    expect(compareVersions({ commit: 'aaa', released: null }, { commit: 'bbb', released: null })).toBe('unknown')
    expect(compareVersions({ commit: 'aaa', released: 'not a date' }, at('2026-09-02T00:00:00Z'))).toBe('unknown')
    expect(compareVersions(null, { commit: 'bbb', released: '2026-09-02T00:00:00Z' })).toBe('unknown')
  })

  it('treats a same-instant release as current only when no commits disagree', () => {
    const iso = '2026-09-01T00:00:00Z'
    expect(compareVersions({ commit: null, released: iso }, { commit: null, released: iso })).toBe('current')
    expect(compareVersions({ commit: 'aaa', released: iso }, { commit: 'bbb', released: iso })).toBe('unknown')
  })
})

describe('describeAge', () => {
  const now = Date.parse('2026-09-12T12:00:00Z')

  it('describes a check coarsely', () => {
    expect(describeAge(now - 10_000, now)).toBe('just now')
    expect(describeAge(now - 60_000, now)).toBe('1 minute ago')
    expect(describeAge(now - 6 * 60_000, now)).toBe('6 minutes ago')
    expect(describeAge(now - 3_600_000, now)).toBe('1 hour ago')
    expect(describeAge(now - 5 * 3_600_000, now)).toBe('5 hours ago')
    expect(describeAge(now - 86_400_000, now)).toBe('1 day ago')
    expect(describeAge(now - 9 * 86_400_000, now)).toBe('9 days ago')
  })

  it('reads a future stamp as recent rather than as a negative age', () => {
    // A device whose clock moved, or a record restored from another machine.
    expect(describeAge(now + 86_400_000, now)).toBe('just now')
  })

  it('has nothing to say about a check that never happened', () => {
    expect(describeAge(null, now)).toBeNull()
    expect(describeAge(undefined, now)).toBeNull()
    expect(describeAge(Number.NaN, now)).toBeNull()
    expect(describeAge('yesterday', now)).toBeNull()
  })

  it('defaults to the current clock', () => {
    expect(describeAge(Date.now())).toBe('just now')
  })
})

describe('INSTALLED', () => {
  it('is a frozen pair of build facts', () => {
    // Outside a Vite build both halves are null; inside one they are strings.
    // Either way the shape is what compareVersions is handed.
    expect(Object.isFrozen(INSTALLED)).toBe(true)
    expect(Object.keys(INSTALLED).sort()).toEqual(['commit', 'released'])
    for (const value of Object.values(INSTALLED)) {
      expect(value === null || typeof value === 'string').toBe(true)
    }
  })
})
