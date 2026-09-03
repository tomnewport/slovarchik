import { describe, it, expect } from 'vitest'

import { PRIMARY_TABLE, columnStages, isCleanTable, tableKey } from './tableStage.js'

const gendered = {
  cols: [
    { key: 'm', label: 'Masc.' },
    { key: 'n', label: 'Neut.' },
    { key: 'f', label: 'Fem.' },
    { key: 'pl', label: 'Plural' },
  ],
}
const single = { cols: [{ key: '_', label: 'Form' }] }

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

  it('has nothing to split in a single-column table', () => {
    expect(columnStages(single, true)).toEqual([['_']])
    expect(columnStages(single, false)).toEqual([['_']])
  })

  it('always returns at least one stage', () => {
    expect(columnStages({ cols: [] }, true)).toEqual([[]])
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

  it('rejects a stress mismatch — the wrong chip went in the cell', () => {
    expect(isCleanTable([{ correct: true, stressCorrect: false }])).toBe(false)
  })

  it('rejects an empty result rather than promoting on nothing', () => {
    expect(isCleanTable([])).toBe(false)
    expect(isCleanTable()).toBe(false)
  })
})
