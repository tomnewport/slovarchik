import { describe, it, expect } from 'vitest'

import { loadFixtureWords, loadFixtureContextPhrases, loadFixtureRules } from '../test/fixtures.js'
import { wordForms, normToken } from './phraseHint.js'
import {
  GOVERNMENT_RULES,
  governmentPhrases,
  isGovernmentPhrase,
  buildFromPhrase,
} from './phraseContext.js'
import { normalize } from './text.js'

const words = loadFixtureWords()
const byKey = new Map(words.map((w) => [w.key, w]))
const rules = loadFixtureRules()
const phrasesByKey = loadFixtureContextPhrases()

const RULE_CASE = {
  'verb-gov-dative': 'dat',
  'verb-gov-genitive': 'gen',
  'verb-gov-instrumental': 'ins',
}
const VALID_GOVERNS = new Set(['dat', 'gen', 'ins'])

describe('verb government data', () => {
  it('only puts a valid non-accusative case on verbs', () => {
    for (const w of words) {
      if (w.governs == null) continue
      expect(w.pos, w.key).toBe('verb')
      expect(VALID_GOVERNS.has(w.governs), `${w.key} governs=${w.governs}`).toBe(true)
    }
  })

  it('has at least one governing verb for each of the three cases', () => {
    const cases = new Set(words.filter((w) => w.governs).map((w) => w.governs))
    expect([...cases].sort()).toEqual(['dat', 'gen', 'ins'])
  })

  it('defines every government rule as a weighted exception', () => {
    for (const id of GOVERNMENT_RULES) {
      expect(rules[id], id).toBeTruthy()
      expect(rules[id].exception, id).toBe(true)
    }
  })
})

describe('governmentPhrases', () => {
  const gov = governmentPhrases(phrasesByKey)

  it('collects verb-government slots across all three cases', () => {
    expect(gov.length).toBeGreaterThanOrEqual(9)
    const cases = new Set(gov.map((p) => RULE_CASE[p.target.rule]))
    expect([...cases].sort()).toEqual(['dat', 'gen', 'ins'])
    for (const p of gov) expect(isGovernmentPhrase(p)).toBe(true)
  })

  it('annotates the object in the case its rule names', () => {
    for (const p of gov) expect(p.target.case, p.ru).toBe(RULE_CASE[p.target.rule])
  })

  it('is backed by a governing verb actually present in each sentence', () => {
    // Cross-check the annotation against the structured `governs` data: every
    // government sentence must contain a verb whose governed case matches — this
    // is what keeps the `governs` field and the annotations honest.
    const verbFormCase = new Map() // normalised surface form → set of governed cases
    for (const w of words) {
      if (w.pos !== 'verb' || !w.governs) continue
      for (const f of wordForms(w)) {
        if (!verbFormCase.has(f)) verbFormCase.set(f, new Set())
        verbFormCase.get(f).add(w.governs)
      }
    }
    for (const p of gov) {
      const need = RULE_CASE[p.target.rule]
      const hasVerb = p.ru
        .split(/\s+/)
        .some((tok) => verbFormCase.get(normToken(tok))?.has(need))
      expect(hasVerb, `${p.ru} — no ${need}-governing verb found`).toBe(true)
    }
  })

  it('resolves each government phrase into a gradable exercise', () => {
    for (const p of gov) {
      const owner = byKey.get(p.target.key)
      const ex = buildFromPhrase(p, owner, { rules })
      expect(ex, p.id).toBeTruthy()
      // The answer is the governed form from the sentence…
      expect(normalize(ex.answer).length).toBeGreaterThan(0)
      // …and the correct case option is the one the verb governs.
      const caseStep = ex.selectSteps.find((s) => s.kind === 'case')
      expect(caseStep.options.find((o) => o.correct).id, p.ru).toBe(RULE_CASE[p.target.rule])
    }
  })
})
