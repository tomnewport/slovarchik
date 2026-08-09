// Unit tests for the morphology oracle (issue #446).
//
// These use small synthetic word records rather than the real corpus so each
// check is exercised against a *known-bad* form and its correct counterpart.
// The bad forms are the concrete defects the oracle was built to catch
// (случай/комментарий/задать/осветить/рассмеяться/убедиться/некий): encoding
// them here as fixtures is the regression seed — the check must keep flagging
// them even after the live data is fixed. morphData.test.js is the companion
// that proves the live corpus is currently clean.
import { describe, it, expect } from 'vitest'

import {
  impossibleOrthography,
  personCellDuplicates,
  goldenMismatches,
  defectiveCellsPresent,
  morphologyViolations,
  readCell,
} from './morphOracle.js'

const noun = (key, headword, declension) => ({
  key,
  pos: 'noun',
  ru: headword.replace(/́/g, ''),
  headword,
  extra: { declension },
})
const verb = (key, conjugation) => ({ key, pos: 'verb', ru: key.split('=')[0], extra: { conjugation } })
// A verb carrying the non-finite blocks (#564) instead of / alongside a
// conjugation: `participles:` and `gerund:` are siblings of `conjugation:`.
const nonFinite = (key, extra) => ({ key, pos: 'verb', ru: key.split('=')[0], extra })
const adj = (key, headword, declension) => ({
  key,
  pos: 'adjective',
  ru: headword.replace(/́/g, ''),
  headword,
  extra: { declension },
})

describe('impossibleOrthography', () => {
  it('flags й + hard vowel introduced by an oblique cell (случай)', () => {
    const bad = noun('случай=case', 'слу́чай', {
      sg_nom: 'слу́чай',
      sg_gen: 'слу́чайа',
      sg_ins: 'слу́чайом',
      pl_nom: 'слу́чайы',
    })
    const hits = impossibleOrthography([bad])
    expect(hits.map((h) => h.slot).sort()).toEqual(['pl_nom', 'sg_gen', 'sg_ins'])
    expect(hits.find((h) => h.slot === 'sg_gen').sequences).toEqual(['йа'])
  })

  it('passes the correct soft paradigm', () => {
    const good = noun('случай=case', 'слу́чай', {
      sg_nom: 'слу́чай',
      sg_gen: 'слу́чая',
      sg_ins: 'слу́чаем',
      pl_nom: 'слу́чаи',
    })
    expect(impossibleOrthography([good])).toEqual([])
  })

  it('does not flag й+vowel that is already in the base form (район)', () => {
    // `йо` is real Cyrillic when it lives in the stem; only endings that
    // *introduce* it over the lemma are generation bugs.
    const rayon = noun('район=district', 'райо́н', {
      sg_nom: 'райо́н',
      sg_gen: 'райо́на',
      sg_pre: 'райо́не',
    })
    expect(impossibleOrthography([rayon])).toEqual([])
  })

  it('also checks conjugation cells', () => {
    const v = verb('фойкать=to foo', { present: { '1sg': 'фо́йыкаю' } })
    const hits = impossibleOrthography([v])
    expect(hits).toHaveLength(1)
    expect(hits[0].sequences).toEqual(['йы'])
  })
})

describe('personCellDuplicates', () => {
  it('flags a 3sg copied into the 3pl cell (осветить)', () => {
    const bad = verb('осветить=to illuminate', {
      future: { '1sg': 'освещу́', '2sg': 'освети́шь', '3sg': 'освети́т', '1pl': 'освети́м', '2pl': 'освети́те', '3pl': 'освети́т' },
    })
    const hits = personCellDuplicates([bad])
    expect(hits).toHaveLength(1)
    expect(hits[0].persons).toEqual(['3sg', '3pl'])
    expect(hits[0].form).toBe('освети́т')
  })

  it('flags a 2pl copied into the 2sg cell (рассмеяться)', () => {
    const bad = verb('рассмеяться=to burst out laughing', {
      future: { '1sg': 'рассмею́сь', '2sg': 'рассмеётесь', '3sg': 'рассмеётся', '1pl': 'рассмеёмся', '2pl': 'рассмеётесь', '3pl': 'рассмею́тся' },
    })
    const hits = personCellDuplicates([bad])
    expect(hits).toHaveLength(1)
    expect(hits[0].persons).toEqual(['2sg', '2pl'])
  })

  it('passes a fully distinct paradigm', () => {
    const good = verb('осветить=to illuminate', {
      future: { '1sg': 'освещу́', '2sg': 'освети́шь', '3sg': 'освети́т', '1pl': 'освети́м', '2pl': 'освети́те', '3pl': 'осветя́т' },
    })
    expect(personCellDuplicates([good])).toEqual([])
  })

  it('skips allowlisted impersonal verbs whose cells are all one form (хотеться)', () => {
    const impersonal = verb('хотеться=to feel like', {
      present: { '1sg': 'хо́чется', '2sg': 'хо́чется', '3sg': 'хо́чется', '1pl': 'хо́чется', '2pl': 'хо́чется', '3pl': 'хо́чется' },
    })
    expect(personCellDuplicates([impersonal])).toHaveLength(5) // flagged without the allowlist…
    expect(personCellDuplicates([impersonal], { allow: ['хотеться=to feel like'] })).toEqual([]) // …silent with it
  })
})

describe('goldenMismatches', () => {
  const golden = {
    'комментарий=comment': { sg_pre: 'коммента́рии' },
    'задать=to assign': { 'future.1pl': 'задади́м', 'future.2pl': 'задади́те' },
    'махать=to wave': { 'present.1sg': ['маха́ю', 'машу́'] },
  }

  it('flags a special -ий locative stored as -ие (комментарий)', () => {
    const bad = noun('комментарий=comment', 'коммента́рий', { sg_pre: 'коммента́рие' })
    const hits = goldenMismatches([bad], golden)
    expect(hits).toEqual([{ key: 'комментарий=comment', slot: 'sg_pre', expected: ['коммента́рии'], actual: 'коммента́рие' }])
  })

  it('flags a wrong дать-family conjugation (задать)', () => {
    const bad = verb('задать=to assign', { future: { '1pl': 'зади́м', '2pl': 'зади́те' } })
    const hits = goldenMismatches([bad], golden)
    expect(hits.map((h) => h.slot).sort()).toEqual(['future.1pl', 'future.2pl'])
  })

  it('passes when the stored cell is correct', () => {
    const good = noun('комментарий=comment', 'коммента́рий', { sg_pre: 'коммента́рии' })
    expect(goldenMismatches([good], golden)).toEqual([])
  })

  it('accepts either documented variant (махаю / машу) and ignores stress', () => {
    const withHaju = verb('махать=to wave', { present: { '1sg': 'маха́ю' } })
    const withMašu = verb('махать=to wave', { present: { '1sg': 'машу́' } })
    const withPlain = verb('махать=to wave', { present: { '1sg': 'махаю' } }) // no stress mark
    expect(goldenMismatches([withHaju], golden)).toEqual([])
    expect(goldenMismatches([withMašu], golden)).toEqual([])
    expect(goldenMismatches([withPlain], golden)).toEqual([])
  })

  it('rejects a form that is neither accepted variant', () => {
    const wrong = verb('махать=to wave', { present: { '1sg': 'ма́хает' } })
    expect(goldenMismatches([wrong], golden)).toHaveLength(1)
  })

  it('reports a golden cell missing from the data', () => {
    const empty = noun('комментарий=comment', 'коммента́рий', {})
    expect(goldenMismatches([empty], golden)[0].actual).toBeNull()
  })
})

describe('defectiveCellsPresent', () => {
  const defective = { 'убедиться=to make sure': ['future.1sg'] }

  it('flags a fabricated defective form (убедиться 1sg future)', () => {
    const bad = verb('убедиться=to make sure', { future: { '1sg': 'убежду́сь', '2sg': 'убеди́шься' } })
    expect(defectiveCellsPresent([bad], defective)).toEqual([
      { key: 'убедиться=to make sure', slot: 'future.1sg', form: 'убежду́сь' },
    ])
  })

  it('passes when the defective slot is absent', () => {
    const good = verb('убедиться=to make sure', { future: { '2sg': 'убеди́шься' } })
    expect(defectiveCellsPresent([good], defective)).toEqual([])
  })

  it('flags a fabricated top-level past cell on an impersonal verb (повезти)', () => {
    // The past agreement cells live directly under `conjugation`, not in a
    // nested block — so the guard only works if readCell reaches them (#445).
    const impersonalDefective = { 'повезти=to be lucky': ['past_m', 'past_f', 'past_pl'] }
    const bad = verb('повезти=to be lucky', { future: { '3sg': 'повезёт' }, past_n: 'повезло́', past_m: 'повезло́' })
    expect(defectiveCellsPresent([bad], impersonalDefective)).toEqual([
      { key: 'повезти=to be lucky', slot: 'past_m', form: 'повезло́' },
    ])
    // The real cells (neuter past, 3sg future) stay untouched.
    const good = verb('повезти=to be lucky', { future: { '3sg': 'повезёт' }, past_n: 'повезло́' })
    expect(defectiveCellsPresent([good], impersonalDefective)).toEqual([])
  })
})

describe('readCell', () => {
  it('reads flat declension and dotted conjugation slots', () => {
    const n = noun('x=x', 'x', { sg_gen: 'y' })
    const v = verb('z=z', { future: { '1pl': 'w' } })
    expect(readCell(n, 'sg_gen')).toBe('y')
    expect(readCell(v, 'future.1pl')).toBe('w')
    expect(readCell(n, 'sg_pre')).toBeNull()
  })

  it('reads a top-level conjugation cell (past_m) via its flat key', () => {
    const v = verb('z=z', { future: { '3sg': 'w' }, past_n: 'wn' })
    expect(readCell(v, 'past_n')).toBe('wn')
    expect(readCell(v, 'past_m')).toBeNull()
  })

  it('reads the non-finite blocks under their own key space (#564)', () => {
    const v = nonFinite('прочитать=to read', {
      participles: {
        pass_past: 'прочи́танный',
        pass_short: { m: 'прочи́тан', f: 'прочи́тана' },
      },
      gerund: 'прочита́в',
    })
    expect(readCell(v, 'participles.pass_past')).toBe('прочи́танный')
    expect(readCell(v, 'participles.pass_short.f')).toBe('прочи́тана')
    expect(readCell(v, 'gerund')).toBe('прочита́в')
    expect(readCell(v, 'participles.act_pres')).toBeNull()
    expect(readCell(v, 'participles.pass_short.pl')).toBeNull()
    // A nested block read without a gender is not a form.
    expect(readCell(v, 'participles.pass_short')).toBeNull()
    expect(readCell(verb('z=z', {}), 'gerund')).toBeNull()
  })
})

describe('non-finite cells', () => {
  it('walks participles and the gerund for the orthography check', () => {
    // They must reach impossibleOrthography — but NOT personCellDuplicates,
    // which would fire on пла́чущий vs пла́кавший (docs/participles-and-gerunds.md).
    const bad = nonFinite('читать=to read', {
      participles: { act_pres: 'читайущий', pass_short: { f: 'читайана' } },
      gerund: 'читайа',
    })
    expect(impossibleOrthography([bad]).map((h) => h.slot)).toEqual([
      'participles.act_pres',
      'participles.pass_short.f',
      'gerund',
    ])
  })

  it('does not read a participle as a duplicated person cell', () => {
    const twins = nonFinite('плакать=to cry', {
      participles: { act_pres: 'пла́чущий', act_past: 'пла́чущий' },
    })
    expect(personCellDuplicates([twins])).toEqual([])
  })
})

describe('morphologyViolations (aggregate)', () => {
  it('collects findings from every check with a stable shape', () => {
    const words = [
      noun('случай=case', 'слу́чай', { sg_gen: 'слу́чайа' }),
      adj('некий=certain', 'не́кий', { m_gen: 'не́кого' }),
      verb('убедиться=to make sure', { future: { '1sg': 'убежду́сь' } }),
    ]
    const oracle = {
      golden: { 'некий=certain': { m_gen: 'не́коего' } },
      defective: { 'убедиться=to make sure': ['future.1sg'] },
      impersonalVerbs: [],
    }
    const out = morphologyViolations(words, oracle)
    expect(out.map((f) => f.check).sort()).toEqual(['defective', 'golden', 'orthography'])
    for (const f of out) {
      expect(f).toEqual(expect.objectContaining({ check: expect.any(String), key: expect.any(String), slot: expect.any(String), message: expect.any(String) }))
    }
  })
})
