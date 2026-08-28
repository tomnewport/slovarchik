// Unit tests for the slot → stored form resolution behind both the in-context
// drill and the stress audit. The corpus-wide checks live in stressData.test.js;
// this file pins the resolution rules for the non-finite verb slots (#564),
// which have no corpus data to exercise them yet.
import { describe, it, expect } from 'vitest'

import { storedForm, unannotatedStressDivergences, formStressIndex } from './stressAudit.js'

const plakat = {
  key: 'плакать=to cry',
  pos: 'verb',
  headword: 'пла́кать',
  aspect: 'impf',
  participles: { act_pres: 'пла́чущий' },
  gerund: 'пла́ча',
  extra: { conjugation: { present: { '3sg': 'пла́чет' }, past_m: 'пла́кал' } },
}
const prochitat = {
  key: 'прочитать=to read',
  pos: 'verb',
  headword: 'прочита́ть',
  aspect: 'pf',
  participles: {
    pass_past: 'прочи́танный',
    pass_short: { m: 'прочи́тан', f: 'прочи́тана', n: 'прочи́тано', pl: 'прочи́таны' },
  },
  gerund: 'прочита́в',
  extra: { conjugation: { future: { '1sg': 'прочита́ю' } } },
}

describe('storedForm — non-finite verb slots', () => {
  it('reads the gerund as an invariable scalar', () => {
    expect(storedForm(plakat, { form: 'gerund' })).toBe('пла́ча')
    expect(storedForm(prochitat, { form: 'gerund' })).toBe('прочита́в')
  })

  it('reads the short passive per gender', () => {
    expect(storedForm(prochitat, { form: 'pass_short', gender: 'f' })).toBe('прочи́тана')
    expect(storedForm(prochitat, { form: 'pass_short', gender: 'pl' })).toBe('прочи́таны')
  })

  it('derives a long participle cell from the one stored nominative', () => {
    expect(storedForm(plakat, { form: 'act_pres' })).toBe('пла́чущий')
    expect(storedForm(plakat, { form: 'act_pres', case: 'gen', gender: 'f' })).toBe('пла́чущей')
    expect(storedForm(prochitat, { form: 'pass_past', case: 'ins', gender: 'pl' })).toBe(
      'прочи́танными',
    )
  })

  it('copies the genitive into an animate accusative', () => {
    const at = { form: 'act_pres', case: 'acc', gender: 'm' }
    expect(storedForm(plakat, { ...at, animate: true })).toBe('пла́чущего')
    expect(storedForm(plakat, at)).toBe('пла́чущий')
  })

  it('is null for a slot the verb does not store', () => {
    expect(storedForm(plakat, { form: 'pass_past', case: 'nom', gender: 'm' })).toBeNull()
    expect(storedForm(plakat, { form: 'pass_short', gender: 'f' })).toBeNull()
    expect(storedForm(prochitat, { form: 'act_pres' })).toBeNull()
  })

  it('resolves nothing for a non-verb, whatever the annotation says', () => {
    const adjective = { key: 'закрытый=closed', pos: 'adjective', short: { f: 'закры́та' } }
    expect(storedForm(adjective, { form: 'pass_short', gender: 'f' })).toBeNull()
  })

  it('takes precedence over the case branch', () => {
    // A participle slot carries a case too, and must not be read as an
    // adjective/noun declension cell — the verb has no `declension:` at all.
    expect(storedForm(plakat, { form: 'act_pres', case: 'dat', gender: 'n' })).toBe('пла́чущему')
    expect(storedForm(plakat, { case: 'dat', gender: 'n' })).toBeNull()
  })
})

// ── #600: unannotated tokens vs the dictionary ──────────────────────────────
// Most sentence tokens name no paradigm slot, so annotatedStressDivergences
// never sees them. These pin the two rules that keep the check honest: it only
// speaks when the dictionary knows exactly one stressed form for a spelling,
// and it stays quiet on the count form after 2/3/4.
const noun = (key, headword, declension, usage = []) => ({
  key,
  pos: 'noun',
  headword,
  learnable: true,
  usage,
  extra: { declension },
})

describe('unannotatedStressDivergences', () => {
  it('flags a sentence token stressed against the only form the dictionary has', () => {
    const words = [
      noun('полицейский=policeman', 'полице́йский', { sg_nom: 'полице́йский' }, [
        { ru: 'Поли́цейский останови́л маши́ну.' },
      ]),
    ]
    const [hit] = unannotatedStressDivergences(words)
    expect(hit).toMatchObject({ token: 'Поли́цейский', dictionary: 'полице́йский' })
  })

  it('says nothing when the token agrees', () => {
    const words = [
      noun('полицейский=policeman', 'полице́йский', { sg_nom: 'полице́йский' }, [
        { ru: 'Полице́йский останови́л маши́ну.' },
      ]),
    ]
    expect(unannotatedStressDivergences(words)).toEqual([])
  })

  it('leaves alone a spelling more than one word can claim', () => {
    // «я е́ду» is 1sg of е́хать; the dictionary's еду́ is the accusative of еда́.
    // Two claimants, so the pair proves nothing about where the stress belongs.
    const words = [
      { key: 'ехать=to go', pos: 'verb', headword: 'е́хать', learnable: true, usage: [{ ru: 'Я е́ду на рабо́ту.' }], extra: { conjugation: { present: { '1sg': 'е́ду' } } } },
      noun('еда=food', 'еда́', { sg_nom: 'еда́', sg_acc: 'еду́' }),
    ]
    expect(unannotatedStressDivergences(words)).toEqual([])
  })

  it('leaves alone the count form after two, three or four', () => {
    // «два часа́» is the old dual, not the genitive ча́са, and no cell holds it.
    const words = [
      noun('час=hour', 'час', { sg_gen: 'ча́са' }, [{ ru: 'Он ждал два часа́.' }]),
    ]
    expect(unannotatedStressDivergences(words)).toEqual([])
    const withoutNumeral = [
      noun('час=hour', 'час', { sg_gen: 'ча́са' }, [{ ru: 'Он ждал часа́ два.' }]),
    ]
    expect(unannotatedStressDivergences(withoutNumeral)).toHaveLength(1)
  })

  it('ignores a token with no mark at all — that is missingStressMarks\' job', () => {
    const words = [
      noun('полицейский=policeman', 'полице́йский', { sg_nom: 'полице́йский' }, [
        { ru: 'Полицейский останови́л маши́ну.' },
      ]),
    ]
    expect(unannotatedStressDivergences(words)).toEqual([])
  })
})

describe('formStressIndex', () => {
  it('collects every stressed form a word has, keyed by its bare spelling', () => {
    const index = formStressIndex([noun('час=hour', 'час', { sg_gen: 'ча́са', pl_dat: 'часа́м' })])
    expect([...index.get('часа').values()].map((v) => v.form)).toEqual(['ча́са'])
    expect(index.has('час')).toBe(false) // monosyllabic: nothing to disagree about
  })

  it('keeps both readings of a shared spelling', () => {
    const index = formStressIndex([
      noun('замок=castle', 'за́мок', { sg_nom: 'за́мок' }),
      noun('замок=lock', 'замо́к', { sg_nom: 'замо́к' }),
    ])
    expect(index.get('замок').size).toBe(2)
  })

  it('skips a word that is not part of the curriculum', () => {
    const gloss = { ...noun('часа=of an hour', 'часа́', { sg_nom: 'часа́' }), learnable: false }
    expect(formStressIndex([gloss]).size).toBe(0)
  })
})
