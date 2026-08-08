import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import {
  FORM_SLOTS,
  PARTICIPLE_SLOTS,
  SLOT_ASPECTS,
  gerundForm,
  isLongParticiple,
  participleCell,
  participleGrid,
  participleNominative,
  shortPassiveCell,
  storedNonFiniteForms,
  storedSlots,
} from './participles.js'

const verb = (text) => buildWords([{ pos: 'verb', doc: yaml.load(text) }])[0]

const прочитать = verb(`
words:
  "прочитать=to read":
    accented: прочита́ть
    aspect: pf
    en_gb: { standard: to read }
    participles:
      act_past: прочита́вший
      pass_past: прочи́танный
      pass_short: { m: прочи́тан, f: прочи́тана, n: прочи́тано, pl: прочи́таны }
    gerund: прочита́в
`)

const читать = verb(`
words:
  "читать=to read":
    accented: чита́ть
    aspect: impf
    en_gb: { standard: to read }
    participles: { act_pres: чита́ющий }
    gerund: чита́я
`)

const ждать = verb(`
words:
  "ждать=to wait":
    accented: ждать
    aspect: impf
    en_gb: { standard: to wait }
`)

describe('slot vocabulary', () => {
  it('offers the four long participles plus the short passive and the gerund', () => {
    expect(FORM_SLOTS).toEqual([...PARTICIPLE_SLOTS, 'pass_short', 'gerund'])
    expect(PARTICIPLE_SLOTS).toEqual(['act_pres', 'act_past', 'pass_pres', 'pass_past'])
  })

  it('denies a perfective the two present participles', () => {
    // A perfective has no present stem to build them from.
    expect(SLOT_ASPECTS.act_pres).toEqual(['impf'])
    expect(SLOT_ASPECTS.pass_pres).toEqual(['impf'])
    for (const slot of ['act_past', 'pass_past', 'pass_short', 'gerund']) {
      expect(SLOT_ASPECTS[slot], slot).toEqual(['impf', 'pf'])
    }
  })

  it('knows which slots decline like an adjective', () => {
    expect(PARTICIPLE_SLOTS.every(isLongParticiple)).toBe(true)
    expect(isLongParticiple('pass_short')).toBe(false)
    expect(isLongParticiple('gerund')).toBe(false)
  })
})

describe('reading stored forms', () => {
  it('reads a long participle nominative', () => {
    expect(participleNominative(прочитать, 'act_past')).toBe('прочита́вший')
    expect(participleNominative(прочитать, 'act_pres')).toBeNull()
  })

  it('refuses to read a non-long slot as a long participle', () => {
    // pass_short is a nested block, not a nominative — reading it as one would
    // hand declineAdjective an object.
    expect(participleNominative(прочитать, 'pass_short')).toBeNull()
  })

  it('reads the short passive per gender and the gerund as a scalar', () => {
    expect(shortPassiveCell(прочитать, 'f')).toBe('прочи́тана')
    expect(shortPassiveCell(прочитать, 'm')).toBe('прочи́тан')
    expect(gerundForm(прочитать)).toBe('прочита́в')
    expect(gerundForm(ждать)).toBeNull()
  })

  it('treats a blank cell as absent', () => {
    const blank = verb(`
words:
  "мочь=to be able":
    accented: мочь
    aspect: impf
    en_gb: { standard: to be able }
    gerund: "  "
`)
    expect(gerundForm(blank)).toBeNull()
  })

  it('lists the stored slots in canonical order', () => {
    expect(storedSlots(прочитать)).toEqual(['act_past', 'pass_past', 'pass_short', 'gerund'])
    expect(storedSlots(читать)).toEqual(['act_pres', 'gerund'])
    expect(storedSlots(ждать)).toEqual([])
  })

  it('flattens every stored form, one entry per short-passive gender', () => {
    expect(storedNonFiniteForms(читать)).toEqual([
      { slot: 'act_pres', form: 'чита́ющий' },
      { slot: 'gerund', form: 'чита́я' },
    ])
    expect(storedNonFiniteForms(прочитать).map((f) => f.slot)).toEqual([
      'act_past',
      'pass_past',
      'pass_short.m',
      'pass_short.f',
      'pass_short.n',
      'pass_short.pl',
      'gerund',
    ])
  })
})

describe('deriving the agreement grid', () => {
  it('derives all 24 cells from the one stored nominative', () => {
    const grid = participleGrid(читать, 'act_pres')
    expect(Object.keys(grid)).toHaveLength(24)
    expect(grid.m_nom).toBe('чита́ющий')
    expect(grid.f_acc).toBe('чита́ющую')
    expect(grid.pl_ins).toBe('чита́ющими')
  })

  it('is null for a slot the verb does not store', () => {
    expect(participleGrid(читать, 'pass_past')).toBeNull()
    expect(participleCell(читать, 'pass_past', { case: 'gen' })).toBeNull()
  })

  it('defaults to the masculine nominative — the participle dictionary form', () => {
    expect(participleCell(читать, 'act_pres')).toBe('чита́ющий')
  })

  it('copies the genitive into an animate accusative', () => {
    // «Она́ успока́ивала пла́чущего ребёнка» — the same rule adjectives follow.
    const at = { case: 'acc', gender: 'm', animate: true }
    expect(participleCell(читать, 'act_pres', at)).toBe('чита́ющего')
    expect(participleCell(читать, 'act_pres', { ...at, animate: false })).toBe('чита́ющий')
    // Feminine and neuter have no animate accusative to distinguish.
    expect(participleCell(читать, 'act_pres', { ...at, gender: 'f' })).toBe('чита́ющую')
  })
})
