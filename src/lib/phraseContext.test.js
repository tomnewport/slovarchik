import { describe, it, expect } from 'vitest'
import {
  indexPhrases,
  buildSelectSteps,
  buildFromPhrase,
  buildContextExercise,
  canBuildContext,
} from './phraseContext.js'

const sobaka = { key: 'собака=dog', pos: 'noun', headword: 'соба́ка', ru: 'собака' }
const dumat = { key: 'думать=to think', pos: 'verb', headword: 'ду́мать', ru: 'думать' }
// adjective with a full declension grid (a few cells suffice for decoys)
const noviy = {
  key: 'новый=new', pos: 'adjective', headword: 'но́вый', ru: 'новый',
  extra: { declension: {
    m_nom: 'но́вый', m_gen: 'но́вого', f_nom: 'но́вая', f_acc: 'но́вую', f_gen: 'но́вой',
    n_nom: 'но́вое', pl_nom: 'но́вые', pl_gen: 'но́вых', pl_ins: 'но́выми',
  } },
}
const adjPhrase = {
  id: 'novuyu-knigu', ru: 'Я чита́ю но́вую кни́гу.', en: 'I am reading a new book.',
  target: { key: 'новый=new', token: 3, case: 'acc', number: 'sg', gender: 'f', rule: 'adj-agreement' },
}

// personal pronoun (flat by case, no gender) and a possessive (declines by
// gender·case like an adjective)
const ya = { key: 'я=I', pos: 'pronoun', headword: 'я', ru: 'я' }
const moy = {
  key: 'мой=my', pos: 'pronoun', headword: 'мой', ru: 'мой',
  extra: { declension: { m_nom: 'мой', f_nom: 'моя́', f_acc: 'мою́', n_nom: 'моё', pl_nom: 'мои́' } },
}
const yaPhrase = {
  id: 'zhdet-menya', ru: 'Он ждёт меня́ у вхо́да.', en: 'He is waiting for me at the entrance.',
  target: { key: 'я=I', token: 3, case: 'acc', number: 'sg', rule: 'pronoun-personal' },
}
const moyPhrase = {
  id: 'moya-sestra', ru: 'Моя́ сестра́ живёт в Пари́же.', en: 'My sister lives in Paris.',
  target: { key: 'мой=my', token: 1, case: 'nom', number: 'sg', gender: 'f', rule: 'pronoun-possessive' },
}

const accPhrase = {
  id: 'vizhu-sobaku',
  ru: 'Я ви́жу соба́ку.',
  en: 'I see the dog.',
  subject: 'animals',
  target: { key: 'собака=dog', token: 3, case: 'acc', number: 'sg', rule: 'noun-acc-fem-a' },
}
const verbPhrase = {
  id: 'ya-dumayu',
  ru: 'Я ду́маю о тебе́.',
  en: 'I am thinking about you.',
  target: { key: 'думать=to think', token: 2, tense: 'present', person: '1sg' },
}

const rules = {
  'noun-acc-fem-a': { title: 'Accusative singular feminine -а', formula: '-а → -у' },
}

describe('indexPhrases', () => {
  it('groups phrases by target key', () => {
    const byKey = indexPhrases([accPhrase, verbPhrase])
    expect(byKey.get('собака=dog')).toHaveLength(1)
    expect(byKey.get('думать=to think')).toHaveLength(1)
    expect(byKey.get('missing')).toBeUndefined()
  })
})

describe('buildSelectSteps', () => {
  it('returns case then number for a noun (one correct option each)', () => {
    const steps = buildSelectSteps(accPhrase.target, sobaka)
    expect(steps.map((s) => s.kind)).toEqual(['case', 'number'])
    const [caseStep, numberStep] = steps
    expect(caseStep.options).toHaveLength(6)
    expect(caseStep.options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'acc' })])
    expect(numberStep.options.map((o) => o.id)).toEqual(['sg', 'pl'])
    expect(numberStep.options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'sg' })])
  })
  it('returns no selection steps for a verb', () => {
    expect(buildSelectSteps(verbPhrase.target, dumat)).toEqual([])
  })
  it('returns case then gender + number for an adjective', () => {
    const steps = buildSelectSteps(adjPhrase.target, noviy)
    expect(steps.map((s) => s.kind)).toEqual(['case', 'gender'])
    const genderStep = steps[1]
    expect(genderStep.options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'f', label: 'Feminine' }),
    ])
    // only genders the word actually declines for are offered, each once
    const ids = genderStep.options.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('f')
  })
  it('returns case only for a personal pronoun (number is fixed by the lemma)', () => {
    const steps = buildSelectSteps(yaPhrase.target, ya)
    expect(steps.map((s) => s.kind)).toEqual(['case'])
  })
})

describe('buildFromPhrase', () => {
  it('blanks the target token to the lemma and reads the answer off the token', () => {
    const ex = buildFromPhrase(accPhrase, sobaka, { rules })
    expect(ex.targetIndex).toBe(2)
    expect(ex.tokens).toEqual(['Я', 'ви́жу', 'соба́ку.'])
    expect(ex.lemma).toBe('соба́ка') // dictionary form shown in the slot before answering
    expect(ex.answerAccented).toBe('соба́ку')
    expect(ex.answer).toBe('собаку')
    expect(ex.ru).toBe('Я ви́жу соба́ку.')
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'number'])
    expect(ex.rule).toMatchObject({ id: 'noun-acc-fem-a', formula: '-а → -у' })
  })

  it('handles verbs (no selection steps, person slot label)', () => {
    const ex = buildFromPhrase(verbPhrase, dumat)
    expect(ex.selectSteps).toEqual([])
    expect(ex.answerAccented).toBe('ду́маю')
    expect(ex.slotLabel).toContain('Present')
  })

  it('builds case + gender steps for an adjective', () => {
    const ex = buildFromPhrase(adjPhrase, noviy)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'gender'])
    expect(ex.answerAccented).toBe('но́вую')
    expect(ex.slotLabel).toBe('Accusative · Feminine')
  })

  it('returns null for an out-of-range token index', () => {
    expect(buildFromPhrase({ ...accPhrase, target: { ...accPhrase.target, token: 9 } }, sobaka)).toBeNull()
  })

  it('builds a case-only step for a personal pronoun', () => {
    const ex = buildFromPhrase(yaPhrase, ya)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case'])
    expect(ex.answer).toBe('меня')
    // End-stressed form keeps its stress mark (мен-я́, accent on the last letter).
    expect(ex.answerAccented).toBe('меня́')
    expect(ex.slotLabel).toContain('Accusative')
  })

  it('builds case + gender steps for a possessive pronoun', () => {
    const ex = buildFromPhrase(moyPhrase, moy)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'gender'])
    expect(ex.answer).toBe('моя')
    expect(ex.slotLabel).toBe('Nominative · Feminine')
  })
})

describe('buildContextExercise / canBuildContext', () => {
  const phrasesByKey = indexPhrases([accPhrase, verbPhrase])
  it('builds from the indexed phrase', () => {
    const ex = buildContextExercise(sobaka, { phrasesByKey, rules, rng: () => 0 })
    expect(ex.answerAccented).toBe('соба́ку')
  })
  it('reports availability', () => {
    expect(canBuildContext(sobaka, { phrasesByKey })).toBe(true)
    expect(canBuildContext({ key: 'нет=no' }, { phrasesByKey })).toBe(false)
  })
})

describe('exception weighting', () => {
  // Two phrases for one word: one regular, one flagged as an exception.
  const regular = {
    id: 'reg', ru: 'У меня́ нет соба́ки.', en: "I don't have a dog.",
    target: { key: 'собака=dog', token: 3, case: 'gen', number: 'sg', rule: 'noun-gen-sg' },
  }
  const exc = {
    id: 'exc', ru: 'Я ви́жу соба́ку.', en: 'I see the dog.',
    target: { key: 'собака=dog', token: 3, case: 'acc', number: 'sg', rule: 'noun-acc-animate' },
  }
  const excRules = {
    'noun-gen-sg': { title: 'Genitive singular' },
    'noun-acc-animate': { title: 'Animate accusative', exception: true },
  }
  const byKey = indexPhrases([regular, exc])

  it('flags the exception on the descriptor', () => {
    expect(buildFromPhrase(exc, sobaka, { rules: excRules }).exception).toBe(true)
    expect(buildFromPhrase(regular, sobaka, { rules: excRules }).exception).toBe(false)
  })

  it('draws the exception more often than the regular phrase', () => {
    let excCount = 0
    let seed = 1
    const rng = () => { // deterministic LCG, well-spread in [0,1)
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 1000; i++) {
      const ex = buildContextExercise(sobaka, { phrasesByKey: byKey, rules: excRules, rng })
      if (ex.exception) excCount++
    }
    // weight 4 vs 1 → ~80% exception. Assert a clear majority (not exact).
    expect(excCount).toBeGreaterThan(650)
    expect(excCount).toBeLessThan(1000) // regular still appears sometimes
  })
})
