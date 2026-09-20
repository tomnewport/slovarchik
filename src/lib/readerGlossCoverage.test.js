import { describe, expect, it } from 'vitest'
import { readerGlossCoverage, unglossedReaderWords } from './readerGlossCoverage.js'

const books = [
  { id: 'one', sentences: [{ id: 'one:01', ru: 'Муравей спустился к ручью.' }, { id: 'one:02', ru: 'Голубка несла ветку.' }] },
  { id: 'two', sentences: [{ id: 'two:01', ru: 'Ручью — III, 6-ым изданием!' }] },
]
const known = new Set(['муравей', 'спустился', 'к', 'голубка', 'несла', 'ветку', 'изданием'])
const lookup = (surface) => (known.has(surface.toLowerCase()) ? [{ key: surface }] : [])

describe('reader gloss coverage', () => {
  it('names each unglossed form once, busiest first, with somewhere to read it', () => {
    expect(unglossedReaderWords(books, lookup)).toEqual([
      { form: 'ручью', count: 2, books: ['one', 'two'], sentenceId: 'one:01', ru: 'Муравей спустился к ручью.' },
    ])
  })

  it('leaves out what is never tappable: a Latin numeral and a stranded ordinal ending', () => {
    const forms = unglossedReaderWords(books, () => []).map((word) => word.form)
    expect(forms).not.toContain('iii')
    expect(forms).not.toContain('ым')
  })

  it('counts occurrences per book, not types, because a reader meets occurrences', () => {
    expect(readerGlossCoverage(books, lookup)).toEqual([
      { book: 'one', tokens: 7, unglossed: 1 },
      { book: 'two', tokens: 2, unglossed: 1 },
    ])
  })

  it('has nothing to report for no books at all', () => {
    expect(unglossedReaderWords(undefined, lookup)).toEqual([])
    expect(readerGlossCoverage(undefined, lookup)).toEqual([])
  })
})
