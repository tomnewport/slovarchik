import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import {
  breakdownCandidates,
  derivationCandidates,
  confusableCandidates,
  factCoverage,
  PRODUCTIVE_PREFIXES,
} from './factCoverage.js'
import { loadFixtureWords } from '../test/fixtures.js'

const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

const verb = (key, accented, extra = '') => `
  "${key}":
    cefr_level: A1
    accented: ${accented}
    en_gb: { standard: ${key.split('=')[1]} }${extra}`

describe('breakdownCandidates', () => {
  const family = fromYaml([
    {
      pos: 'verb',
      text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('входить=to enter', 'входи́ть')}${verb('выходить=to exit', 'выходи́ть')}${verb('находиться=to be located', 'находи́ться')}${verb('думать=to think', 'ду́мать')}`,
    },
  ])

  it('finds a prefixed word whose stem is itself an entry', () => {
    const keys = breakdownCandidates(family).map((c) => c.key)
    expect(keys).toContain('входить=to enter')
    expect(keys).toContain('выходить=to exit')
  })

  it('names the prefix and the root the see: link should point at', () => {
    const enter = breakdownCandidates(family).find((c) => c.key === 'входить=to enter')
    expect(enter).toMatchObject({ prefix: 'в', root: { key: 'ходить=to go', ru: 'ходи́ть' } })
  })

  it('sees through a reflexive ending', () => {
    const keys = breakdownCandidates(family).map((c) => c.key)
    expect(keys).toContain('находиться=to be located')
  })

  it('ignores a word whose stem is not an entry', () => {
    expect(breakdownCandidates(family).map((c) => c.key)).not.toContain('думать=to think')
  })

  it('never proposes the root itself', () => {
    expect(breakdownCandidates(family).map((c) => c.key)).not.toContain('ходить=to go')
  })

  it('ranks by root-family size — the reach is what makes a fact worth writing', { timeout: 60_000 }, () => {
    const ranked = breakdownCandidates(loadFixtureWords())
    // Assert the ordering itself rather than how big the biggest family happens
    // to be today: authoring facts drains the large families, so any threshold
    // on ranked[0].family measures how much has been written, not the ranking.
    const sizes = ranked.map((c) => c.family)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    // …and that it is ranking real families, not a list of singletons.
    expect(sizes[0]).toBeGreaterThan(1)
  })

  it('drops a word that already carries a build or root fact', () => {
    const done = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('входить=to enter', 'входи́ть', `
    facts:
      - { kind: root, text: Same root as ходить. }`)}`,
      },
    ])
    expect(breakdownCandidates(done)).toEqual([])
  })

  it('prefers the longest matching prefix', () => {
    // «под» is tried before «по», so подходи́ть is под + ходи́ть rather than a
    // failed по + дходить.
    expect(PRODUCTIVE_PREFIXES.indexOf('под')).toBeLessThan(PRODUCTIVE_PREFIXES.indexOf('по'))
    const words = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('подходить=to approach', 'подходи́ть')}`,
      },
    ])
    expect(breakdownCandidates(words)[0]).toMatchObject({ prefix: 'под', root: { ru: 'ходи́ть' } })
  })

  it('reads переводи́ть as пере + води́ть', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('водить=to lead', 'води́ть')}${verb('переводить=to translate', 'переводи́ть')}`,
      },
    ])
    expect(breakdownCandidates(words)[0]).toMatchObject({ prefix: 'пере', root: { ru: 'води́ть' } })
  })

  it('is empty for an empty corpus', () => {
    expect(breakdownCandidates([])).toEqual([])
    expect(breakdownCandidates()).toEqual([])
  })
})

describe('derivationCandidates', () => {
  it('flags a productive suffix and guesses where it came from', () => {
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('учить=to teach', 'учи́ть')}` },
      {
        pos: 'noun',
        text: `
words:
  "учитель=teacher":
    cefr_level: A1
    accented: учи́тель
    gender: m
    animacy: a
    en_gb: { standard: teacher }
`,
      },
    ])
    const [teacher] = derivationCandidates(words)
    expect(teacher).toMatchObject({ key: 'учитель=teacher', suffix: 'тель' })
    expect(teacher.from.key).toBe('учить=to teach')
  })

  it('still reports a suffixed word whose source is not in the corpus', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "радость=joy":
    cefr_level: A2
    accented: ра́дость
    gender: f
    animacy: i
    en_gb: { standard: joy }
`,
      },
    ])
    expect(derivationCandidates(words)[0]).toMatchObject({ suffix: 'ость', from: null })
  })
})

describe('confusableCandidates', () => {
  const pair = (aKey, aRu, aEn, bKey, bRu, bEn, level = 'A2') => `
words:
  "${aKey}":
    cefr_level: ${level}
    accented: ${aRu}
    en_gb: { standard: ${aEn} }
  "${bKey}":
    cefr_level: ${level}
    accented: ${bRu}
    en_gb: { standard: ${bEn} }
`

  it('shortlists a near-identical pair', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring') },
    ])
    const [found] = confusableCandidates(words)
    expect([found.a.key, found.b.key].sort()).toEqual(['звенеть=to ring', 'звонить=to call'])
    expect(found.distance).toBe(1)
  })

  it('ignores short words, where an edit distance of 1 means nothing', () => {
    // Every one-letter function word is "distance 1" from every other; without
    // a length floor the shortlist is nothing else.
    const words = fromYaml([{ pos: 'preposition', text: pair('в=in', 'в', 'in', 'к=towards', 'к', 'towards') }])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('normalises by length, so a long pair may differ by more than a short one', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('становиться=to become', 'станови́ться', 'to become', 'остановиться=to stop', 'останови́ться', 'to stop') },
    ])
    expect(confusableCandidates(words)).toHaveLength(1)
  })

  it('leaves an aspect pair alone — that link is derived, and authoring it fails CI', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "писать=to write":
    cefr_level: A1
    accented: писа́ть
    aspect: impf
    pair: "написать=to write"
    en_gb: { standard: to write }
  "написать=to write":
    cefr_level: A1
    accented: написа́ть
    aspect: pf
    pair: "писать=to write"
    en_gb: { standard: to write }
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('leaves a heteronym pair alone too', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "замок=castle":
    cefr_level: B1
    accented: за́мок
    gender: m
    animacy: i
    en_gb: { standard: castle }
  "замок=lock":
    cefr_level: B1
    accented: замо́к
    gender: m
    animacy: i
    en_gb: { standard: lock }
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('skips a pair already authored as confusable', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звенеть=to ring":
    cefr_level: A2
    accented: звене́ть
    en_gb: { standard: to ring }
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    confusable_with: [{ key: "звенеть=to ring", why: One is a bell. }]
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('skips words too far apart in level to be met together', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring').replace('cefr_level: A2\n    accented: звене́ть', 'cefr_level: C1\n    accented: звене́ть') },
    ])
    expect(confusableCandidates(words)).toEqual([])
    expect(confusableCandidates(words, { maxCefrGap: 5 })).toHaveLength(1)
  })

  // Corpus-scale: the scan considers millions of pairs, so it gets headroom
  // over the default per-test timeout for a slow CI runner.
  it('reports the closest pairs first', { timeout: 60_000 }, () => {
    const ranked = confusableCandidates(loadFixtureWords())
    expect(ranked.length).toBeGreaterThan(0)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].ratio).toBeGreaterThanOrEqual(ranked[i - 1].ratio)
    }
  })
})

describe('factCoverage', () => {
  const words = loadFixtureWords()

  it('counts the learnable corpus, by part of speech and by level', () => {
    const cov = factCoverage(words)
    expect(cov.total.words).toBe(words.filter((w) => w.learnable !== false).length)
    expect(cov.byPos.map((r) => r.pos)).toContain('verb')
    expect(cov.byCefr.map((r) => r.cefr)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
  })

  it('adds up: the buckets account for every word', () => {
    const cov = factCoverage(words)
    expect(cov.byPos.reduce((n, r) => n + r.words, 0)).toBe(cov.total.words)
    expect(cov.byCefr.reduce((n, r) => n + r.words, 0)).toBe(cov.total.words)
  })

  it('counts authored facts and confusable links', () => {
    const cov = factCoverage(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "звенеть=to ring":
    cefr_level: A2
    accented: звене́ть
    en_gb: { standard: to ring }
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    facts:
      - { kind: note, text: A note. }
    confusable_with: [{ key: "звенеть=to ring", why: One is a bell. }]
`,
        },
      ]),
    )
    expect(cov.total).toMatchObject({ words: 2, withFacts: 1, facts: 1, confusables: 2 })
  })

  it('handles an empty corpus', () => {
    expect(factCoverage([]).total.words).toBe(0)
    expect(factCoverage().byPos).toEqual([])
  })
})
