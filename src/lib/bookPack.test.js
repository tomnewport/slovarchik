import { describe, expect, it } from 'vitest'
import { validatePack } from './bookPack.js'

const entry = { id: 'tale', packVersion: 1, translationVersion: 1 }
const pack = {
  schemaVersion: 1, id: 'tale', packVersion: 1, translationVersion: 1, form: 'verse',
  source: { editionId: 'edition', url: 'https://example.org/source' },
  rights: { original: 'public domain', translation: 'newly written' },
  sentences: [
    { id: 'tale:1.0.1', paragraph: '1.0', kind: 'heading', ru: 'Часть I', en: 'Part I' },
    { id: 'tale:1.0.2', paragraph: '1.0', kind: 'epigraph', ru: 'Начинается сказка.', en: 'The tale begins.' },
    { id: 'tale:1.1.1', paragraph: '1.1', ru: 'Жил старик.', en: 'An old man lived.' },
  ],
}

describe('a downloaded pack with part headings', () => {
  it('accepts a heading and an epigraph beside ordinary units', () => {
    expect(validatePack(pack, entry)).toBe(pack)
  })

  it('rejects a unit kind the reader does not know how to set', () => {
    const odd = { ...pack, sentences: [{ ...pack.sentences[0], kind: 'footnote' }] }
    expect(() => validatePack(odd, entry)).toThrow('Invalid or untranslated sentence')
  })
})
