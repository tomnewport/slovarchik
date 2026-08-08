// Data-integrity guard for the in-context inflection drill. The drill is driven
// by `inflect:` annotations on words' usage examples (in the vocab YAML) plus the
// grammar-rules.yml explanations. Every annotated example must:
//   - point its `token` at a token whose core equals the word's stored form for
//     the annotated slot (catches a mis-counted index or a wrong case/number)
//   - reference a rule id that exists
//
// The slot → stored form resolution itself lives in stressAudit.storedForm, so
// this guard and the stress audit can never disagree about what a slot means.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { loadFixtureWords } from '../test/fixtures.js'
import { shapeContextPhrases } from './vocabBuild.js'
import { normalize } from './text.js'
import { buildFromPhrase, indexPhrases } from './phraseContext.js'
import { storedForm } from './stressAudit.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const rules = yaml.load(readFileSync(resolve(vocabDir, 'grammar-rules.yml'), 'utf8')).rules

const words = loadFixtureWords()
const byKey = new Map(words.map((w) => [w.key, w]))
const phrases = shapeContextPhrases(words)

describe('usage `inflect` annotations', () => {
  it('produces context phrases', () => expect(phrases.length).toBeGreaterThan(0))

  it.each(phrases.map((p) => [p.id, p]))('%s token matches the stored form for its slot', (_id, p) => {
    const w = byKey.get(p.target.key)
    expect(w, `unknown key ${p.target.key}`).toBeTruthy()
    expect(w.learnable, `${p.target.key} is not learnable`).not.toBe(false)
    const ex = buildFromPhrase(p, w, { rules })
    expect(ex, `${p.id} did not resolve`).toBeTruthy()
    const stored = storedForm(w, p.target, byKey)
    expect(stored, `no stored form for ${p.id} (${JSON.stringify(p.target)})`).toBeTruthy()
    expect(normalize(ex.answerAccented)).toBe(normalize(stored))
  })

  it.each(phrases.filter((p) => p.target.rule).map((p) => [p.id, p]))(
    '%s references an existing rule',
    (_id, p) => expect(rules[p.target.rule], `missing rule ${p.target.rule}`).toBeTruthy(),
  )

  it('every phrase id is unique', () => {
    const ids = phrases.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('indexPhrases covers every phrase', () => {
    const idx = indexPhrases(phrases)
    const total = [...idx.values()].reduce((n, list) => n + list.length, 0)
    expect(total).toBe(phrases.length)
  })
})
