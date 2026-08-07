import { describe, it, expect } from 'vitest'

import {
  collectEntries,
  invalidLevelFlags,
  anchorFlags,
  cohortFlags,
  shapeFlags,
  pairFlags,
  loadDocs,
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
      en: 'city',
      level: 'A1',
      collections: ['places'],
      learn: true,
      pair: null,
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

describe('pairFlags', () => {
  const verbs = (words) => pairFlags(collectEntries({ 'verbs.yml': { words } }))

  it('flags an aspect pair split across levels, reporting the unreachable half', () => {
    const [flag] = verbs({
      'уметь=to be able': { cefr_level: 'A1', pair: 'суметь=to manage' },
      'суметь=to manage': { cefr_level: 'B1', pair: 'уметь=to be able' },
    })
    expect(flag.key).toBe('суметь=to manage') // the higher half, the one out of reach
    expect(flag.gap).toBe(2)
    expect(flag.why).toContain('уметь=to be able is A1')
  })

  it('reports a split pair once, not once per direction', () => {
    expect(
      verbs({
        'уметь=to be able': { cefr_level: 'A1', pair: 'суметь=to manage' },
        'суметь=to manage': { cefr_level: 'B1', pair: 'уметь=to be able' },
      }),
    ).toHaveLength(1)
  })

  it('says nothing when both halves share a level', () => {
    expect(
      verbs({
        'смотреть=to watch': { cefr_level: 'A1', pair: 'посмотреть=to look' },
        'посмотреть=to look': { cefr_level: 'A1', pair: 'смотреть=to watch' },
      }),
    ).toEqual([])
  })

  it('ignores a pair whose partner is not in the corpus', () => {
    expect(verbs({ 'уметь=to be able': { cefr_level: 'A1', pair: 'суметь=to manage' } })).toEqual([])
  })

  it('flags a masculine/feminine noun pair split by level', () => {
    const [flag] = pairFlags(
      collectEntries({
        'nouns.yml': {
          words: {
            'студент=student': { cefr_level: 'A1' },
            'студентка=student (f)': { cefr_level: 'A2' },
          },
        },
      }),
    )
    expect(flag.key).toBe('студентка=student (f)')
    expect(flag.why).toContain('gender partner студент=student is A1')
  })

  it('does not pair a "(f)" gloss with an unrelated word of the same name', () => {
    expect(
      pairFlags(
        collectEntries({
          'nouns.yml': {
            words: {
              'учительница=teacher (f)': { cefr_level: 'A2' },
              'преподаватель=lecturer': { cefr_level: 'B1' },
            },
          },
        }),
      ),
    ).toEqual([])
  })

  it('skips gloss-only entries, which are never taught in the first place', () => {
    expect(
      verbs({
        'уметь=to be able': { cefr_level: 'A1', learn: false, pair: 'суметь=to manage' },
        'суметь=to manage': { cefr_level: 'B1', learn: false, pair: 'уметь=to be able' },
      }),
    ).toEqual([])
  })
})

// The other heuristics in this file are judgement calls and stay advisory — a
// cohort or a long headword is a prompt to look, not a defect. A split pair is
// different: the two halves are one lexical item, so a split is a bug in the
// metadata unless someone has decided otherwise in writing. Locking it down
// here stops the 50 splits fixed in #529 from creeping back one entry at a time.
describe('the corpus itself', () => {
  // Pairs that are deliberately split, with the reason. Add to this list only
  // when the two halves really do differ in difficulty, and say why.
  const ALLOWED_SPLITS = {
    'полюбить=to come to love': 'inceptive "to come to love" is a later nuance than любить',
    'суметь=to manage': 'rarer than уметь; brought within one level of it rather than merged',
  }

  it('keeps both halves of every aspect and gender pair at the same level', () => {
    const splits = pairFlags(collectEntries(loadDocs()))
    const unexpected = splits.filter((s) => !ALLOWED_SPLITS[s.key])
    expect(unexpected.map((s) => `${s.key} (${s.level}) — ${s.why}`)).toEqual([])
  })

  it('keeps a deliberately split pair within one level', () => {
    for (const split of pairFlags(collectEntries(loadDocs()))) {
      expect(split.gap, `${split.key}: ${split.why}`).toBeLessThanOrEqual(1)
    }
  })
})
