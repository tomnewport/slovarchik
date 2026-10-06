import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { factFingerprint, factSourceIssues } from './factSources.js'
import { loadFixtureWords } from '../test/fixtures.js'

const fact = (over = {}) => ({
  kind: 'build',
  text: 'Formed from по- and каза́ть.',
  parts: [{ ru: 'по-', en: 'prefix' }],
  seeKeys: ['казаться=to seem'],
  ...over,
})

const line = (over = {}) => ({
  key: 'показать=to show',
  kind: 'build',
  text: 'Formed from по- and каза́ть.',
  parts: [{ ru: 'по-', en: 'prefix' }],
  see: ['казаться=to seem'],
  claims: [{ claim: 'по- + каза́ть', sources: [{ source: 'Фасмер', url: 'https://x', quote: 'показа́ть' }] }],
  review: { status: 'approved', by: 'independent agent', date: '2026-10-06' },
  ...over,
})

const word = (facts) => ({ key: 'показать=to show', facts })
const messages = (issues) => issues.map((i) => i.message)

describe('factSourceIssues', () => {
  it('accepts a fact with a complete, approved ledger line', () => {
    expect(factSourceIssues([word([fact()])], [line()], [])).toEqual([])
  })

  it('accepts a legacy fact listed on the baseline', () => {
    const f = fact()
    expect(factSourceIssues([word([f])], [], [factFingerprint('показать=to show', f)])).toEqual([])
  })

  it('reports a fact with neither a ledger line nor a baseline entry', () => {
    expect(messages(factSourceIssues([word([fact()])], [], []))).toEqual([
      expect.stringContaining('unsourced build fact'),
    ])
  })

  it('takes an edited legacy fact off the baseline', () => {
    const before = fact()
    const after = fact({ text: 'Formed from по- and каза́ть, to show.' })
    const issues = messages(factSourceIssues([word([after])], [], [factFingerprint('показать=to show', before)]))
    expect(issues).toEqual([
      expect.stringContaining('unsourced build fact'),
      expect.stringContaining('matches no unsourced fact'),
    ])
  })

  it('reports a ledger line once the fact it reviewed is reworded', () => {
    const issues = messages(factSourceIssues([word([fact({ text: 'Reworded.' })])], [line()], []))
    expect(issues).toContainEqual(expect.stringContaining('matches no fact word for word'))
    expect(issues).toContainEqual(expect.stringContaining('unsourced build fact'))
  })

  it('reports chips or links that drifted from the reviewed ones', () => {
    const issues = messages(
      factSourceIssues(
        [word([fact({ parts: [{ ru: 'по-', en: 'up to' }], seeKeys: [] })])],
        [line()],
        [],
      ),
    )
    expect(issues).toEqual([
      expect.stringContaining('parts differ'),
      expect.stringContaining('see links differ'),
    ])
  })

  it('reports an incomplete or unapproved ledger line', () => {
    const bare = line({
      claims: [{ claim: 'x', sources: [{ source: 'Фасмер', url: '', quote: '' }] }],
      review: { status: 'pending' },
    })
    const issues = messages(factSourceIssues([word([fact()])], [bare], []))
    expect(issues).toContainEqual(expect.stringContaining('has no url'))
    expect(issues).toContainEqual(expect.stringContaining('has no quote'))
    expect(issues).toContainEqual(expect.stringContaining('not "approved"'))
  })

  it('reports a claim with no source, and a line with no claims', () => {
    const issues = messages(
      factSourceIssues([word([fact(), fact({ kind: 'note', text: 'n' })])], [
        line({ claims: [{ claim: 'x', sources: [] }] }),
        line({ kind: 'note', text: 'n', parts: [], see: [], claims: [] }),
      ], []),
    )
    expect(issues).toContainEqual(expect.stringContaining('has no source'))
    expect(issues).toContainEqual(expect.stringContaining('cites no claims'))
  })

  it('reports two ledger lines for one fact', () => {
    expect(messages(factSourceIssues([word([fact()])], [line(), line()], []))).toEqual([
      expect.stringContaining('duplicates another line'),
    ])
  })
})

// ── the real ledger against the real corpus ──────────────────────────────────
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('the bundled vocabulary’s fact sources', () => {
  it('sources every fact, or lists it on the shrinking baseline', () => {
    const ledger = readFileSync(resolve(repo, 'review/facts-sources.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
    const { facts: baseline } = JSON.parse(
      readFileSync(resolve(repo, 'review/facts-unsourced-baseline.json'), 'utf8'),
    )
    const issues = factSourceIssues(loadFixtureWords(), ledger, baseline)
    const report = issues.map((i) => `${i.key}: ${i.message}`).join('\n')
    expect(issues, `\n${report}`).toEqual([])
  })
})
