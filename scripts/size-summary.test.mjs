import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { measure, evaluate, renderSummary, entryAssets, vocabAssets } from './size-summary.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

let dist

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'size-summary-'))
  mkdirSync(join(dist, 'assets'))
  mkdirSync(join(dist, 'vocab'))
  // Mirrors a real built index.html: base-prefixed, content-hashed names, and
  // the PWA plugin's registerSW.js sitting outside assets/.
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html><head>
       <link rel="stylesheet" href="/slovarchik/assets/index-CaGQnf75.css">
       <script type="module" src="/slovarchik/assets/index-D96PxI5.js"></script>
       <script src="/slovarchik/registerSW.js"></script>
     </head><body><div id="app"></div></body></html>`,
  )
  writeFileSync(join(dist, 'assets/index-D96PxI5.js'), 'a'.repeat(5000))
  writeFileSync(join(dist, 'assets/index-CaGQnf75.css'), 'b'.repeat(2000))
  writeFileSync(join(dist, 'registerSW.js'), 'c'.repeat(9000))
  writeFileSync(join(dist, 'vocab/nouns.json'), JSON.stringify({ words: 'x'.repeat(4000) }))
  writeFileSync(join(dist, 'vocab/verbs.json'), JSON.stringify({ words: 'y'.repeat(1000) }))
  writeFileSync(join(dist, 'vocab/CONTRIBUTING.md'), 'not json')
})

afterAll(() => rmSync(dist, { recursive: true, force: true }))

describe('discovering the built assets', () => {
  it('reads the entry chunk out of index.html, base path and all', () => {
    const { entryJs, entryCss } = entryAssets(dist)
    expect(entryJs.map((a) => a.file)).toEqual(['assets/index-D96PxI5.js'])
    expect(entryCss.map((a) => a.file)).toEqual(['assets/index-CaGQnf75.css'])
  })

  it('leaves registerSW.js out — it is not part of the bundle', () => {
    const { entryJs } = entryAssets(dist)
    expect(entryJs.map((a) => a.file).join()).not.toContain('registerSW')
  })

  it('takes every vocab JSON and nothing else', () => {
    expect(vocabAssets(dist).map((a) => a.file)).toEqual(['vocab/nouns.json', 'vocab/verbs.json'])
  })

  it('treats a missing vocab directory as empty rather than throwing', () => {
    expect(vocabAssets(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([])
  })
})

describe('measuring', () => {
  it('reports gzipped bytes per group, summed across files', () => {
    const m = measure(dist)
    expect(m.entryJs.files).toHaveLength(1)
    expect(m.vocab.files).toHaveLength(2)
    expect(m.vocab.gzip).toBe(m.vocab.files.reduce((n, f) => n + f.gzip, 0))
    // Highly compressible fixtures, but the point is that gzip is what is measured.
    expect(m.entryJs.gzip).toBeGreaterThan(0)
    expect(m.entryJs.gzip).toBeLessThan(m.entryJs.files[0].raw)
  })
})

const budgetOf = (bytes) => ({
  limits: {
    entryJs: { bytes, label: 'Entry JS (gzip)', why: 'because' },
  },
})

describe('evaluating against the budget', () => {
  it('passes when the payload is inside the limit', () => {
    const [row] = evaluate(measure(dist), budgetOf(1_000_000))
    expect(row.ok).toBe(true)
    expect(row.used).toBeLessThan(1)
  })

  it('fails when the payload is over the limit', () => {
    const [row] = evaluate(measure(dist), budgetOf(1))
    expect(row.ok).toBe(false)
    expect(row.used).toBeGreaterThan(100)
  })

  it('fails a group the build did not produce rather than passing blindly', () => {
    // Zero bytes here means the script stopped finding the asset, not that the
    // asset got small — a gate reading 0.0% forever watches nothing.
    const [row] = evaluate({}, budgetOf(10))
    expect(row.actual).toBe(0)
    expect(row.found).toBe(false)
    expect(row.ok).toBe(false)
  })

  it('fails an entry group whose files list came back empty', () => {
    const [row] = evaluate({ entryJs: { files: [], gzip: 0 } }, budgetOf(10))
    expect(row.ok).toBe(false)
  })
})

describe('the published table', () => {
  it('renders a row per budgeted asset with a pass mark', () => {
    const measured = measure(dist)
    const md = renderSummary(measured, evaluate(measured, budgetOf(1_000_000)))
    expect(md).toContain('### 📦 Size budget')
    expect(md).toContain('Entry JS (gzip)')
    expect(md).toContain('✅')
    expect(md).not.toContain('❌')
  })

  it('says what went over, by how much, and what to do about it', () => {
    const measured = measure(dist)
    const md = renderSummary(measured, evaluate(measured, budgetOf(1)))
    expect(md).toContain('over budget')
    expect(md).toContain('❌')
    expect(md).toContain('over.')
    expect(md).toContain('scripts/size-budget.json')
  })

  it('says the gate has stopped measuring, not that the payload is small', () => {
    const md = renderSummary({}, evaluate({}, budgetOf(10)))
    expect(md).toContain('nothing measured')
    expect(md).toContain('Entry JS (gzip)')
    expect(md).toContain('❌')
    // Not the "raise the limit" advice — raising it would fix nothing here.
    expect(md).not.toContain('raise the limit')
  })

  it('lists the largest vocab files, so a jump has an address', () => {
    const measured = measure(dist)
    const md = renderSummary(measured, evaluate(measured, budgetOf(1_000_000)))
    expect(md).toContain('Largest vocab files')
    expect(md).toContain('vocab/nouns.json')
  })
})

describe('the committed budget', () => {
  const budget = JSON.parse(readFileSync(join(repo, 'scripts/size-budget.json'), 'utf8'))

  it('documents the ratchet, so nobody nudges a number to get green', () => {
    const about = budget._about.join(' ')
    expect(about).toMatch(/ratchet/i)
    expect(about).toMatch(/raised deliberately|raise/i)
  })

  it('gives every limit a byte count, a label and a reason', () => {
    const entries = Object.entries(budget.limits)
    expect(entries.length).toBeGreaterThan(0)
    for (const [key, limit] of entries) {
      expect(typeof limit.bytes, key).toBe('number')
      expect(limit.bytes, key).toBeGreaterThan(0)
      expect(limit.label, key).toBeTruthy()
      expect(limit.why, key).toBeTruthy()
    }
  })

  it('budgets the three things a learner waits for', () => {
    expect(Object.keys(budget.limits).sort()).toEqual(['entryCss', 'entryJs', 'vocab'])
  })
})
