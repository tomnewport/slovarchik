import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'

import { toPlain } from './plain.js'

describe('toPlain', () => {
  it('deep-copies plain data', () => {
    const src = { a: 1, nested: { list: [1, 2, 3] } }
    const copy = toPlain(src)
    expect(copy).toEqual(src)
    expect(copy).not.toBe(src)
    expect(copy.nested).not.toBe(src.nested)
    copy.nested.list.push(4)
    expect(src.nested.list).toEqual([1, 2, 3])
  })

  it('unwraps reactive proxies, nested ones included', () => {
    const state = reactive({ batch: { level: 'learning', words: ['дом', 'кот'] } })
    const copy = toPlain(state)
    // A reactive read hands back a proxy; the copy must be raw all the way down.
    expect(state.batch).not.toBe(copy.batch)
    expect(copy).toEqual({ batch: { level: 'learning', words: ['дом', 'кот'] } })
    // Structured clone is what IndexedDB uses, so a clonable value is storable.
    expect(() => structuredClone(copy)).not.toThrow()
  })

  it('unwraps proxies held inside a hand-built container', () => {
    // The shape `exportData` builds: a plain literal whose fields are reactive
    // reads. `structuredClone` throws DataCloneError on a Proxy, so these have
    // to be unwrapped before it sees them.
    const state = reactive({ learning: { words: ['дом'] }, mastery: null })
    const snapshot = { batches: { learning: state.learning }, list: [state.learning] }
    const copy = toPlain(snapshot)
    expect(copy.batches.learning).toEqual({ words: ['дом'] })
    expect(copy.list[0]).toEqual({ words: ['дом'] })
  })

  it('copies a reactive sub-object without dragging its proxy along', () => {
    const state = reactive({ schedule: { due: 1000, dims: { spell: 3 } } })
    const copy = toPlain(state.schedule)
    state.schedule.dims.spell = 9
    expect(copy.dims.spell).toBe(3)
  })

  it('preserves what the JSON round-trip it replaces destroyed', () => {
    const src = { m: new Map([['k', 1]]), s: new Set([1, 2]), d: new Date(0), missing: undefined }
    const copy = toPlain(src)
    expect(copy.m.get('k')).toBe(1)
    expect(copy.s.has(2)).toBe(true)
    expect(copy.d).toBeInstanceOf(Date)
    expect('missing' in copy).toBe(true)
  })

  it('passes primitives and null straight through', () => {
    expect(toPlain(null)).toBe(null)
    expect(toPlain(undefined)).toBe(undefined)
    expect(toPlain(42)).toBe(42)
    expect(toPlain('дом')).toBe('дом')
  })

  it('unwraps a ref that is handed over by value', () => {
    const r = ref({ words: ['дом'] })
    expect(toPlain(r.value)).toEqual({ words: ['дом'] })
  })

  it('throws loudly on an unclonable value instead of dropping it', () => {
    expect(() => toPlain({ fn: () => {} })).toThrow()
  })
})
