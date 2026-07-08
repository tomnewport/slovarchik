import { describe, it, expect } from 'vitest'
import { revealDiff } from './spellReveal.js'

// Collapse a diff row back to its plain text, for the identity assertions.
const text = (row) => row.map((u) => u.text).join('')
// The characters flagged as differing on a row.
const off = (row) => row.filter((u) => !u.ok).map((u) => u.text)

describe('revealDiff', () => {
  it('flags nothing when the two forms match (folding case, ё/е and stress)', () => {
    const d = revealDiff('БАБОЧКУ', 'ба́бочку')
    expect(off(d.typed)).toEqual([])
    expect(off(d.answer)).toEqual([])
    // The answer row still carries its display glyphs (accent intact).
    expect(text(d.answer)).toBe('ба́бочку')
  })

  it('reveals a single wrong letter on both sides', () => {
    // A common near-miss: wrong final vowel.
    const d = revealDiff('бабочко', 'ба́бочку')
    expect(off(d.typed)).toEqual(['о'])
    expect(off(d.answer)).toEqual(['у'])
  })

  it('pinpoints a Latin homoglyph that looks identical', () => {
    // "ноябре" typed with a Latin "e" — visually identical, graded wrong.
    const d = revealDiff('ноябрe', 'ноябре́')
    expect(off(d.typed)).toEqual(['e']) // the Latin e
    expect(off(d.answer)).toEqual(['е́']) // the Cyrillic е (accent kept on display)
  })

  it('does not flag a mis-typed spacing accent as an extra character', () => {
    // U+00B4 acute — forgiven, so the words line up cleanly.
    const d = revealDiff('ноябре´', 'ноябре́')
    expect(off(d.typed)).toEqual([])
    expect(off(d.answer)).toEqual([])
  })

  it('marks an omitted letter on the answer side', () => {
    const d = revealDiff('нобре', 'ноябре')
    expect(off(d.typed)).toEqual([])
    expect(off(d.answer)).toEqual(['я'])
  })

  it('marks an extra letter on the typed side', () => {
    const d = revealDiff('нояябре', 'ноябре')
    expect(off(d.typed)).toEqual(['я'])
    expect(off(d.answer)).toEqual([])
  })

  it('handles an empty typed answer', () => {
    const d = revealDiff('', 'ноябре')
    expect(d.typed).toEqual([])
    expect(off(d.answer)).toEqual([...'ноябре'])
  })
})
