import { describe, it, expect } from 'vitest'

import { renderSummary } from './coverage-summary.mjs'

const metric = (covered, total) => ({ covered, total, skipped: 0, pct: (covered / total) * 100 })

function entry({ statements, branches, functions, lines }) {
  return {
    statements: metric(...statements),
    branches: metric(...branches),
    functions: metric(...functions),
    lines: metric(...lines),
  }
}

const summary = {
  total: entry({ statements: [3, 4], branches: [1, 2], functions: [1, 1], lines: [3, 4] }),
  '/repo/src/lib/quiz.js': entry({
    statements: [10, 10],
    branches: [8, 10],
    functions: [4, 4],
    lines: [10, 10],
  }),
  '/repo/src/lib/idb.js': entry({
    statements: [10, 20],
    branches: [2, 10],
    functions: [2, 4],
    lines: [10, 20],
  }),
  '/repo/src/stores/vocab.js': entry({
    statements: [8, 10],
    branches: [4, 10],
    functions: [3, 4],
    lines: [9, 10],
  }),
  '/repo/src/views/HomeView.vue': entry({
    statements: [0, 100],
    branches: [0, 100],
    functions: [0, 10],
    lines: [0, 100],
  }),
}

describe('renderSummary', () => {
  const markdown = renderSummary(summary, '/repo')

  it('rolls each measured layer up separately', () => {
    // lib: 20/30 statements, 10/20 branches, 6/8 functions, 20/30 lines.
    expect(markdown).toContain('| src/lib | 66.67% | 50.00% | 75.00% | 66.67% |')
    expect(markdown).toContain('| src/stores | 80.00% | 40.00% | 75.00% | 90.00% |')
  })

  it('totals only the files it measures, ignoring the summary’s own total', () => {
    // 28/40 statements, 14/30 branches, 9/12 functions, 29/40 lines — the
    // `total` row and the unmeasured .vue file are both left out.
    expect(markdown).toContain('| **All measured** | 70.00% | 46.67% | 75.00% | 72.50% |')
  })

  it('omits layers with no files rather than dividing by zero', () => {
    expect(markdown).not.toContain('src/composables')
    expect(markdown).not.toMatch(/NaN/)
  })

  it('lists the least-covered files first and skips the fully covered ones', () => {
    const listed = [...markdown.matchAll(/\| `(src\/[^`]+)` \|/g)].map((m) => m[1])
    expect(listed).toEqual(['src/lib/idb.js', 'src/stores/vocab.js'])
  })
})
