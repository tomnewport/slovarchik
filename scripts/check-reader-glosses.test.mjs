import { describe, expect, it } from 'vitest'
import { curriculumLeaks, readerVocabDocs } from './check-reader-glosses.mjs'

describe('reader-only vocabulary stays out of the curriculum', () => {
  it('names an entry that forgot its learn: false', () => {
    expect(curriculumLeaks([
      { file: 'reader-glosses.yml', words: { 'щёголь=dandy': { learn: false }, 'фрунт=attention': {} } },
      { file: 'reader-names.yml', words: { 'Маркс=Marx': { learn: true } } },
    ])).toEqual(['reader-glosses.yml: фрунт=attention', 'reader-names.yml: Маркс=Marx'])
  })

  it('has nothing to say about an empty or absent file', () => {
    expect(curriculumLeaks([{ file: 'reader-nouns.yml', words: undefined }])).toEqual([])
    expect(curriculumLeaks(undefined)).toEqual([])
  })

  it('finds the shipped reader files, and none of them enters the curriculum', () => {
    const docs = readerVocabDocs()
    expect(docs.map((doc) => doc.file)).toContain('reader-glosses.yml')
    expect(curriculumLeaks(docs)).toEqual([])
  })
})
