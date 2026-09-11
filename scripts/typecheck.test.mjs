import { describe, it, expect } from 'vitest'

import { parseErrors, byFile, byCode, compare, summarise } from './typecheck.mjs'

const SAMPLE = [
  "src/lib/focus.js(64,3): error TS2339: Property 'stateOf' does not exist on type '{}'.",
  "src/lib/focus.js(70,9): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/stores/hints.js(20,1): error TS2339: Property 'x' does not exist on type '{}'.",
  'Found 3 errors in 2 files.',
].join('\n')

describe('parseErrors', () => {
  it('keeps only the lines tsc marked as errors', () => {
    expect(parseErrors(SAMPLE)).toHaveLength(3)
  })

  it('ignores the trailing summary line', () => {
    expect(parseErrors(SAMPLE).some((e) => e.startsWith('Found'))).toBe(false)
  })

  it('returns nothing for a clean run', () => {
    expect(parseErrors('')).toEqual([])
  })
})

describe('byFile', () => {
  it('counts per file, most errors first', () => {
    expect(byFile(parseErrors(SAMPLE))).toEqual([
      ['src/lib/focus.js', 2],
      ['src/stores/hints.js', 1],
    ])
  })
})

describe('byCode', () => {
  it('counts per error code, most frequent first', () => {
    expect(byCode(parseErrors(SAMPLE))).toEqual([
      ['TS2339', 2],
      ['TS2322', 1],
    ])
  })
})

describe('compare', () => {
  const ceiling = { 'src/lib/focus.js': 2, 'src/stores/hints.js': 1 }

  it('passes when every file is at its ceiling', () => {
    const { grown, shrunk } = compare(byFile(parseErrors(SAMPLE)), ceiling)
    expect(grown).toEqual([])
    expect(shrunk).toEqual([])
  })

  it('names a file that gained an error', () => {
    const { grown } = compare([['src/lib/focus.js', 3]], ceiling)
    expect(grown).toEqual([{ file: 'src/lib/focus.js', was: 2, now: 3 }])
  })

  it('names a file that lost one, so the gain can be held', () => {
    const { shrunk } = compare([['src/lib/focus.js', 2]], ceiling)
    expect(shrunk).toContainEqual({ file: 'src/stores/hints.js', was: 1, now: 0 })
  })

  it('catches a file the ceiling has never heard of', () => {
    const { grown } = compare([['src/lib/new.js', 1]], ceiling)
    expect(grown).toContainEqual({ file: 'src/lib/new.js', was: 0, now: 1 })
  })

  it('does not let a fix in one file hide a regression in another', () => {
    const { grown } = compare(
      [
        ['src/lib/focus.js', 3],
        ['src/stores/hints.js', 0],
      ],
      ceiling,
    )
    expect(grown).toEqual([{ file: 'src/lib/focus.js', was: 2, now: 3 }])
  })
})

describe('summarise', () => {
  it('reports the count against the ceiling', () => {
    expect(summarise(parseErrors(SAMPLE), 3)).toContain('**3** errors against a ceiling of **3**')
  })

  it('says so plainly when there is nothing to report', () => {
    const markdown = summarise([], 0)
    expect(markdown).toContain('**0** errors')
    expect(markdown).not.toContain('| file |')
  })
})
