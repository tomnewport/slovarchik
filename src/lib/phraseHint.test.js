import { describe, it, expect } from 'vitest'

import {
  normToken,
  wordForms,
  wordTokensInPhrase,
  buildFormIndex,
  phraseHintTokens,
} from './phraseHint.js'
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

  it('does not index the component words of a multi-word form (#155)', () => {
    // The year «две ты́сячи» must not leak «две»/«ты́сячи» as standalone glosses.
    const year = {
      key: 'две тысячи=2000',
      headword: 'две ты́сячи',
      ru: 'две тысячи',
      meaning: '2000',
      forms: {},
      extra: { type: 'year', accented: 'две ты́сячи' },
    }
    const forms = wordForms(year)
    expect(forms.has('две')).toBe(false)
    expect(forms.has('тысячи')).toBe(false)
  })

  it('derives the n-prefixed forms of third-person personal pronouns', () => {
    const on = {
      pos: 'pronoun',
      headword: 'он',
      ru: 'он',
      meaning: 'he',
      forms: {},
      extra: { type: 'pers', forms: { gen: 'его́', dat: 'ему́', ins: 'им', pre: 'нём' } },
    }
    const forms = wordForms(on)
    expect(forms.has('него')).toBe(true) // genitive/accusative after a preposition
    expect(forms.has('нему')).toBe(true) // dative
    expect(forms.has('ним')).toBe(true) // instrumental
  })
})

describe('wordTokensInPhrase', () => {
  const noun = {
    key: 'абзац=paragraph',
    headword: 'абза́ц',
    ru: 'абзац',
    meaning: 'paragraph',
    forms: { sg: { nom: 'абза́ц', pre: 'абза́це' }, pl: { nom: 'абза́цы' } },
    extra: { declension: { sg_ins: 'абза́цем' } },
  }

  it('finds the normalised tokens of a phrase that are forms of the word', () => {
    expect(wordTokensInPhrase('в пе́рвом абза́це.', noun)).toEqual(['абзаце'])
  })

  it('returns an entry per occurrence when the word repeats', () => {
    expect(wordTokensInPhrase('абза́ц за абза́цем', noun)).toEqual(['абзац', 'абзацем'])
  })

  it('returns an empty array when the word does not appear', () => {
    expect(wordTokensInPhrase('я иду домой', noun)).toEqual([])
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

  it('glosses feminine «две» as "two", not the year (#155)', () => {
    const index = buildFormIndex(loadFixtureWords())
    expect(index.get(normToken('две'))?.en).toBe('two')
  })

  it('glosses n-prefixed pronoun forms from the bundled vocab', () => {
    const index = buildFormIndex(loadFixtureWords())
    expect(index.get(normToken('него'))?.en).toBe('he')
    expect(index.get(normToken('неё'))?.en).toBe('she')
  })

  it('combines heteronym glosses for forms that are ambiguous after stress-stripping (#198)', () => {
    // стоить (to cost) has 3sg сто́ит; стоять (to stand) has 3sg стои́т.
    // After stress-stripping both normalise to "стоит", so the hint should show both.
    const cost = {
      key: 'стоить=to cost',
      headword: 'сто́ить',
      ru: 'стоить',
      meaning: 'to cost',
      heteronyms: [
        { ru: 'сто́ит', gloss: 'it costs' },
        { ru: 'стои́т', gloss: 'it stands' },
      ],
      extra: { conjugation: { present: { '3sg': 'сто́ит' } } },
    }
    const stand = {
      key: 'стоять=to stand',
      headword: 'стоя́ть',
      ru: 'стоять',
      meaning: 'to stand',
      heteronyms: [
        { ru: 'стои́т', gloss: 'it stands' },
        { ru: 'сто́ит', gloss: 'it costs' },
      ],
      extra: { conjugation: { present: { '3sg': 'стои́т' } } },
    }
    const index = buildFormIndex([cost, stand])
    const gloss = index.get(normToken('стои́т'))?.en
    expect(gloss).toContain('it costs')
    expect(gloss).toContain('it stands')
  })

  it('prefers the word whose dictionary form is the token over an oblique form (#173)', () => {
    // «дорого́й» is the adjective "expensive" (its headword) but also the
    // instrumental of the noun «доро́га» "road". The lemma must win.
    const road = {
      key: 'дорога=road',
      headword: 'доро́га',
      ru: 'дорога',
      meaning: 'road',
      extra: { declension: { sg_ins: 'дорого́й' } },
    }
    const expensive = {
      key: 'дорогой=expensive',
      headword: 'дорого́й',
      ru: 'дорогой',
      meaning: 'expensive',
      extra: { forms: { m: 'дорого́й', f: 'дорога́я' } },
    }
    const index = buildFormIndex([road, expensive])
    expect(index.get(normToken('дорого́й'))?.en).toBe('expensive')
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
