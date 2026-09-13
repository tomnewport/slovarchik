import { describe, it, expect } from 'vitest'

import {
  INSTALLED,
  parseVersion,
  parseNotes,
  notesSince,
  compareVersions,
  describeAge,
} from './appVersion.js'

const at = (iso) => ({ commit: 'aaaaaaa', released: iso })

describe('parseVersion', () => {
  it('reads a version document', () => {
    const notes = [{ at: '2026-09-01T09:00:00Z', text: 'Teach participles and gerunds' }]
    expect(
      parseVersion({ commit: 'abc1234', released: '2026-09-01T10:00:00Z', notes }),
    ).toEqual({
      commit: 'abc1234',
      released: '2026-09-01T10:00:00Z',
      notes,
    })
  })

  it('keeps a half-populated document — either half is usable', () => {
    expect(parseVersion({ released: '2026-09-01T10:00:00Z' })).toEqual({
      commit: null,
      released: '2026-09-01T10:00:00Z',
      notes: [],
    })
    expect(parseVersion({ commit: 'abc1234' })).toEqual({
      commit: 'abc1234',
      released: null,
      notes: [],
    })
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

describe('parseNotes', () => {
  it('reads dated notes', () => {
    const notes = [
      { at: '2026-09-02T10:00:00Z', text: 'Say what slipped' },
      { at: '2026-09-01T10:00:00Z', text: 'Teach participles' },
    ]
    expect(parseNotes(notes)).toEqual(notes)
  })

  it('trims the text and drops anything that is not a note', () => {
    expect(
      parseNotes([
        { at: '2026-09-02T10:00:00Z', text: '  Say what slipped  ' },
        { at: '2026-09-02T10:00:00Z', text: '' },
        { at: 'whenever', text: 'Undated' },
        { at: '2026-09-02T10:00:00Z' },
        { text: 'No date at all' },
        'not a note',
        null,
      ]),
    ).toEqual([{ at: '2026-09-02T10:00:00Z', text: 'Say what slipped' }])
  })

  it('has nothing to read in a document without notes', () => {
    expect(parseNotes(undefined)).toEqual([])
    expect(parseNotes(null)).toEqual([])
    expect(parseNotes('Teach participles')).toEqual([])
    expect(parseNotes({ 0: { at: '2026-09-02T10:00:00Z', text: 'x' } })).toEqual([])
  })

  it('bounds what a fetched list can cost us', () => {
    // The list comes off the network and is then stored; its length is not ours
    // to trust.
    const many = Array.from({ length: 100 }, (_, i) => ({
      at: '2026-09-02T10:00:00Z',
      text: `change ${i}`,
    }))
    expect(parseNotes(many)).toHaveLength(30)
  })
})

describe('notesSince', () => {
  const notes = [
    { at: '2026-09-03T10:00:00Z', text: 'Third' },
    { at: '2026-09-02T10:00:00Z', text: 'Second' },
    { at: '2026-09-01T10:00:00Z', text: 'First' },
  ]

  it('keeps what landed after the running build was released', () => {
    expect(notesSince(notes, '2026-09-01T12:00:00Z').map((n) => n.text)).toEqual(['Third', 'Second'])
  })

  it('has nothing new to report for the build that carries them all', () => {
    expect(notesSince(notes, '2026-09-03T10:00:01Z')).toEqual([])
  })

  it('excludes a note that landed exactly at the release instant', () => {
    // It is in the build, not new to it.
    expect(notesSince(notes, '2026-09-03T10:00:00Z')).toEqual([])
  })

  it('says nothing rather than everything when it cannot place the build', () => {
    // "Everything we have" would be wrong for anyone but a first-time visitor,
    // and this list is headed "what's new for you".
    expect(notesSince(notes, null)).toEqual([])
    expect(notesSince(notes, 'sometime last week')).toEqual([])
  })

  it('handles an empty window', () => {
    expect(notesSince([], '2026-09-01T12:00:00Z')).toEqual([])
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
