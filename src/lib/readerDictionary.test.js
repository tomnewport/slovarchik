import { describe, expect, it } from 'vitest'
import { buildFormIndex } from './phraseHint.js'
import { lookupReaderWord, readerTokens } from './readerDictionary.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('literature dictionary', () => {
  it('keeps punctuation while making individual words tappable', () => {
    expect(readerTokens('«Стали — друзья!»').map((t) => [t.text, t.word])).toEqual([
      ['«', false], ['Стали', true], [' — ', false], ['друзья', true], ['!»', false],
    ])
  })

  it('leaves alone what no Russian dictionary can explain: Latin text and a stranded ordinal ending', () => {
    expect(readerTokens('ученик III класса').map((t) => [t.text, t.word])).toEqual([
      ['ученик', true], [' ', false], ['III', false], [' ', false], ['класса', true],
    ])
    expect(readerTokens('6-ым изданием').map((t) => [t.text, t.word])).toEqual([
      ['6-', false], ['ым', false], [' ', false], ['изданием', true],
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

  it('looks up the shipped titles and their inflected story forms without adding drills', () => {
    const words = loadFixtureWords()
    const index = buildFormIndex(words)
    const byKey = new Map(words.map((word) => [word.key, word]))
    for (const surface of [
      'голубка', 'голубку', 'косточка', 'косточки', 'косточку', 'горнице', 'рак',
      'окошко', 'нехорошо', 'пропела', 'настает', 'Савинкова', 'Вольтерина',
      'заложники', 'офицеров-врангелевцев', 'беспощадно', 'попы', 'Правде',
    ]) {
      const entries = lookupReaderWord(surface, index, byKey)
      expect(entries.length, surface).toBeGreaterThan(0)
      expect(entries.some((entry) => words.find((word) => word.key === entry.key)?.learnable === false), surface).toBe(true)
    }
    expect(lookupReaderWord('косточку', index, byKey).find((entry) => entry.key === 'косточка=stone').morphology).toContain('Accusative singular')
  })

  it('prints no part of speech for a gloss-only stub, whose "glossary" is a filing decision', () => {
    const words = loadFixtureWords()
    const entries = lookupReaderWord('каутскианством', buildFormIndex(words), new Map(words.map((w) => [w.key, w])))
    expect(entries.map((entry) => entry.pos)).toEqual([''])
  })
})
