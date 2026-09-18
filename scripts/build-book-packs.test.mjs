import { describe, expect, it } from 'vitest'
import { assertVersionBump, buildPack } from './build-book-packs.mjs'

const source = {
  id: 'fable', title: 'Fable', author: 'Author', shelf: 'Children’s', summary: 'A short fable.',
  packVersion: 1, translationVersion: 1,
  source: { editionId: 'edition', url: 'https://example.org/source' },
  rights: { original: 'public domain', translation: 'newly written' },
  translationReview: { method: 'sentence-by-sentence contextual review' },
  sentences: [{ id: 'fable:p1:1', paragraph: 'p1', ru: 'Была зима.', en: 'Winter had come.', review: 'checked' }],
}

describe('literature editorial gate', () => {
  it('keeps IDs stable while excluding editorial notes from the download', () => {
    const pack = buildPack(source)
    expect(pack.sentences).toEqual([{ id: 'fable:p1:1', paragraph: 'p1', ru: 'Была зима.', en: 'Winter had come.' }])
    expect(() => buildPack({ ...source, sentences: [{ ...source.sentences[0], review: 'draft' }] })).toThrow('Unreviewed')
    expect(() => buildPack({ ...source, form: 'scroll' })).toThrow('Incomplete')
  })

  it('allows an English-only revision without changing Russian IDs or the app', () => {
    const oldPack = buildPack(source)
    const revised = buildPack({ ...source, translationVersion: 2,
      sentences: [{ ...source.sentences[0], en: 'Winter came.' }] })
    expect(() => assertVersionBump(oldPack, revised)).not.toThrow()
    expect(() => assertVersionBump(oldPack, { ...revised, translationVersion: 1 })).toThrow('translationVersion')
    expect(() => assertVersionBump(oldPack, { ...revised, sentences: [{ ...revised.sentences[0], ru: 'Зима пришла.' }] })).toThrow('packVersion')
    expect(() => assertVersionBump(oldPack, { ...oldPack, form: 'verse' })).toThrow('packVersion')
  })
})
