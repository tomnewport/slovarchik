import { describe, it, expect } from 'vitest'

import { loadFixtureWords, loadFixtureContextPhrases, loadFixtureRules } from '../test/fixtures.js'
import { wordForms, normToken } from './phraseHint.js'
import { governmentPhrases, isGovernmentPhrase, buildFromPhrase } from './phraseContext.js'
import {
  BARE_CASES,
  GOVERNMENT_RULES,
  PREP_FRAMES,
  frameForRule,
  governmentLabel,
  governmentRuleId,
  isValidFrame,
  normalizeGoverns,
  prepositionForms,
} from './verbGovernment.js'
import { normalize, stripStress } from './text.js'

const words = loadFixtureWords()
const byKey = new Map(words.map((w) => [w.key, w]))
const rules = loadFixtureRules()
const phrasesByKey = loadFixtureContextPhrases()

describe('normalizeGoverns', () => {
  it('reads the bare-case shorthand', () => {
    expect(normalizeGoverns('dat')).toEqual([{ prep: null, case: 'dat' }])
  })

  it('reads a prepositional frame', () => {
    expect(normalizeGoverns({ prep: 'от', case: 'gen' })).toEqual([{ prep: 'от', case: 'gen' }])
  })

  it('reads a list mixing both shapes', () => {
    expect(normalizeGoverns(['gen', { prep: 'о', case: 'pre' }])).toEqual([
      { prep: null, case: 'gen' },
      { prep: 'о', case: 'pre' },
    ])
  })

  it('is null for a verb that governs nothing', () => {
    expect(normalizeGoverns(undefined)).toBeNull()
    expect(normalizeGoverns([])).toBeNull()
    expect(normalizeGoverns('')).toBeNull()
  })
})

describe('government frames', () => {
  it('maps each bare case to its rule', () => {
    expect(governmentRuleId({ prep: null, case: 'dat' })).toBe('verb-gov-dative')
    expect(governmentRuleId({ prep: null, case: 'gen' })).toBe('verb-gov-genitive')
    expect(governmentRuleId({ prep: null, case: 'ins' })).toBe('verb-gov-instrumental')
  })

  it('maps a prepositional frame to a slugged rule', () => {
    expect(governmentRuleId({ prep: 'от', case: 'gen' })).toBe('verb-gov-prep-ot-gen')
    expect(governmentRuleId({ prep: 'о', case: 'pre' })).toBe('verb-gov-prep-o-pre')
  })

  it('rejects a government that has no rule to teach it', () => {
    // The accusative is the default, so it is never a bare government…
    expect(isValidFrame({ prep: null, case: 'acc' })).toBe(false)
    // …and a preposition/case pairing outside PREP_FRAMES has no explanation.
    expect(isValidFrame({ prep: 'от', case: 'dat' })).toBe(false)
    expect(isValidFrame({ prep: 'из', case: 'gen' })).toBe(false)
  })

  it('round-trips every taught frame through its rule id', () => {
    const frames = [...BARE_CASES.map((c) => ({ prep: null, case: c })), ...PREP_FRAMES]
    for (const f of frames) {
      const id = governmentRuleId(f)
      expect(GOVERNMENT_RULES.has(id), id).toBe(true)
      expect(frameForRule(id)).toEqual({ prep: f.prep ?? null, case: f.case })
    }
  })

  it('labels a frame the way a word card reads it', () => {
    expect(governmentLabel({ prep: null, case: 'dat' })).toBe('+ dative')
    expect(governmentLabel({ prep: 'от', case: 'gen' })).toBe('от + genitive')
  })

  it('counts the lengthened spelling of a preposition as the same word', () => {
    expect(prepositionForms('о')).toContain('об')
    expect(prepositionForms('в')).toContain('во')
  })
})

describe('verb government data', () => {
  it('only puts a taught government frame on verbs', () => {
    for (const w of words) {
      if (w.governs == null) continue
      expect(w.pos, w.key).toBe('verb')
      for (const frame of w.governs) {
        expect(isValidFrame(frame), `${w.key} governs ${JSON.stringify(frame)}`).toBe(true)
      }
    }
  })

  it('covers every government the curriculum teaches', () => {
    // Each rule must have verbs behind it — a rule with no verb is an
    // explanation the learner can never meet, and a frame the drill can't fill.
    const used = new Set()
    for (const w of words) for (const f of w.governs ?? []) used.add(governmentRuleId(f))
    expect([...GOVERNMENT_RULES].filter((id) => !used.has(id))).toEqual([])
  })

  it('gives both members of an aspect pair the same government', () => {
    // Aspect does not change what a verb governs (помога́ть/помо́чь both take the
    // dative), so a one-sided annotation is an authoring omission, not a fact.
    const frameKey = (f) => `${f.prep ?? ''}|${f.case}`
    const label = (g) => (g ?? []).map(frameKey).sort().join(' ')
    for (const w of words) {
      if (w.pos !== 'verb' || !w.aspectPair) continue
      const partner = byKey.get(w.aspectPair.key)
      if (!partner) continue
      expect(label(w.governs), `${w.key} vs ${partner.key}`).toBe(label(partner.governs))
    }
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

  it('collects verb-government slots across every taught frame', () => {
    const used = new Set(gov.map((p) => p.target.rule))
    expect([...GOVERNMENT_RULES].filter((id) => !used.has(id))).toEqual([])
    for (const p of gov) expect(isGovernmentPhrase(p)).toBe(true)
  })

  it('is a pool big enough to practise against', () => {
    expect(gov.length).toBeGreaterThanOrEqual(60)
  })

  it('annotates the object in the case its rule names', () => {
    for (const p of gov) expect(p.target.case, p.ru).toBe(frameForRule(p.target.rule).case)
  })

  it('is backed by a governing verb actually present in each sentence', () => {
    // Cross-check the annotation against the structured `governs` data: every
    // government sentence must contain a verb whose frame matches — this is
    // what keeps the `governs` field and the annotations honest.
    const verbFormRules = new Map() // normalised surface form → set of rule ids
    for (const w of words) {
      if (w.pos !== 'verb' || !w.governs) continue
      for (const f of wordForms(w)) {
        if (!verbFormRules.has(f)) verbFormRules.set(f, new Set())
        for (const frame of w.governs) verbFormRules.get(f).add(governmentRuleId(frame))
      }
    }
    for (const p of gov) {
      const need = p.target.rule
      const hasVerb = p.ru.split(/\s+/).some((tok) => verbFormRules.get(normToken(tok))?.has(need))
      expect(hasVerb, `${p.ru} — no verb governing ${need} found`).toBe(true)
    }
  })

  it('spells out the frame preposition in every prepositional sentence', () => {
    // A prepositional frame is only taught if the sentence actually shows the
    // preposition — «зави́сеть от» is the whole point of the rule.
    for (const p of gov) {
      const frame = frameForRule(p.target.rule)
      if (!frame.prep) continue
      const forms = new Set(prepositionForms(frame.prep))
      const tokens = p.ru.split(/\s+/).map((t) => stripStress(normToken(t)))
      expect(tokens.some((t) => forms.has(t)), `${p.ru} — no «${frame.prep}»`).toBe(true)
    }
  })

  it('resolves each government phrase into a gradable exercise', () => {
    for (const p of gov) {
      const owner = byKey.get(p.target.key)
      const ex = buildFromPhrase(p, owner, { rules })
      expect(ex, p.id).toBeTruthy()
      // The answer is the governed form from the sentence…
      expect(normalize(ex.answer).length).toBeGreaterThan(0)
      // …and the correct case option is the one the verb's frame names.
      const caseStep = ex.selectSteps.find((s) => s.kind === 'case')
      expect(caseStep.options.find((o) => o.correct).id, p.ru).toBe(frameForRule(p.target.rule).case)
    }
  })
})
