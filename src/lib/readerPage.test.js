import { describe, expect, it } from 'vitest'
import { pageEnd, pageStart, pageParagraphs } from './readerPage.js'

describe('reader pages', () => {
  const fits = (start, end) => end - start <= 3

  it('reflows around a stable sentence rather than a saved page', () => {
    expect(pageEnd(10, 3, fits)).toBe(6)
    expect(pageEnd(10, 3, (start, end) => end - start <= 2)).toBe(5)
    expect(pageStart(6, fits)).toBe(3)
    expect(pageStart(3, fits)).toBe(0)
  })

  it('keeps a sentence longer than the viewport navigable', () => {
    expect(pageEnd(3, 1, () => false)).toBe(2)
    expect(pageStart(2, () => false)).toBe(1)
  })

  it('keeps adjacent sentences in their source paragraphs', () => {
    const sentences = [{ id: 'a', paragraph: 'p1' }, { id: 'b', paragraph: 'p1' }, { id: 'c', paragraph: 'p2' }]
    expect(pageParagraphs(sentences).map((p) => p.sentences.map((s) => s.id))).toEqual([['a', 'b'], ['c']])
  })
})
