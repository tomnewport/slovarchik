import { describe, it, expect } from 'vitest'

import {
  toAcute, monosyllabic, variants, senseOverlap, compareRow, compareMeta,
} from './probe-dictionary.mjs'

// A dictionary row in the OpenRussian shape (tab columns, apostrophe stress).
const row = (over = {}) => ({
  bare: 'книга', accented: 'кни’га', translations_en: 'book', gender: 'f', animate: '0',
  sg_nom: "кни'га", sg_gen: "кни'ги", sg_dat: "кни'ге", sg_acc: "кни'гу",
  sg_inst: "кни'гой", sg_prep: "кни'ге",
  ...over,
})

describe('toAcute', () => {
  it('moves an apostrophe onto the vowel it follows', () => {
    expect(toAcute("челове'к")).toBe('челове́к')
    expect(toAcute("кни'га")).toBe('кни́га')
  })

  it('drops an apostrophe that does not follow a vowel rather than guessing', () => {
    // Nothing in a Russian form should carry one here; a stray mark must not
    // silently become a stress claim on the wrong letter.
    expect(toAcute("к'нига")).toBe('книга')
  })

  it('leaves an unmarked form alone', () => {
    expect(toAcute('дом')).toBe('дом')
    expect(toAcute('')).toBe('')
  })
})

describe('monosyllabic', () => {
  it('is true for a one-vowel form, marked or not', () => {
    expect(monosyllabic('дом')).toBe(true)
    expect(monosyllabic('бы́л')).toBe(true)
  })

  it('is false once there are two vowels', () => {
    expect(monosyllabic('кни́га')).toBe(false)
  })

  it('treats ё as a vowel', () => {
    expect(monosyllabic('её')).toBe(false)
  })
})

describe('variants', () => {
  it('splits a multi-form cell and normalises each', () => {
    expect(variants("маха'ю, машу'")).toEqual(['маха́ю', 'машу́'])
  })

  it('is empty for an absent cell', () => {
    expect(variants('')).toEqual([])
    expect(variants(undefined)).toEqual([])
  })
})

describe('senseOverlap', () => {
  const word = { en_gb: { standard: 'satin (a smooth glossy fabric)' } }

  it('scores zero when the glosses share nothing', () => {
    // а́тлас "map book" against our атла́с "satin" — same letters, wrong entry.
    expect(senseOverlap('атлас=satin', word, { translations_en: 'atlas, map book' })).toBe(0)
  })

  it('scores above zero on a shared content word', () => {
    expect(senseOverlap('атлас=satin', word, { translations_en: 'satin' })).toBeGreaterThan(0)
  })

  it('does not veto when either side has no usable gloss', () => {
    expect(senseOverlap('атлас=satin', word, { translations_en: '' })).toBe(1)
    expect(senseOverlap('атлас=', {}, { translations_en: 'atlas' })).toBe(1)
  })
})

describe('compareRow', () => {
  it('agrees with itself across a clean paradigm', () => {
    const cells = {
      sg_nom: 'кни́га', sg_gen: 'кни́ги', sg_dat: 'кни́ге',
      sg_acc: 'кни́гу', sg_ins: 'кни́гой', sg_pre: 'кни́ге',
    }
    const out = compareRow(cells, row())
    expect(out.compared).toBe(6)
    expect(out.letterDisagree).toBe(0)
    expect(out.stressDisagree).toBe(0)
  })

  it('reports a wrong letter as a letter disagreement, not a stress one', () => {
    const out = compareRow({ sg_pre: 'кни́ги' }, row())
    expect(out.letterDisagree).toBe(1)
    expect(out.stressDisagree).toBe(0)
    expect(out.letters[0]).toMatchObject({ slot: 'sg_pre', ours: 'кни́ги' })
  })

  it('reports a wrong stress once the letters agree', () => {
    const out = compareRow({ sg_nom: 'книга́' }, row())
    expect(out.letterDisagree).toBe(0)
    expect(out.stressDisagree).toBe(1)
  })

  it('does not judge stress on a one-vowel form', () => {
    // They mark `до'м`, we write `дом`; that is notation, not disagreement.
    const out = compareRow({ sg_nom: 'дом' }, row({ sg_nom: "до'м" }))
    expect(out.stressDisagree).toBe(0)
    expect(out.monosyllabic).toBe(1)
  })

  it('does not judge stress against an unmarked dictionary form', () => {
    const out = compareRow({ sg_nom: 'кни́га' }, row({ sg_nom: 'книга' }))
    expect(out.letterAgree).toBe(1)
    expect(out.stressAgree + out.stressDisagree).toBe(0)
  })

  it('accepts any listed variant', () => {
    const out = compareRow({ sg_nom: 'машу́' }, row({ sg_nom: "маха'ю, машу'" }))
    expect(out.letterAgree).toBe(1)
    expect(out.stressDisagree).toBe(0)
  })

  it('counts an absent dictionary cell as absent, never as a disagreement', () => {
    const out = compareRow({ sg_nom: 'кни́га' }, row({ sg_nom: '' }))
    expect(out.absent).toBe(1)
    expect(out.compared).toBe(0)
    expect(out.letterDisagree).toBe(0)
  })

  it('is ё-sensitive — a missing ё is a letter disagreement', () => {
    const out = compareRow({ sg_ins: 'контро́лем' }, row({ sg_inst: "контролём" }))
    expect(out.letterDisagree).toBe(1)
  })
})

describe('compareMeta', () => {
  it('flags a gender disagreement', () => {
    const out = compareMeta('nouns', { gender: 'm' }, row({ gender: 'f' }))
    expect(out.checked).toBe(1)
    expect(out.disagree[0]).toMatchObject({ field: 'gender', ours: 'm', theirs: 'f' })
  })

  it('maps their animate flag onto our a/i', () => {
    expect(compareMeta('nouns', { animacy: 'i' }, row({ animate: '0' })).disagree).toEqual([])
    expect(compareMeta('nouns', { animacy: 'i' }, row({ animate: '1' })).disagree).toHaveLength(1)
  })

  it('maps their aspect onto our impf/pf', () => {
    expect(compareMeta('verbs', { aspect: 'impf' }, { aspect: 'imperfective' }).disagree).toEqual([])
    expect(compareMeta('verbs', { aspect: 'pf' }, { aspect: 'imperfective' }).disagree).toHaveLength(1)
  })

  it('checks nothing when the field is absent on either side', () => {
    expect(compareMeta('nouns', {}, row()).checked).toBe(0)
    expect(compareMeta('nouns', { gender: 'm' }, row({ gender: '' })).checked).toBe(0)
  })
})
