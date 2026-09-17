import { describe, expect, it } from 'vitest'
import { buildFormIndex } from './phraseHint.js'
import { lookupReaderWord, readerTokens } from './readerDictionary.js'

describe('literature dictionary', () => {
  it('keeps punctuation while making individual words tappable', () => {
    expect(readerTokens('«Стали — друзья!»').map((t) => [t.text, t.word])).toEqual([
      ['«', false], ['Стали', true], [' — ', false], ['друзья', true], ['!»', false],
    ])
  })

  it('shows every dictionary claimant for an ambiguous inflected form', () => {
    const words = [
      { key: 'стать=become', ru: 'стать', headword: 'ста́ть', meaning: 'to become', pos: 'verb', aspect: 'pf', extra: { conjugation: { past_pl: 'ста́ли' } } },
      { key: 'сталь=steel', ru: 'сталь', headword: 'ста́ль', meaning: 'steel', pos: 'noun', gender: 'f', forms: { sg: { nom: 'ста́ль' }, pl: { nom: 'ста́ли' } } },
    ]
    const result = lookupReaderWord('Стали', buildFormIndex(words), new Map(words.map((w) => [w.key, w])))
    expect(result.map((r) => r.meaning).sort()).toEqual(['steel', 'to become'])
    expect(result.find((r) => r.meaning === 'steel').morphology).toContain('Nominative plural')
  })

  it('returns no entries when a literary name is absent from the dictionary', () => {
    expect(lookupReaderWord('Непридуманное', buildFormIndex([]), new Map())).toEqual([])
  })
})
