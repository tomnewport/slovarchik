import { describe, it, expect } from 'vitest'
import { buildIssueUrl } from './reportIssue.js'

const BASE = 'https://github.com/tomnewport/slovarchik/issues/new'

function parseUrl(url) {
  const [base, qs] = url.split('?')
  const params = new URLSearchParams(qs)
  return { base, title: params.get('title'), body: params.get('body') }
}

describe('buildIssueUrl', () => {
  it('produces a valid GitHub issues/new URL', () => {
    const url = buildIssueUrl({ ru: 'кот', en: 'cat', kind: 'type', dimension: 'usage' })
    expect(url).toMatch(/^https:\/\/github\.com\/tomnewport\/slovarchik\/issues\/new\?/)
    const { base } = parseUrl(url)
    expect(base).toBe(BASE)
  })

  it('uses "word" in the title for non-phrase exercises', () => {
    const { title } = parseUrl(
      buildIssueUrl({ ru: 'кот', en: 'cat', kind: 'type', dimension: 'usage' }),
    )
    expect(title).toBe('Issue with word: кот')
  })

  it('uses "phrase" in the title when content is phrase', () => {
    const { title } = parseUrl(
      buildIssueUrl({ ru: 'как дела', en: 'how are you', kind: 'type', content: 'phrase' }),
    )
    expect(title).toBe('Issue with phrase: как дела')
  })

  it('uses "phrase" in the title for wordbank kind regardless of content field', () => {
    const { title } = parseUrl(
      buildIssueUrl({ ru: 'я иду', en: 'I go', kind: 'wordbank' }),
    )
    expect(title).toBe('Issue with phrase: я иду')
  })

  it('formats lastSyncedAt as a UTC date string in the body', () => {
    const ts = new Date('2026-01-15T10:30:00Z').getTime()
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'type', lastSyncedAt: ts }))
    expect(body).toContain('2026-01-15 10:30:00 UTC')
  })

  it('shows "unknown" when lastSyncedAt is absent', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'type' }))
    expect(body).toContain('**Vocab last synced:** unknown')
  })

  it('falls back to the raw string for unknown kind', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'mystery-kind' }))
    expect(body).toContain('mystery-kind')
  })

  it('falls back to the raw string for unknown dimension', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', dimension: 'mystery-dim' }))
    expect(body).toContain('mystery-dim')
  })

  it('includes vocabVersion in the body', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'type', vocabVersion: 3 }))
    expect(body).toContain('**Vocab version:** 3')
  })

  it('includes a placeholder comment for the user', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот' }))
    expect(body).toContain('Please describe the issue here')
  })

  it('templates a disputed-grading body when a submitted answer is given', () => {
    const { body } = parseUrl(
      buildIssueUrl({
        ru: 'Э́то большо́й го́род.',
        en: 'This is a big city.',
        kind: 'wordbank',
        submitted: 'This city is big',
      }),
    )
    expect(body).toContain('marked incorrect')
    expect(body).toContain('**My answer:** This city is big')
    expect(body).toContain('**Expected answer:** This is a big city.')
    expect(body).not.toContain('Please describe the issue here')
  })

  it('ignores a blank submitted answer and keeps the default placeholder', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', submitted: '   ' }))
    expect(body).toContain('Please describe the issue here')
  })

  it('includes the commit hash in the body', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'type', commitHash: 'abc1234' }))
    expect(body).toContain('**App commit:** abc1234')
  })

  it('shows "unknown" when commitHash is absent', () => {
    const { body } = parseUrl(buildIssueUrl({ ru: 'кот', kind: 'type' }))
    expect(body).toContain('**App commit:** unknown')
  })
})
