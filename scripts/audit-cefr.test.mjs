import { describe, it, expect } from 'vitest'

import {
  collectEntries,
  invalidLevelFlags,
  anchorFlags,
  cohortFlags,
  shapeFlags,
} from './audit-cefr.js'

/** Build `n` throwaway entries in one collection at the given levels. */
function pack(collection, levels) {
  const words = {}
  levels.forEach((level, i) => {
    words[`слово${i}=word${i}`] = { cefr_level: level, collections: [collection] }
  })
  return { words }
}

describe('collectEntries', () => {
  it('normalises keys, levels, collections and learnability', () => {
    const [entry] = collectEntries({
      'nouns.yml': { words: { 'го́род=city': { cefr_level: 'A1', collections: ['places'] } } },
    })
    expect(entry).toEqual({
      file: 'nouns.yml',
      key: 'го́род=city',
      ru: 'город', // stress-stripped, lower-cased
      level: 'A1',
      collections: ['places'],
      learn: true,
    })
  })

  it('marks gloss-only entries (learn: false) as unlearnable', () => {
    const [entry] = collectEntries({
      'glossary.yml': { words: { 'ва́зе=vase': { cefr_level: 'A1', learn: false } } },
    })
    expect(entry.learn).toBe(false)
    expect(entry.collections).toEqual([])
  })
})

describe('invalidLevelFlags', () => {
  it('flags missing and out-of-range levels only', () => {
    const entries = collectEntries({
      'nouns.yml': {
        words: {
          'дом=house': { cefr_level: 'A1' },
          'изба=hut': { cefr_level: 'D1' },
          'сарай=shed': {},
        },
      },
    })
    expect(invalidLevelFlags(entries).map((f) => f.key)).toEqual(['изба=hut', 'сарай=shed'])
  })
})

describe('anchorFlags', () => {
  it('flags a word stored two or more levels from its anchor', () => {
    const entries = collectEntries({
      'nouns.yml': { words: { 'го́род=city': { cefr_level: 'B1' } } },
    })
    expect(anchorFlags(entries, { город: 'A1' })).toHaveLength(1)
  })

  it('leaves a one-level disagreement alone', () => {
    const entries = collectEntries({
      'nouns.yml': { words: { 'го́род=city': { cefr_level: 'A2' } } },
    })
    expect(anchorFlags(entries, { город: 'A1' })).toEqual([])
  })
})

describe('cohortFlags', () => {
  it('flags a topic pack stamped with one level — the #529 failure mode', () => {
    // 14 of 18 at A1, exactly like the original `character` pack.
    const levels = [...Array(14).fill('A1'), 'B1', 'B1', 'B1', 'B2']
    const [flag] = cohortFlags(collectEntries({ 'adjectives.yml': pack('character', levels) }))
    expect(flag.collection).toBe('character')
    expect(flag.level).toBe('A1')
    expect(flag.size).toBe(18)
    expect(flag.share).toBeCloseTo(14 / 18)
  })

  it('ignores a collection with a healthy spread', () => {
    const levels = [...Array(5).fill('A1'), ...Array(5).fill('A2'), ...Array(5).fill('B1')]
    expect(cohortFlags(collectEntries({ 'nouns.yml': pack('family', levels) }))).toEqual([])
  })

  it('ignores small collections, however uniform', () => {
    const levels = Array(9).fill('A1')
    expect(cohortFlags(collectEntries({ 'nouns.yml': pack('weather', levels) }))).toEqual([])
    expect(cohortFlags(collectEntries({ 'nouns.yml': pack('weather', levels) }), { minSize: 5 })).toHaveLength(1)
  })

  it('flags drift towards any level, not just the easy end', () => {
    const [flag] = cohortFlags(collectEntries({ 'nouns.yml': pack('politics', Array(12).fill('B1')) }))
    expect(flag.level).toBe('B1')
  })

  it('skips gloss-only entries', () => {
    const words = {}
    for (let i = 0; i < 12; i++) {
      words[`слово${i}=word${i}`] = { cefr_level: 'A1', learn: false, collections: ['daily life'] }
    }
    expect(cohortFlags(collectEntries({ 'glossary.yml': { words } }))).toEqual([])
  })
})

describe('shapeFlags', () => {
  const flagsFor = (words) => shapeFlags(collectEntries({ 'adjectives.yml': { words } }))

  it('flags a very long A1 headword', () => {
    const flags = flagsFor({ 'многофункциона́льный=multifunctional': { cefr_level: 'A1' } })
    expect(flags).toHaveLength(1)
    expect(flags[0].why).toContain('19 letters')
  })

  it('flags transparent internationalisms at A1/A2', () => {
    const flags = flagsFor({
      'харизмати́чный=charismatic': { cefr_level: 'A1' },
      'рациона́льный=rational': { cefr_level: 'A1' },
      'вентиля́ция=ventilation': { cefr_level: 'A2' },
    })
    expect(flags.map((f) => f.ru)).toEqual(['харизматичный', 'рациональный', 'вентиляция'])
  })

  it('leaves short native elementary words alone', () => {
    expect(flagsFor({ 'хлеб=bread': { cefr_level: 'A1' }, 'краси́вый=beautiful': { cefr_level: 'A2' } })).toEqual([])
  })

  it('measures the longest word of a multi-word headword, not the whole string', () => {
    // 15 letters in total, but nothing longer than 7 in one word.
    expect(flagsFor({ 'зелёный горо́шек=green peas': { cefr_level: 'A1' } })).toEqual([])
  })

  it('says nothing about B1+ entries, where long and borrowed words belong', () => {
    expect(flagsFor({ 'многофункциона́льный=multifunctional': { cefr_level: 'B2' } })).toEqual([])
  })
})
