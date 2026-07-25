import { describe, it, expect } from 'vitest'

import { analyze, decide } from './annotate-inflect.mjs'

// A minimal feminine noun (кни́га): sg_dat and sg_pre are syncretic (кни́ге),
// pl_nom/pl_acc are syncretic (кни́ги), acc sg is distinct (кни́гу).
const kniga = {
  animacy: 'i',
  declension: {
    sg_nom: 'кни́га', sg_gen: 'кни́ги', sg_dat: 'кни́ге', sg_acc: 'кни́гу',
    sg_ins: 'кни́гой', sg_pre: 'кни́ге',
    pl_nom: 'кни́ги', pl_gen: 'книг', pl_dat: 'кни́гам', pl_acc: 'кни́ги',
    pl_ins: 'кни́гами', pl_pre: 'кни́гах',
  },
}

// Inanimate masc (стол): nom and acc share the bare stem.
const stol = {
  animacy: 'i',
  declension: {
    sg_nom: 'стол', sg_gen: 'стола́', sg_dat: 'столу́', sg_acc: 'стол',
    sg_ins: 'столо́м', sg_pre: 'столе́',
  },
}

// Animate masc (друг): acc syncretic with gen (дру́га).
const drug = {
  animacy: 'a',
  declension: {
    sg_nom: 'друг', sg_gen: 'дру́га', sg_dat: 'дру́гу', sg_acc: 'дру́га',
    sg_ins: 'дру́гом', sg_pre: 'дру́ге',
  },
}

const bucket = (pos, w, ru) => analyze(pos, w, ru).bucket

describe('analyze — bucket classification', () => {
  it('auto-pins a form unique to one oblique cell', () => {
    // кни́гу is only the accusative singular → the auto-annotator handles it.
    const a = analyze('noun', kniga, 'Я чита́ю кни́гу.')
    expect(a.status).toBe('annotate')
    expect(a.bucket).toBe('single-cell')
    expect(a.dec).toMatchObject({ token: 3, fields: { case: 'acc', number: 'sg' } })
  })

  it('auto-pins a dat/pre form when an adjacent preposition selects one case', () => {
    // кни́ге is dat or pre; «в» governs acc/pre, so pre is the only survivor.
    const a = analyze('noun', kniga, 'Отве́т в кни́ге.')
    expect(a.status).toBe('annotate')
    expect(a.bucket).toBe('prep-pinned')
    expect(a.dec.fields).toMatchObject({ case: 'pre', number: 'sg' })
  })

  it('routes an inanimate nom/acc form to accusative-object (confirm the case)', () => {
    const a = analyze('noun', stol, 'Я купи́л стол.')
    expect(a.status).toBe('skip')
    expect(a.bucket).toBe('accusative-object')
    expect(a.dec).toMatchObject({ token: 3, fields: { case: 'acc' }, confirm: ['case'] })
  })

  it('routes an animate acc=gen form to accusative-object', () => {
    const a = analyze('noun', drug, 'Я ви́жу дру́га.')
    expect(a.status).toBe('skip')
    expect(a.bucket).toBe('accusative-object')
    expect(a.dec.fields).toMatchObject({ case: 'acc', number: 'sg' })
    expect(a.dec.rule).toBe('noun-acc-animate')
  })

  it('reaches a governing preposition across an agreeing modifier', () => {
    // «в» … «ста́рой» … «кни́ге»: dat/pre pinned to pre despite the adjective.
    const a = analyze('noun', kniga, 'Отве́т в ста́рой кни́ге.')
    expect(a.status).toBe('skip')
    expect(a.bucket).toBe('prep-governed')
    expect(a.dec).toMatchObject({ fields: { case: 'pre' }, confirm: ['case'], prep: 'в' })
  })

  it('does not cross a clause boundary to find a preposition', () => {
    // The comma severs «в за́ле,» from кни́ге — no false prep-governed pin.
    expect(bucket('noun', kniga, 'Я был в за́ле, кни́ге ра́да ма́ма.')).not.toBe('prep-governed')
  })

  it('flags a case pinned but number-syncretic form as number-only', () => {
    // A crafted noun whose sg and pl prepositional share one form (сто́ле):
    // «в» pins the case to pre, but sg-vs-pl still needs a human from agreement.
    const dualPre = {
      animacy: 'i',
      declension: {
        sg_nom: 'стол', sg_gen: 'стола́', sg_dat: 'столу́', sg_acc: 'стол',
        sg_ins: 'столо́м', sg_pre: 'сто́ле',
        pl_nom: 'столы́', pl_gen: 'столо́в', pl_dat: 'стола́м', pl_acc: 'столы́',
        pl_ins: 'стола́ми', pl_pre: 'сто́ле',
      },
    }
    const a = analyze('noun', dualPre, 'Кни́га в сто́ле.')
    expect(a.status).toBe('skip')
    expect(a.bucket).toBe('number-only')
    expect(a.dec).toMatchObject({ fields: { case: 'pre' }, confirm: ['number'] })
  })

  it('leaves a bare inanimate genitive/ambiguous form as genuinely-ambiguous', () => {
    // кни́ги with no preposition and no object reading is gen-sg vs nom/acc-pl.
    expect(bucket('noun', kniga, 'Страни́цы кни́ги поте́ряны.')).toBe('genuinely-ambiguous')
  })

  it('classifies a nominative-only match as nominative-subject', () => {
    expect(bucket('noun', kniga, 'Кни́га лежи́т на столе́.')).toBe('nominative-subject')
  })

  it('reports no-matching-cell when no token is in the paradigm', () => {
    expect(bucket('noun', kniga, 'Он бежи́т домо́й.')).toBe('no-matching-cell')
  })

  it('decide() still returns an annotation only for the auto-pinned buckets', () => {
    expect(decide('noun', kniga, 'Я чита́ю кни́гу.')).toMatchObject({ fields: { case: 'acc' } })
    expect(decide('noun', stol, 'Я купи́л стол.')).toBeNull() // hand bucket → no auto
  })
})
