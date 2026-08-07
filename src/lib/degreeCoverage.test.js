// Unit tests for the degree-coverage oracle (issue #536), plus the corpus guard
// it exists for: every stored comparative must be reachable by a drill.
import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import { storedComparatives, unreachableComparatives } from './degreeCoverage.js'
import { loadFixtureWords } from '../test/fixtures.js'

const fromYaml = (pos, text) => buildWords([{ pos, doc: yaml.load(text) }])

const bare = `
words:
  "тихий=quiet":
    cefr_level: A2
    accented: ти́хий
    en_gb: { standard: quiet }
    forms: { m: ти́хий, f: ти́хая, n: ти́хое, pl: ти́хие, comparative: ти́ше }
    usage:
      - ru: Э́то ти́хая у́лица.
        en_gb: This is a quiet street.
`

const taught =
  bare +
  `      - ru: В библиоте́ке ти́ше, чем в кафе́.
        en_gb: It is quieter in the library than in a cafe.
        inflect: { token: 2, degree: comparative, rule: adj-comparative-stem }
`

describe('storedComparatives', () => {
  it('lists the words that carry a comparative form', () => {
    expect(storedComparatives(fromYaml('adjective', bare))).toEqual([
      { key: 'тихий=quiet', form: 'ти́ше' },
    ])
  })

  it('skips gloss-only entries — no drill ever serves them', () => {
    const glossOnly = bare.replace('    cefr_level: A2', '    cefr_level: A2\n    learn: false')
    expect(storedComparatives(fromYaml('adjective', glossOnly))).toEqual([])
  })
})

describe('unreachableComparatives', () => {
  it('flags a stored comparative that no annotation teaches', () => {
    expect(unreachableComparatives(fromYaml('adjective', bare))).toEqual([
      { key: 'тихий=quiet', form: 'ти́ше' },
    ])
  })

  it('is satisfied by one degree: comparative annotation on the word', () => {
    expect(unreachableComparatives(fromYaml('adjective', taught))).toEqual([])
  })

  it('does not count an annotation of a different slot', () => {
    const otherSlot = taught.replace('degree: comparative', 'case: nom, number: sg, gender: f')
    expect(unreachableComparatives(fromYaml('adjective', otherSlot))).toHaveLength(1)
  })
})

// The guard proper. A comparative nothing annotates is data the learner is
// never asked to produce — the exact gap #536 was filed about — so a newly
// added `forms.comparative` has to arrive with the sentence that teaches it.
describe('the corpus', () => {
  const words = loadFixtureWords()

  it('stores a comparative on a substantial share of the corpus', () => {
    expect(storedComparatives(words).length).toBeGreaterThan(150)
  })

  it('teaches every stored comparative with at least one annotated example', () => {
    const holes = unreachableComparatives(words)
    expect(holes.map((h) => `${h.key} (${h.form})`), 'unreachable comparatives').toEqual([])
  })
})
