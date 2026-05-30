import { describe, it, expect } from 'vitest'

import {
  buildParadigm,
  buildParadigms,
  cleanForm,
  endingOf,
  matchingCells,
  cellLabel,
  cellKey,
  isMultiColumn,
} from './paradigm.js'

const stol = {
  key: 'стол=table',
  pos: 'noun',
  headword: 'сто́л',
  meaning: 'table',
  cefr: 'A1',
  forms: {
    sg: { nom: 'сто́л', gen: 'стола́', dat: 'столу́', acc: 'сто́л', ins: 'столо́м', pre: '(о) столе́' },
    pl: { nom: 'столы́', gen: 'столо́в', dat: 'стола́м', acc: 'столы́', ins: 'стола́ми', pre: '(о) стола́х' },
  },
}

const ya = {
  key: 'я=I',
  pos: 'pronoun',
  headword: 'я',
  meaning: 'I',
  extra: { declension: { nom: 'я', gen: 'меня́', dat: 'мне', acc: 'меня́', ins: 'мной', pre: '(обо) мне' } },
}

const chitat = {
  key: 'читать=to read',
  pos: 'verb',
  headword: 'чита́ть',
  meaning: 'to read',
  extra: {
    conjugation: {
      present: { '1sg': 'чита́ю', '2sg': 'чита́ешь', '3sg': 'чита́ет', '1pl': 'чита́ем', '2pl': 'чита́ете', '3pl': 'чита́ют' },
    },
  },
}

const novyy = {
  key: 'новый=new',
  pos: 'adjective',
  headword: 'но́вый',
  meaning: 'new',
  extra: {
    forms: { base: 'но́вый', short_m: 'но́в', short_f: 'нова́', short_n: 'но́во', short_pl: 'но́вы', comparative: 'нове́е' },
  },
}

describe('cleanForm', () => {
  it('strips parenthetical prepositions and whitespace', () => {
    expect(cleanForm('(о) столе́')).toBe('столе́')
    expect(cleanForm('(обо) мне')).toBe('мне')
    expect(cleanForm('  чита́ю ')).toBe('чита́ю')
  })
})

describe('buildParadigm — noun', () => {
  const p = buildParadigm(stol)
  it('has 6 cases × 2 numbers', () => {
    expect(p.rows).toHaveLength(6)
    expect(p.cols.map((c) => c.key)).toEqual(['sg', 'pl'])
    expect(p.cells).toHaveLength(12)
    expect(isMultiColumn(p)).toBe(true)
  })
  it('cleans the prepositional form', () => {
    const pre = p.cells.find((c) => c.row === 'pre' && c.col === 'sg')
    expect(pre.form).toBe('столе́')
  })
  it('derives the stem and endings', () => {
    expect(p.stem).toBe('стол')
    const gen = p.cells.find((c) => c.row === 'gen' && c.col === 'sg')
    expect(endingOf(p, gen)).toBe('а')
  })
  it('matches syncretic nominative/accusative singular', () => {
    const keys = matchingCells(p, 'стол').map((c) => cellKey(c.row, c.col)).sort()
    expect(keys).toEqual(['acc.sg', 'nom.sg'])
  })
  it('labels multi-column cells with both axes', () => {
    const gen = p.cells.find((c) => c.row === 'gen' && c.col === 'sg')
    expect(cellLabel(p, gen)).toBe('Genitive · Singular')
  })
})

describe('buildParadigm — pronoun', () => {
  const p = buildParadigm(ya)
  it('is a single-column case table', () => {
    expect(p.cols).toHaveLength(1)
    expect(p.cells).toHaveLength(6)
    expect(isMultiColumn(p)).toBe(false)
  })
  it('cleans the prepositional form', () => {
    expect(p.cells.find((c) => c.row === 'pre').form).toBe('мне')
  })
})

describe('buildParadigm — verb', () => {
  const p = buildParadigm(chitat)
  it('has six present-tense cells and a clean stem', () => {
    expect(p.cells).toHaveLength(6)
    expect(p.stem).toBe('чита')
    const first = p.cells.find((c) => c.row === '1sg')
    expect(endingOf(p, first)).toBe('ю')
  })
})

describe('buildParadigm — adjective', () => {
  const p = buildParadigm(novyy)
  it('uses the base as lemma and short forms as cells', () => {
    expect(p.lemma).toBe('но́вый') // base form kept with its stress mark, like noun headwords
    expect(p.stem).toBe('нов')
    expect(p.cells.length).toBeGreaterThanOrEqual(4)
  })
  it('drops non-Cyrillic placeholder forms', () => {
    const broken = buildParadigm({
      ...novyy,
      extra: { forms: { base: 'но́вый', short_m: 'short', short_f: 'нова́', short_n: 'но́во', short_pl: 'но́вы' } },
    })
    expect(broken.cells.some((c) => c.form === 'short')).toBe(false)
  })
})

describe('buildParadigms', () => {
  it('filters by part of speech and skips tableless words', () => {
    const words = [stol, ya, chitat, novyy, { key: 'и=and', pos: 'conjunction', headword: 'и' }]
    expect(buildParadigms(words, 'noun')).toHaveLength(1)
    expect(buildParadigms(words, 'verb')).toHaveLength(1)
    expect(buildParadigms(words, 'conjunction')).toHaveLength(0)
  })
})
