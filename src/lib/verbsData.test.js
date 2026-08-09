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
import {
  FORM_SLOTS,
  PARTICIPLE_SLOTS,
  PASSIVE_SLOTS,
  SHORT_GENDERS,
  SLOT_ASPECTS,
} from './participles.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const verbs = yaml.load(readFileSync(resolve(vocabDir, 'verbs.yml'), 'utf8')).words
const entries = Object.entries(verbs)
const adjectives = yaml.load(readFileSync(resolve(vocabDir, 'adjectives.yml'), 'utf8')).words

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

// ── Non-finite forms: `participles:` and `gerund:` (#564) ───────────────────
//
// The rules these guard are the ones an author can't be expected to hold in
// their head across 977 entries: which slot each aspect may carry, that a
// half-filled short-passive block is always a mistake, and that a pasted form
// belongs to the verb it was pasted into. See docs/participles-and-gerunds.md.
describe('participles and gerunds', () => {
  const withNonFinite = entries.filter(([, w]) => w.participles || w.gerund)

  // Genuine oddities, keyed so the exception is visible rather than implied.
  // Empty today: the corpus stores no non-finite forms yet — stage 1 of #564 is
  // the machinery. A verb that legitimately breaks a rule below goes here with
  // the reason, exactly as `impersonalVerbs` does for the person-cell oracle.
  const SLOT_ALLOW = {}

  // Verbs whose root is too short for even a three-character stem check: дать's
  // participle «дан» shares only «да» with дать / даду́т / дал. One genuinely
  // suppletive verb, allowlisted rather than weakening the rule for everyone.
  const SHORT_STEM_ALLOW = new Set(['дать=to give'])

  // Every check below loops rather than using `it.each`, so the suite still runs
  // while the corpus carries no non-finite forms and each staged batch of data
  // arrives against guards that are already in place.
  const nonFiniteForms = (w) => [
    ...PARTICIPLE_SLOTS.map((s) => [s, w.participles?.[s]]),
    ...SHORT_GENDERS.map((g) => [`pass_short.${g}`, w.participles?.pass_short?.[g]]),
    ['gerund', w.gerund],
  ].filter(([, form]) => form)

  it('uses only known slot names', () => {
    for (const [key, w] of withNonFinite) {
      for (const slot of Object.keys(w.participles ?? {})) {
        expect(FORM_SLOTS, `${key}: unknown participle slot "${slot}"`).toContain(slot)
        expect(slot, `${key}: the gerund is a sibling of participles:, not a slot in it`).not.toBe(
          'gerund',
        )
      }
    }
  })

  it('carries only the slots each verb\'s aspect can form', () => {
    for (const [key, w] of withNonFinite) {
      const slots = [...Object.keys(w.participles ?? {}), ...(w.gerund ? ['gerund'] : [])]
      for (const slot of slots) {
        if (SLOT_ALLOW[key]?.includes(slot)) continue
        expect(SLOT_ASPECTS[slot], `${key} is ${w.aspect} and cannot form ${slot}`).toContain(
          w.aspect,
        )
      }
    }
  })

  it('gives no passive to a verb with no accusative object', () => {
    // A verb that governs a non-accusative frame (помога́ть + dative) has no
    // object to promote, so it has no passive of either tense.
    for (const [key, w] of withNonFinite) {
      const passive = PASSIVE_SLOTS.filter((s) => w.participles?.[s])
      if (!passive.length || !w.governs) continue
      expect(
        SLOT_ALLOW[key] ?? [],
        `${key} governs ${JSON.stringify(w.governs)} but stores ${passive.join(', ')}`,
      ).toEqual(expect.arrayContaining(passive))
    }
  })

  it('fills the short passive completely or not at all', () => {
    // Three cells out of four is always an authoring slip, never a real gap:
    // the short passive agrees with whatever the subject happens to be.
    for (const [key, w] of withNonFinite) {
      const short = w.participles?.pass_short
      if (!short) continue
      expect(Object.keys(short).sort(), `${key} pass_short`).toEqual([...SHORT_GENDERS].sort())
    }
  })

  it('stores only forms built on the verb\'s own stem', () => {
    // Cheap guard against a pasted wrong lexeme. Every non-finite form is built
    // off one of the verb's own stems — but not always the infinitive's: the
    // present participles come off the 3rd-plural, which mutates (пла́кать →
    // пла́чут → пла́чущий), and the past ones off the past stem. So compare
    // against all of them and require agreement with one.
    //
    // Three characters, not four: the stem a participle keeps is the bare root,
    // and for a short root the suffix starts diverging almost immediately —
    // купи́ть → ку́плен and реши́ть → решён share only «куп» / «реш» with every
    // finite form the verb has. Three still catches a whole wrong lexeme, which
    // is what this is for; the annotated-token check is the guard that proves a
    // stored form is the RIGHT one.
    const lcp = (a, b) => {
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      return i
    }
    for (const [key, w] of withNonFinite) {
      if (SHORT_STEM_ALLOW.has(key)) continue
      const c = w.conjugation ?? {}
      const finite = c.present ?? c.future ?? {}
      const bases = [
        stripStress(w.accented ?? key.split('=')[0]).replace(/(ся|сь)$/, ''),
        ...[finite['3pl'], finite['1pl'], c.past_m].filter(Boolean).map(stripStress),
      ]
      for (const [slot, form] of nonFiniteForms(w)) {
        const bare = stripStress(form)
        const shared = Math.max(...bases.map((b) => lcp(bare, b)))
        expect(
          shared,
          `${key}.${slot}: "${form}" shares no stem with ${bases.join(' / ')}`,
        ).toBeGreaterThanOrEqual(Math.min(3, bare.length))
      }
    }
  })

  it('marks stress on every polysyllabic form', () => {
    const vowels = (s) => [...stripStress(s)].filter((ch) => 'аеёиоуыэюя'.includes(ch)).length
    for (const [key, w] of withNonFinite) {
      for (const [slot, form] of nonFiniteForms(w)) {
        if (vowels(form) > 1 && !form.includes('ё')) {
          expect(form, `${key}.${slot}: "${form}" needs a stress mark`).toMatch(/́/)
        }
      }
    }
  })
})

// ── `from_verb:` — a lexicalised participle's back-link (#564, Decision 4) ──
//
// Nine participles are also taught as adjectives in their own right (закры́тый,
// при́нятый, …). They stay adjective entries — deleting them would lose their
// curated grids and usage phrases — but the five that are transparently
// participles link back to their verb, so the learner meets the pattern rather
// than a stray word. Two copies of one form is exactly the setup that drifts, so
// the link is checked in both directions, stress included.
describe('lexicalised participles (`from_verb:`)', () => {
  const linked = Object.entries(adjectives).filter(([, w]) => w.from_verb)

  it('links to a verb that stores that slot', () => {
    for (const [key, w] of linked) {
      const { key: verbKey, form } = w.from_verb
      expect(
        PARTICIPLE_SLOTS,
        `${key}: from_verb.form "${form}" is not a long participle`,
      ).toContain(form)
      const verb = verbs[verbKey]
      expect(verb, `${key}: from_verb "${verbKey}" does not exist`).toBeTruthy()
      expect(verb.participles?.[form], `${key}: ${verbKey} stores no ${form}`).toBeTruthy()
    }
  })

  it('agrees with the verb letter-for-letter, stress included', () => {
    // закры́т/закры́та appearing twice with different stress is precisely the bug
    // this guard is for.
    for (const [key, w] of linked) {
      const verb = verbs[w.from_verb.key]
      const headword = w.accented ?? w.forms?.m
      expect(verb.participles[w.from_verb.form], `${key} headword vs its verb`).toBe(headword)
      if (!w.short || !verb.participles?.pass_short) continue
      for (const g of SHORT_GENDERS) {
        expect(w.short[g], `${key} short.${g}`).toBe(verb.participles.pass_short[g])
      }
    }
  })
})
