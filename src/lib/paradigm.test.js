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

// Possessive pronoun with only the legacy nominative agreement forms
// (m / f / n / pl) and no declension block — must fall back to the gender table.
const moy = {
  key: 'мой=my',
  pos: 'pronoun',
  headword: 'мой',
  meaning: 'my',
  extra: { type: 'poss', forms: { m: 'мой', f: 'моя́', n: 'моё', pl: 'мои́' } },
}

// Possessive pronoun carrying the full case × gender/number declension block —
// drills the adjective-style grid. declension keys are "<gender>_<case>".
const moyFull = {
  key: 'мой=my',
  pos: 'pronoun',
  headword: 'мой',
  meaning: 'my',
  extra: {
    type: 'poss',
    forms: { m: 'мой', f: 'моя́', n: 'моё', pl: 'мои́' },
    declension: {
      m_nom: 'мой', m_gen: 'моего́', m_dat: 'моему́', m_acc: 'мой', m_ins: 'мои́м', m_pre: 'моём',
      n_nom: 'моё', n_gen: 'моего́', n_dat: 'моему́', n_acc: 'моё', n_ins: 'мои́м', n_pre: 'моём',
      f_nom: 'моя́', f_gen: 'мое́й', f_dat: 'мое́й', f_acc: 'мою́', f_ins: 'мое́й', f_pre: 'мое́й',
      pl_nom: 'мои́', pl_gen: 'мои́х', pl_dat: 'мои́м', pl_acc: 'мои́', pl_ins: 'мои́ми', pl_pre: 'мои́х',
    },
  },
}

const chitat = {
  key: 'читать=to read',
  pos: 'verb',
  headword: 'чита́ть',
  meaning: 'to read',
  extra: {
    conjugation: {
      present: { '1sg': 'чита́ю', '2sg': 'чита́ешь', '3sg': 'чита́ет', '1pl': 'чита́ем', '2pl': 'чита́ете', '3pl': 'чита́ют' },
      past_m: 'чита́л',
      past_f: 'чита́ла',
      past_n: 'чита́ло',
      past_pl: 'чита́ли',
    },
  },
}

// Perfective verb — the finite paradigm is a simple future, not a present.
const prochitat = {
  key: 'прочитать=to read through',
  pos: 'verb',
  headword: 'прочита́ть',
  meaning: 'to read through',
  extra: {
    conjugation: {
      future: { '1sg': 'прочита́ю', '2sg': 'прочита́ешь', '3sg': 'прочита́ет', '1pl': 'прочита́ем', '2pl': 'прочита́ете', '3pl': 'прочита́ют' },
      past_m: 'прочита́л',
      past_f: 'прочита́ла',
      past_n: 'прочита́ло',
      past_pl: 'прочита́ли',
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
  it('falls back to a gender table when there is no declension block', () => {
    const p = buildParadigm(moy)
    expect(p.rows.map((r) => r.key)).toEqual(['m', 'f', 'n', 'pl'])
    expect(p.cells).toHaveLength(4)
    expect(p.stem).toBe('мо')
    expect(endingOf(p, p.cells.find((c) => c.row === 'f'))).toBe('я')
  })
  it('builds the full case × gender/number grid when a declension block exists', () => {
    const p = buildParadigm(moyFull)
    expect(p.rows.map((r) => r.key)).toEqual(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'])
    expect(p.cols.map((c) => c.key)).toEqual(['m', 'n', 'f', 'pl'])
    expect(p.cells).toHaveLength(24)
    expect(isMultiColumn(p)).toBe(true)
    const fGen = p.cells.find((c) => c.row === 'gen' && c.col === 'f')
    expect(fGen.form).toBe('мое́й')
    expect(cellLabel(p, fGen)).toBe('Genitive · Fem.')
  })
})

describe('buildParadigm — verb', () => {
  const p = buildParadigm(chitat)
  it('combines the finite and past tenses in one table', () => {
    // 6 present (person) + 4 past (gender/number) cells across two columns.
    expect(p.cells).toHaveLength(10)
    expect(p.cols.map((c) => c.key)).toEqual(['finite', 'past'])
    expect(p.cols[0].label).toBe('Present')
    expect(p.cols[1].label).toBe('Past')
    expect(isMultiColumn(p)).toBe(true)
    expect(p.stem).toBe('чита')
  })
  it('derives endings for both tenses', () => {
    const first = p.cells.find((c) => c.row === '1sg' && c.col === 'finite')
    expect(endingOf(p, first)).toBe('ю')
    const pastM = p.cells.find((c) => c.row === 'past_m' && c.col === 'past')
    expect(pastM.form).toBe('чита́л')
    expect(endingOf(p, pastM)).toBe('л')
  })
  it('labels finite and past cells with both axes', () => {
    const pastF = p.cells.find((c) => c.row === 'past_f' && c.col === 'past')
    expect(cellLabel(p, pastF)).toBe('Past fem. · Past')
  })
  it('labels the perfective finite tense as Future', () => {
    const pf = buildParadigm(prochitat)
    expect(pf.cells).toHaveLength(10)
    expect(pf.cols[0].label).toBe('Future')
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

  it('drills the adjective-like pronouns as a full case × gender grid', () => {
    // Pronouns that agree by gender (мой, этот, какой, …) now ship a declension
    // block, so their paradigm has both axes — cases as rows, genders as columns.
    const adjLike = words.filter((w) => w.pos === 'pronoun' && w.extra?.forms?.m)
    expect(adjLike.length).toBeGreaterThanOrEqual(15)
    for (const w of adjLike) {
      const p = buildParadigm(w)
      expect(p, w.key).not.toBeNull()
      expect(isMultiColumn(p), w.key).toBe(true)
      expect(p.rows.map((r) => r.key), w.key).toEqual(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'])
      expect(p.cols.map((c) => c.key), w.key).toEqual(['m', 'n', 'f', 'pl'])
      expect(p.cells, w.key).toHaveLength(24)
    }
  })
})
