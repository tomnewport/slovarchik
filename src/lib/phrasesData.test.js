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

  // #592: the rule ids are shaped per case + number, so every genitive-singular
  // example used to get the same paragraph — possession, negation, after a
  // preposition and after два alike. These hold the split in place: a new
  // quantified sentence cannot quietly land back on the generic rule.
  describe('the counting genitives name their trigger', () => {
    const bare = (t) =>
      String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/ё/g, 'е').replace(/[^\p{L}]/gu, '')
    const DUAL = new Set(['два', 'две', 'три', 'четыре', 'оба', 'обе', 'полтора', 'полторы'])
    const QUANTITY = new Set(['много', 'мало', 'несколько', 'сколько', 'немного', 'столько'])
    // The rules that explain a *form* rather than a use — a fleeting vowel, an
    // irregular plural. Those stay: the form is the harder thing in them.
    const FORM_RULES = /^(noun-genpl-fleeting|noun-irregular-plural|noun-mya-neuter|noun-fem-soft|adj-agreement)$/

    /** The quantifier governing this slot, if one is within reach behind it. */
    const triggerFor = (p) => {
      const toks = p.ru.split(/\s+/).map(bare).filter(Boolean)
      const at = Number(p.target.token) - 1
      for (let i = at - 1; i >= 0 && i >= at - 3; i--) {
        if (DUAL.has(toks[i])) return 'dual'
        if (QUANTITY.has(toks[i])) return 'quantity'
      }
      return null
    }

    const quantified = phrases
      .filter((p) => p.target.case === 'gen' && p.target.rule && !FORM_RULES.test(p.target.rule))
      .map((p) => ({ p, trigger: triggerFor(p) }))
      .filter((x) => x.trigger)

    it('finds the quantified genitives in the corpus', () => {
      expect(quantified.length).toBeGreaterThan(300)
    })

    it('never leaves one on the generic genitive rule', () => {
      const stragglers = quantified
        .filter(({ p }) => p.target.rule === 'noun-gen-sg' || p.target.rule === 'noun-gen-pl')
        .map(({ p }) => `${p.ru}  [${p.target.rule}]`)
      expect(stragglers, stragglers.slice(0, 10).join('\n')).toEqual([])
    })

    // After два the numeral fixes the number. After мно́го the NOUN decides:
    // countable goes plural, uncountable stays singular — which is the split the
    // issue's two-rule proposal did not have a place for.
    it('picks the rule the trigger and the number together imply', () => {
      const want = ({ p, trigger }) =>
        trigger === 'dual'
          ? 'noun-count-gen-sg'
          : p.target.number === 'sg'
            ? 'noun-quantity-gen-sg'
            : 'noun-count-gen-pl'
      const wrong = quantified
        .filter((x) => x.p.target.rule !== want(x))
        .map((x) => `${x.p.ru}  is ${x.p.target.rule}, wants ${want(x)}`)
      expect(wrong, wrong.slice(0, 10).join('\n')).toEqual([])
    })

    it('cross-references a sibling rule that exists', () => {
      const withContrast = Object.entries(rules).filter(([, r]) => r.contrast)
      expect(withContrast.length).toBeGreaterThan(0)
      for (const [id, r] of withContrast) {
        expect(rules[r.contrast], `${id} names a missing sibling ${r.contrast}`).toBeTruthy()
        expect(r.contrast, `${id} contrasts with itself`).not.toBe(id)
      }
    })
  })

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
