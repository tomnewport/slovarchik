import { describe, it, expect } from 'vitest'
import {
  indexPhrases,
  caseOptions,
  buildFromPhrase,
  buildContextExercise,
  canBuildContext,
} from './phraseContext.js'

const sobaka = { key: 'собака=dog', pos: 'noun', headword: 'соба́ка', ru: 'собака' }
const dumat = { key: 'думать=to think', pos: 'verb', headword: 'ду́мать', ru: 'думать' }

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

describe('caseOptions', () => {
  it('returns six options with one correct for a cased target', () => {
    const opts = caseOptions(accPhrase.target)
    expect(opts).toHaveLength(6)
    expect(opts.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ case: 'acc' }),
    ])
  })
  it('returns none for a verb (no case)', () => {
    expect(caseOptions(verbPhrase.target)).toEqual([])
  })
})

describe('buildFromPhrase', () => {
  it('blanks the target token to the lemma and reads the answer off the token', () => {
    const ex = buildFromPhrase(accPhrase, sobaka, { rules })
    expect(ex.targetIndex).toBe(2)
    expect(ex.tokens).toEqual(['Я', 'ви́жу', 'соба́ку.'])
    expect(ex.displayTokens[2]).toBe('соба́ка.') // lemma + preserved punctuation
    expect(ex.answerAccented).toBe('соба́ку')
    expect(ex.answer).toBe('собаку')
    expect(ex.ru).toBe('Я ви́жу соба́ку.')
    expect(ex.correctCase).toBe('acc')
    expect(ex.rule).toMatchObject({ id: 'noun-acc-fem-a', formula: '-а → -у' })
  })

  it('handles verbs (no case options, person slot label)', () => {
    const ex = buildFromPhrase(verbPhrase, dumat)
    expect(ex.caseOptions).toEqual([])
    expect(ex.correctCase).toBeNull()
    expect(ex.answerAccented).toBe('ду́маю')
    expect(ex.slotLabel).toContain('Present')
  })

  it('returns null for an out-of-range token index', () => {
    expect(buildFromPhrase({ ...accPhrase, target: { ...accPhrase.target, token: 9 } }, sobaka)).toBeNull()
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
