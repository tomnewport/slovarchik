// Unit tests for the participle-coverage oracle (#564), plus the corpus guard
// it exists for: every stored participle/gerund must be reachable by a drill.
import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import {
  storedNonFiniteSlots,
  unreachableNonFiniteForms,
  untaughtFormAnnotations,
} from './participleCoverage.js'
import { loadFixtureWords } from '../test/fixtures.js'

const fromYaml = (text) => buildWords([{ pos: 'verb', doc: yaml.load(text) }])

const bare = `
words:
  "прочитать=to read":
    cefr_level: A1
    accented: прочита́ть
    aspect: pf
    en_gb: { standard: to read }
    participles:
      act_past: прочита́вший
      pass_past: прочи́танный
      pass_short: { m: прочи́тан, f: прочи́тана, n: прочи́тано, pl: прочи́таны }
    gerund: прочита́в
    usage:
      - ru: Я прочита́л кни́гу.
        en_gb: I read the book.
`

const taught =
  bare +
  `      - ru: Кни́га уже́ прочи́тана.
        en_gb: The book has already been read.
        inflect: { token: 3, form: pass_short, gender: f, rule: verb-participle-short }
`

describe('storedNonFiniteSlots', () => {
  it('lists one entry per stored slot', () => {
    expect(storedNonFiniteSlots(fromYaml(bare))).toEqual([
      { key: 'прочитать=to read', slot: 'act_past' },
      { key: 'прочитать=to read', slot: 'pass_past' },
      { key: 'прочитать=to read', slot: 'pass_short' },
      { key: 'прочитать=to read', slot: 'gerund' },
    ])
  })

  it('counts a partly-filled pass_short block once', () => {
    const partial = bare.replace(/pass_short: \{[^}]*\}/, 'pass_short: { m: прочи́тан }')
    const short = storedNonFiniteSlots(fromYaml(partial)).filter((s) => s.slot === 'pass_short')
    expect(short).toHaveLength(1)
  })

  it('skips gloss-only entries — no drill ever serves them', () => {
    const glossOnly = bare.replace('    cefr_level: A1', '    cefr_level: A1\n    learn: false')
    expect(storedNonFiniteSlots(fromYaml(glossOnly))).toEqual([])
  })
})

describe('unreachableNonFiniteForms', () => {
  it('flags every stored slot that no annotation teaches', () => {
    expect(unreachableNonFiniteForms(fromYaml(bare)).map((s) => s.slot)).toEqual([
      'act_past',
      'pass_past',
      'pass_short',
      'gerund',
    ])
  })

  it('is satisfied slot by slot, not verb by verb', () => {
    // One annotation covers pass_short only — the other three stay unreachable.
    expect(unreachableNonFiniteForms(fromYaml(taught)).map((s) => s.slot)).toEqual([
      'act_past',
      'pass_past',
      'gerund',
    ])
  })

  it('does not count an annotation of a different dimension', () => {
    const otherSlot = taught.replace(
      'form: pass_short, gender: f',
      'tense: past, person: past_f',
    )
    expect(unreachableNonFiniteForms(fromYaml(otherSlot))).toHaveLength(4)
  })
})

describe('untaughtFormAnnotations', () => {
  it('is empty when the annotated slot is stored', () => {
    expect(untaughtFormAnnotations(fromYaml(taught))).toEqual([])
  })

  it('flags a form: annotation the verb stores nothing for', () => {
    const noBlock = taught.replace(/ {4}participles:\n(?: {6}.*\n)+/, '')
    expect(untaughtFormAnnotations(fromYaml(noBlock))).toEqual([
      { key: 'прочитать=to read', slot: 'pass_short', id: 'прочитать=to read#1' },
    ])
  })
})

// The guard proper. A participle nothing annotates is data the learner is never
// asked to produce — the gap #536 found for comparatives, which #564 exists to
// avoid repeating — so a newly added participle has to arrive with the sentence
// that teaches it.
describe('the corpus', () => {
  const words = loadFixtureWords()

  it('teaches every stored participle / gerund with an annotated example', () => {
    const holes = unreachableNonFiniteForms(words)
    expect(holes.map((h) => `${h.key} (${h.slot})`), 'unreachable non-finite forms').toEqual([])
  })

  it('stores a form for every form: annotation', () => {
    const holes = untaughtFormAnnotations(words)
    expect(holes.map((h) => `${h.id} (${h.slot})`), 'annotations with no stored form').toEqual([])
  })
})
