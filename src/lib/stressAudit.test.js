// Unit tests for the slot → stored form resolution behind both the in-context
// drill and the stress audit. The corpus-wide checks live in stressData.test.js;
// this file pins the resolution rules for the non-finite verb slots (#564),
// which have no corpus data to exercise them yet.
import { describe, it, expect } from 'vitest'

import { storedForm } from './stressAudit.js'

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
