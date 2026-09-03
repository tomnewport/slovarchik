import { describe, it, expect } from 'vitest'

import { PRIMARY_TABLE, STAGE_MIN_CELLS, columnStages, isCleanTable, tableKey } from './tableStage.js'

/** A table of `n` cells spread over the given columns. */
const table = (cols, n) => ({
  cols: cols.map((key) => ({ key, label: key })),
  cells: Array.from({ length: n }, (_, i) => ({
    row: `r${Math.floor(i / cols.length)}`,
    col: cols[i % cols.length],
    form: `f${i}`,
  })),
})

// A case × gender declension: four columns, well over the staging floor.
const gendered = table(['m', 'n', 'f', 'pl'], 28)
// A noun: two columns, under the floor even when every cell is filled.
const noun = table(['sg', 'pl'], 14)
const single = table(['_'], 4)

describe('tableKey', () => {
  it('names the primary paradigm and keeps a variant under its own name', () => {
    expect(tableKey(null)).toBe(PRIMARY_TABLE)
    expect(tableKey(undefined)).toBe(PRIMARY_TABLE)
    expect(tableKey('')).toBe(PRIMARY_TABLE)
    expect(tableKey('short')).toBe('short')
  })
})

describe('columnStages', () => {
  it('walks a multi-column table one column at a time when staging', () => {
    expect(columnStages(gendered, true)).toEqual([['m'], ['n'], ['f'], ['pl']])
  })

  it('serves the whole table as one stage once it has been earned', () => {
    expect(columnStages(gendered, false)).toEqual([['m', 'n', 'f', 'pl']])
  })

  it('leaves a small table whole — splitting two columns is not worth the click', () => {
    expect(columnStages(noun, true)).toEqual([['sg', 'pl']])
    expect(noun.cells).toHaveLength(14)
  })

  it('splits only once a table is past the floor', () => {
    expect(columnStages(table(['sg', 'pl'], STAGE_MIN_CELLS), true)).toEqual([['sg', 'pl']])
    expect(columnStages(table(['sg', 'pl'], STAGE_MIN_CELLS + 1), true)).toEqual([['sg'], ['pl']])
  })

  it('has nothing to split in a single-column table', () => {
    expect(columnStages(single, true)).toEqual([['_']])
    expect(columnStages(single, false)).toEqual([['_']])
  })

  it('always returns at least one stage', () => {
    expect(columnStages({ cols: [], cells: [] }, true)).toEqual([[]])
    expect(columnStages(null, true)).toEqual([[]])
  })
})

describe('isCleanTable', () => {
  it('accepts a table with every cell right', () => {
    expect(isCleanTable([{ correct: true, stressCorrect: true }, { correct: true, stressCorrect: true }])).toBe(true)
  })

  it('rejects a table with a wrong cell', () => {
    expect(isCleanTable([{ correct: true, stressCorrect: true }, { correct: false, stressCorrect: null }])).toBe(false)
  })

  it('accepts a stress mismatch — a soft warning, not a wrong cell', () => {
    expect(isCleanTable([{ correct: true, stressCorrect: false }])).toBe(true)
  })

  it('rejects an empty result rather than promoting on nothing', () => {
    expect(isCleanTable([])).toBe(false)
    expect(isCleanTable()).toBe(false)
  })
})
