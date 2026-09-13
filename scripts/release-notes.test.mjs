import { describe, it, expect } from 'vitest'

import { cleanSubject, noteworthy, parseLog, releaseNotes } from './release-notes.mjs'

describe('cleanSubject', () => {
  it('drops the squash merge trailer', () => {
    expect(cleanSubject('Space the current batch too, without gating it (#715)')).toBe(
      'Space the current batch too, without gating it',
    )
  })

  it('drops a stacked pair of them', () => {
    expect(cleanSubject('Build the form index once and warm it (#697) (#706)')).toBe(
      'Build the form index once and warm it',
    )
  })

  it('leaves a reference that is part of the sentence alone', () => {
    expect(cleanSubject('Revert (#700) and start again, differently')).toBe(
      'Revert (#700) and start again, differently',
    )
  })

  it('leaves a subject with no trailer untouched', () => {
    expect(cleanSubject('Teach participles and gerunds')).toBe('Teach participles and gerunds')
  })
})

describe('noteworthy', () => {
  it('keeps ordinary work', () => {
    expect(noteworthy('Say what slipped, and what would win it back')).toBe(true)
  })

  it('drops dependency bumps', () => {
    // Not a change to the app as anyone practising Russian experiences it.
    expect(noteworthy('Bump actions/upload-pages-artifact from 3 to 5')).toBe(false)
    expect(noteworthy('Bump the dev-dependencies group across 1 directory')).toBe(false)
  })

  it('does not drop a subject that merely starts with a similar word', () => {
    expect(noteworthy('Bumping the streak forward a day too early')).toBe(true)
  })

  it('drops an empty subject', () => {
    expect(noteworthy('')).toBe(false)
  })
})

describe('parseLog', () => {
  const log = [
    '2026-09-12T08:36:18+01:00\tSpace the current batch too, without gating it (#715)',
    '2026-09-11T13:52:14+01:00\tBump actions/upload-pages-artifact from 3 to 5 (#479)',
    '2026-09-11T10:14:44+01:00\tOffer a new version on Home instead of reloading mid-question (#702)',
  ].join('\n')

  it('reads dated, cleaned subjects in log order', () => {
    expect(parseLog(log)).toEqual([
      { at: '2026-09-12T08:36:18+01:00', text: 'Space the current batch too, without gating it' },
      {
        at: '2026-09-11T10:14:44+01:00',
        text: 'Offer a new version on Home instead of reloading mid-question',
      },
    ])
  })

  it('ignores lines that are not a log entry', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('no tab here\n\n')).toEqual([])
  })

  it('ignores an entry whose subject is only a reference', () => {
    expect(parseLog('2026-09-12T08:36:18+01:00\t(#715)')).toEqual([])
  })
})

describe('releaseNotes', () => {
  it('reads this repository, newest first', () => {
    const notes = releaseNotes({ limit: 5 })
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.length).toBeLessThanOrEqual(5)
    for (const note of notes) {
      expect(typeof note.text).toBe('string')
      expect(Number.isNaN(Date.parse(note.at))).toBe(false)
    }
    const dates = notes.map((n) => Date.parse(n.at))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('returns nothing rather than throwing where there is no git history', () => {
    // A tarball, or a build container without the .git directory.
    expect(releaseNotes({ cwd: '/' })).toEqual([])
  })
})
