import { describe, it, expect } from 'vitest'

import { normToken, wordForms, buildFormIndex, phraseHintTokens } from './phraseHint.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('normToken', () => {
  it('strips stress, punctuation and case and folds ё→е', () => {
    expect(normToken('Абза́ц.')).toBe('абзац')
    expect(normToken('всё,')).toBe('все')
    expect(normToken('«дом»')).toBe('дом')
  })

  it('returns an empty string for tokens with no letters', () => {
    expect(normToken('—')).toBe('')
    expect(normToken('123')).toBe('')
    expect(normToken('')).toBe('')
  })
})

describe('wordForms', () => {
  it('indexes the headword, bare key form and every inflected form', () => {
    const noun = {
      key: 'абзац=paragraph',
      headword: 'абза́ц',
      ru: 'абзац',
      meaning: 'paragraph',
      forms: { sg: { nom: 'абза́ц', pre: 'абза́це' }, pl: { nom: 'абза́цы' } },
      extra: { declension: { sg_ins: 'абза́цем' } },
    }
    const forms = wordForms(noun)
    expect(forms.has('абзац')).toBe(true) // headword / bare
    expect(forms.has('абзаце')).toBe(true) // prepositional sg
    expect(forms.has('абзацы')).toBe(true) // nominative pl
    expect(forms.has('абзацем')).toBe(true) // from raw declension
  })

  it('pulls verb conjugation and past forms from the raw record', () => {
    const verb = {
      key: 'арестовать=to arrest',
      headword: 'арестова́ть',
      ru: 'арестовать',
      meaning: 'to arrest',
      forms: {},
      extra: {
        accented: 'арестова́ть',
        conjugation: { future: { '3sg': 'аресту́ет' }, past_f: 'арестова́ла' },
      },
    }
    const forms = wordForms(verb)
    expect(forms.has('арестует')).toBe(true)
    expect(forms.has('арестовала')).toBe(true)
  })
})

describe('buildFormIndex', () => {
  it('maps inflected surface forms back to their dictionary entry', () => {
    const index = buildFormIndex(loadFixtureWords())
    const hit = index.get(normToken('абза́це')) // prepositional singular
    expect(hit).toBeTruthy()
    expect(hit.key).toBe('абзац=paragraph')
    expect(hit.en).toBe('paragraph')
  })

  it('skips entries with no English gloss to show', () => {
    const index = buildFormIndex([{ key: 'x', headword: 'икс', ru: 'икс', meaning: '' }])
    expect(index.size).toBe(0)
  })
})

describe('phraseHintTokens', () => {
  it('tags known words with a hint and preserves the raw token for display', () => {
    const index = buildFormIndex(loadFixtureWords())
    const tokens = phraseHintTokens('В э́том абза́це две оши́бки.', index)

    const абзаце = tokens.find((t) => t.text === 'абза́це')
    expect(абзаце.hint?.key).toBe('абзац=paragraph')
    expect(абзаце.text).toBe('абза́це') // stress + form kept for display
  })

  it('leaves unknown tokens without a hint', () => {
    const index = buildFormIndex(loadFixtureWords())
    const [first] = phraseHintTokens('к錯誤 zzz', index)
    expect(first.hint).toBeNull()
  })
})
