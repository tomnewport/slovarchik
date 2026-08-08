// Data-integrity guard for the verb lexicon's aspect pairs and imperatives.
//
//  - `pair:` links two entries as an aspect pair: both keys must exist, the
//    link must be reciprocal, and it must join one imperfective to one
//    perfective (catches a typo'd key or a same-aspect "pair").
//  - `motion_pair:` links the two members of a verb-of-motion pair (идти́ ↔
//    ходи́ть). Same reciprocity rule, but the opposite aspect check: BOTH
//    members are imperfective — the contrast is direction, not aspect — and
//    each declares which side it is with `motion: det | indet`.
//  - `conjugation.imperative` carries the accented command forms; the plural
//    is always the singular + те (reflexives swap -ся for -тесь), so the two
//    fields can be cross-checked mechanically.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { stripStress } from './text.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const verbs = yaml.load(readFileSync(resolve(vocabDir, 'verbs.yml'), 'utf8')).words
const entries = Object.entries(verbs)

const CYRILLIC = /^[а-яё]+$/iu // checked on stress-stripped forms

describe('aspect pairs (`pair:`)', () => {
  const paired = entries.filter(([, w]) => w.pair)

  it('links a substantial share of the lexicon', () => {
    expect(paired.length).toBeGreaterThanOrEqual(400)
  })

  it.each(paired.map(([key, w]) => [key, w]))('%s has a valid, reciprocal partner', (key, w) => {
    const partner = verbs[w.pair]
    expect(partner, `pair "${w.pair}" does not exist`).toBeTruthy()
    expect(partner.pair, `pair "${w.pair}" does not link back`).toBe(key)
    expect(new Set([w.aspect, partner.aspect]), 'a pair joins impf with pf').toEqual(
      new Set(['impf', 'pf']),
    )
  })
})

describe('motion pairs (`motion_pair:` / `motion:`)', () => {
  const paired = entries.filter(([, w]) => w.motion_pair)

  it('covers the determinate/indeterminate pairs the corpus carries', () => {
    // Eight pairs — 16 entries — as of #538: идти́/ходи́ть, е́хать/е́здить,
    // бежа́ть/бе́гать, лете́ть/лета́ть, плыть/пла́вать, нести́/носи́ть,
    // вести́/води́ть, везти́/вози́ть.
    expect(paired.length).toBeGreaterThanOrEqual(16)
    expect(paired.length % 2, 'a pair is two entries').toBe(0)
    expect(verbs['идти=to go'].motion_pair).toBe('ходить=to walk')
    expect(verbs['идти=to go'].motion).toBe('det')
    expect(verbs['ходить=to walk'].motion).toBe('indet')
  })

  it.each(paired.map(([key, w]) => [key, w]))('%s has a valid, reciprocal partner', (key, w) => {
    const partner = verbs[w.motion_pair]
    expect(partner, `motion_pair "${w.motion_pair}" does not exist`).toBeTruthy()
    expect(partner.motion_pair, `motion_pair "${w.motion_pair}" does not link back`).toBe(key)
    // The contrast is direction, so the pair joins one determinate to one
    // indeterminate — and both members are imperfective (that is exactly why
    // `pair:` cannot express it).
    expect(new Set([w.motion, partner.motion]), 'a motion pair joins det with indet').toEqual(
      new Set(['det', 'indet']),
    )
    expect([w.aspect, partner.aspect], 'both members are imperfective').toEqual(['impf', 'impf'])
  })

  it.each(entries.filter(([, w]) => w.motion))('%s declares a valid `motion`', (key, w) => {
    expect(['det', 'indet'], key).toContain(w.motion)
    expect(w.motion_pair, `${key} has motion but no motion_pair`).toBeTruthy()
  })
})

describe('imperatives (`conjugation.imperative`)', () => {
  const withImp = entries.filter(([, w]) => w.conjugation?.imperative)

  it('covers the A1/A2 lexicon (minus verbs with no natural command)', () => {
    const a12 = entries.filter(([, w]) => ['A1', 'A2'].includes(w.cefr_level))
    const covered = a12.filter(([, w]) => w.conjugation?.imperative)
    expect(covered.length).toBeGreaterThanOrEqual(280)
    // Sanity: the poster-children carry their well-known irregular forms.
    expect(verbs['сказать=to say'].conjugation.imperative).toEqual({ sg: 'скажи́', pl: 'скажи́те' })
    expect(verbs['дать=to give'].conjugation.imperative).toEqual({ sg: 'дай', pl: 'да́йте' })
    expect(verbs['есть=to eat'].conjugation.imperative).toEqual({ sg: 'ешь', pl: 'е́шьте' })
    expect(verbs['лечь=to lie down'].conjugation.imperative).toEqual({ sg: 'ляг', pl: 'ля́гте' })
    expect(verbs['ехать=to go by transport'].conjugation.imperative).toEqual({
      sg: 'поезжа́й',
      pl: 'поезжа́йте',
    })
  })

  it.each(withImp.map(([key, w]) => [key, w]))('%s has well-formed sg/pl forms', (key, w) => {
    const { sg, pl } = w.conjugation.imperative
    expect(stripStress(sg ?? ''), 'imperative sg').toMatch(CYRILLIC)
    expect(stripStress(pl ?? ''), 'imperative pl').toMatch(CYRILLIC)
    // pl = sg + те (reflexive verbs: -ся/-сь → -тесь), comparing stress-free
    // since composing the plural may add a stress mark to a bare monosyllable
    // (дай → да́йте). Reflexivity comes from the verb itself, not the form —
    // брось ends in -сь without being reflexive.
    const reflexive = /с[яь]=/.test(key)
    const bareSg = stripStress(sg)
    const barePl = stripStress(pl)
    const expected = reflexive ? bareSg.replace(/с[яь]$/, '') + 'тесь' : bareSg + 'те'
    expect(barePl).toBe(expected)
  })

  it('marks stress on every polysyllabic imperative', () => {
    const vowels = (s) => [...stripStress(s)].filter((ch) => 'аеёиоуыэюя'.includes(ch)).length
    for (const [key, w] of withImp) {
      for (const form of Object.values(w.conjugation.imperative)) {
        if (vowels(form) > 1 && !form.includes('ё')) {
          expect(form, `${key} imperative "${form}" needs a stress mark`).toMatch(/́/)
        }
      }
    }
  })
})
