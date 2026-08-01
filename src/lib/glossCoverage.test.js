import { describe, it, expect } from 'vitest'

import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import { unglossedExampleForms } from './glossCoverage.js'
import { loadFixtureWords } from '../test/fixtures.js'

// buildWords takes parsed docs; these tests author inline YAML, so parse first.
const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

describe('unglossedExampleForms', () => {
  // A noun whose usage example leans on a word that has no dictionary entry.
  const base = `
words:
  "город=city":
    cefr_level: A1
    gender: m
    animacy: i
    en_gb: { standard: city }
    usage:
      - { ru: Большо́й го́род краси́в., en_gb: The big city is beautiful. }
    declension:
      sg_nom: го́род
      sg_gen: го́рода
      sg_dat: го́роду
      sg_acc: го́род
      sg_ins: го́родом
      sg_pre: го́роде
      pl_nom: города́
      pl_gen: городо́в
      pl_dat: города́м
      pl_acc: города́
      pl_ins: города́ми
      pl_pre: города́х
`

  it('reports a phrase word that resolves to no gloss', () => {
    const holes = unglossedExampleForms(fromYaml([{ pos: 'noun', text: base }]))
    const forms = holes.map((h) => h.form)
    // «большо́й» and «краси́в» have no entry; «го́род» does.
    expect(forms).toContain('большой')
    expect(forms).toContain('красив')
    expect(forms).not.toContain('город')
  })

  it('a gloss-only (learn: false) entry closes the hole', () => {
    const withGloss =
      base +
      `  "большой=big":
    cefr_level: A1
    learn: false
    en_gb: { standard: big }
    forms: { m: большо́й, f: больша́я, n: большо́е, pl: больши́е }
`
    const holes = unglossedExampleForms(fromYaml([{ pos: 'adjective', text: withGloss }]))
    expect(holes.map((h) => h.form)).not.toContain('большой')
  })
})

describe('the bundled vocabulary', () => {
  // Every word a learner can tap inside a phrase must resolve to a gloss. Words
  // that aren't part of the curriculum live in public/vocab/glossary.yml as
  // gloss-only (learn: false) entries; add the missing one there (or its inflected
  // form to an existing entry) to clear a failure here.
  it('glosses every word in the phrase bank', () => {
    const holes = unglossedExampleForms(loadFixtureWords())
    const sample = holes.slice(0, 25).map((h) => `${h.sample} (${h.form}) e.g. «${h.phrases[0]}»`)
    expect(holes.length, `unglossed phrase words:\n${sample.join('\n')}`).toBe(0)
  })
})
