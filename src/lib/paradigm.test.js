import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildWords } from './vocabBuild.js'
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

// Personal pronoun — declines by case. Raw YAML lives under `extra.forms`.
const ya = {
  key: 'я=I',
  pos: 'pronoun',
  headword: 'я',
  meaning: 'I',
  extra: { type: 'pers', forms: { nom: 'я', gen: 'меня́', dat: 'мне', acc: 'меня́', ins: 'мной', pre: 'мне' } },
}

// Possessive pronoun — agrees by gender/number (m / f / n / pl), like adjectives.
const moy = {
  key: 'мой=my',
  pos: 'pronoun',
  headword: 'мой',
  meaning: 'my',
  extra: { type: 'poss', forms: { m: 'мой', f: 'моя́', n: 'моё', pl: 'мои́' } },
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

// Adjective with the full case × gender/number declension block.
const novyy = {
  key: 'новый=new',
  pos: 'adjective',
  headword: 'но́вый',
  meaning: 'new',
  extra: {
    forms: { m: 'но́вый', f: 'но́вая', n: 'но́вое', pl: 'но́вые', comparative: 'нове́е' },
    declension: {
      m_nom: 'но́вый', m_gen: 'но́вого', m_dat: 'но́вому', m_acc: 'но́вый', m_ins: 'но́вым', m_pre: 'но́вом',
      n_nom: 'но́вое', n_gen: 'но́вого', n_dat: 'но́вому', n_acc: 'но́вое', n_ins: 'но́вым', n_pre: 'но́вом',
      f_nom: 'но́вая', f_gen: 'но́вой', f_dat: 'но́вой', f_acc: 'но́вую', f_ins: 'но́вой', f_pre: 'но́вой',
      pl_nom: 'но́вые', pl_gen: 'но́вых', pl_dat: 'но́вым', pl_acc: 'но́вые', pl_ins: 'но́выми', pl_pre: 'но́вых',
    },
  },
}

// Adjective with only the legacy nominative forms (no declension block) — must
// still fall back to the gender-only agreement table.
const novyyNoDecl = {
  key: 'новый=new',
  pos: 'adjective',
  headword: 'но́вый',
  meaning: 'new',
  extra: { forms: { m: 'но́вый', f: 'но́вая', n: 'но́вое', pl: 'но́вые', comparative: 'нове́е' } },
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
  it('builds a case table for personal pronouns', () => {
    const p = buildParadigm(ya)
    expect(p.cols).toHaveLength(1)
    expect(p.cells).toHaveLength(6)
    expect(p.rows.map((r) => r.key)).toEqual(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'])
    expect(isMultiColumn(p)).toBe(false)
  })
  it('builds a gender table for possessive pronouns', () => {
    const p = buildParadigm(moy)
    expect(p.rows.map((r) => r.key)).toEqual(['m', 'f', 'n', 'pl'])
    expect(p.cells).toHaveLength(4)
    expect(p.stem).toBe('мо')
    expect(endingOf(p, p.cells.find((c) => c.row === 'f'))).toBe('я')
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
  it('builds the full case × gender/number grid', () => {
    expect(p.rows.map((r) => r.key)).toEqual(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'])
    expect(p.cols.map((c) => c.key)).toEqual(['m', 'n', 'f', 'pl'])
    expect(p.cells).toHaveLength(24)
    expect(isMultiColumn(p)).toBe(true)
    expect(p.stem).toBe('нов')
    expect(p.lemma).toBe('но́вый') // accented masculine headword
  })
  it('places oblique forms and derives their endings', () => {
    const fGen = p.cells.find((c) => c.row === 'gen' && c.col === 'f')
    expect(fGen.form).toBe('но́вой')
    expect(endingOf(p, fGen)).toBe('ой')
    const plIns = p.cells.find((c) => c.row === 'ins' && c.col === 'pl')
    expect(plIns.form).toBe('но́выми')
  })
  it('excludes the comparative (it lives in forms, not declension)', () => {
    expect(p.cells.some((c) => c.form.includes('нове'))).toBe(false)
  })
  it('falls back to the gender agreement table without a declension block', () => {
    const p2 = buildParadigm(novyyNoDecl)
    expect(p2.rows.map((r) => r.key)).toEqual(['m', 'f', 'n', 'pl'])
    expect(p2.cells).toHaveLength(4)
    expect(isMultiColumn(p2)).toBe(false)
  })
  it('drops non-Cyrillic placeholder forms', () => {
    const broken = buildParadigm({
      ...novyyNoDecl,
      extra: { forms: { m: 'но́вый', f: 'placeholder', n: 'но́вое', pl: 'но́вые' } },
    })
    expect(broken.cells.some((c) => c.form === 'placeholder')).toBe(false)
  })
})

describe('buildParadigms', () => {
  it('filters by part of speech and skips tableless words', () => {
    const words = [stol, ya, moy, chitat, novyy, { key: 'и=and', pos: 'conjunction', headword: 'и' }]
    expect(buildParadigms(words, 'noun')).toHaveLength(1)
    expect(buildParadigms(words, 'pronoun')).toHaveLength(2)
    expect(buildParadigms(words, 'verb')).toHaveLength(1)
    expect(buildParadigms(words, 'conjunction')).toHaveLength(0)
  })
})

// Guards against schema drift: runs the real pipeline over the committed YAML
// and asserts every drillable part of speech yields paradigms. This is what
// would have caught the pronoun/adjective field-name mismatch.
describe('buildParadigms over the shipped vocabulary', () => {
  const POS_BY_FILE = {
    nouns: 'noun',
    calendar: 'noun',
    pronouns: 'pronoun',
    verbs: 'verb',
    adjectives: 'adjective',
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.resolve(here, '../../public/vocab')
  const files = Object.entries(POS_BY_FILE).map(([file, pos]) => ({
    pos,
    text: fs.readFileSync(path.join(dir, `${file}.yml`), 'utf8'),
  }))
  const words = buildWords(files)

  it.each([
    ['noun', 100],
    ['pronoun', 20],
    ['verb', 50],
    ['adjective', 100],
  ])('produces plenty of %s paradigms (≥ %i)', (pos, min) => {
    const paradigms = buildParadigms(words, pos)
    expect(paradigms.length).toBeGreaterThanOrEqual(min)
    // Every paradigm must carry at least three filled cells to be drillable.
    for (const p of paradigms) expect(p.cells.length).toBeGreaterThanOrEqual(3)
  })
})
