import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'

// buildWords takes parsed docs; this suite reads YAML off disk, so parse first.
const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))
import {
  buildParadigm,
  buildParadigms,
  buildShortParadigm,
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
  it('has no locative row when the noun declares none', () => {
    expect(p.rows.some((r) => r.key === 'loc')).toBe(false)
  })
})

describe('buildParadigm — noun with a per-cell note', () => {
  const god = {
    key: 'год=year',
    pos: 'noun',
    headword: 'год',
    meaning: 'year',
    forms: {
      sg: { nom: 'год', gen: 'го́да', dat: 'го́ду', acc: 'год', ins: 'го́дом', pre: 'го́де' },
      pl: { nom: 'го́ды', gen: 'лет', dat: 'го́дам', acc: 'го́ды', ins: 'го́дами', pre: 'го́дах' },
    },
    formNotes: {
      pl: { gen: 'Suppletive genitive plural — лет, not годо́в.' },
    },
  }
  const p = buildParadigm(god)
  it('attaches the note to the matching cell only', () => {
    const genPl = p.cells.find((c) => c.row === 'gen' && c.col === 'pl')
    expect(genPl.note).toMatch(/suppletive/i)
    const genSg = p.cells.find((c) => c.row === 'gen' && c.col === 'sg')
    expect(genSg.note).toBeUndefined()
    expect(p.cells.filter((c) => c.note)).toHaveLength(1)
  })
  it('leaves cells noteless when the noun declares no formNotes', () => {
    expect(buildParadigm(stol).cells.some((c) => c.note)).toBe(false)
  })
})

describe('buildParadigm — noun with a second locative', () => {
  const les = {
    key: 'лес=forest',
    pos: 'noun',
    headword: 'лес',
    meaning: 'forest',
    forms: {
      sg: { nom: 'лес', gen: 'ле́са', dat: 'ле́су', acc: 'лес', ins: 'ле́сом', pre: 'ле́се', loc: 'лесу́' },
      pl: { nom: 'леса́', gen: 'лесо́в', dat: 'леса́м', acc: 'леса́', ins: 'леса́ми', pre: 'леса́х' },
    },
  }
  const p = buildParadigm(les)
  it('adds a singular-only locative row with an explanatory note', () => {
    const loc = p.rows.find((r) => r.key === 'loc')
    expect(loc.label).toBe('Locative')
    expect(loc.note).toMatch(/locative/i)
    expect(p.cells.filter((c) => c.row === 'loc').map((c) => c.col)).toEqual(['sg'])
  })
  it('treats the locative as syncretic with the dative in spelling', () => {
    const keys = matchingCells(p, 'лесу').map((c) => cellKey(c.row, c.col)).sort()
    expect(keys).toEqual(['dat.sg', 'loc.sg'])
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
    expect(p.rows.map((r) => r.key)).toEqual(['nom', 'gen', 'dat', 'acc', 'acc_anim', 'ins', 'pre'])
    expect(p.cols.map((c) => c.key)).toEqual(['m', 'n', 'f', 'pl'])
    // 24 case×gender cells + the animate-accusative masc & plural.
    expect(p.cells).toHaveLength(26)
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
  it('labels finite cells with both axes, past cells without the redundant column', () => {
    const first = p.cells.find((c) => c.row === '1sg' && c.col === 'finite')
    expect(cellLabel(p, first)).toBe('1st singular · Present')
    // "Past fem." already names the tense — no "· Past" suffix.
    const pastF = p.cells.find((c) => c.row === 'past_f' && c.col === 'past')
    expect(cellLabel(p, pastF)).toBe('Past fem.')
  })
  it('labels the perfective finite tense as Simple Future', () => {
    const pf = buildParadigm(prochitat)
    expect(pf.cells).toHaveLength(10)
    expect(pf.cols[0].label).toBe('Simple Future')
  })
  it('omits the imperative column when the data carries no imperative', () => {
    expect(p.cols.map((c) => c.key)).toEqual(['finite', 'past'])
    expect(p.rows.some((r) => r.key.startsWith('imp_'))).toBe(false)
  })
})

describe('buildParadigm — verb with an imperative', () => {
  const skazat = {
    key: 'сказать=to say',
    pos: 'verb',
    headword: 'сказа́ть',
    meaning: 'to say',
    extra: {
      conjugation: {
        imperative: { sg: 'скажи́', pl: 'скажи́те' },
        future: { '1sg': 'скажу́', '2sg': 'ска́жешь', '3sg': 'ска́жет', '1pl': 'ска́жем', '2pl': 'ска́жете', '3pl': 'ска́жут' },
        past_m: 'сказа́л',
        past_f: 'сказа́ла',
        past_n: 'сказа́ло',
        past_pl: 'сказа́ли',
      },
    },
  }
  const p = buildParadigm(skazat)
  it('adds an Imperative column with the ты and вы rows', () => {
    expect(p.cols.map((c) => c.key)).toEqual(['finite', 'past', 'imper'])
    expect(p.cols[2].label).toBe('Imperative')
    expect(p.cells).toHaveLength(12)
    const sg = p.cells.find((c) => c.row === 'imp_sg')
    const pl = p.cells.find((c) => c.row === 'imp_pl')
    expect(sg).toMatchObject({ col: 'imper', form: 'скажи́' })
    expect(pl).toMatchObject({ col: 'imper', form: 'скажи́те' })
  })
  it('labels imperative cells without the redundant column', () => {
    const sg = p.cells.find((c) => c.row === 'imp_sg')
    expect(cellLabel(p, sg)).toBe('Imperative sg.')
    const row = p.rows.find((r) => r.key === 'imp_sg')
    expect(row.sub).toBe('ты')
  })
  it('folds the imperative into the shared stem computation', () => {
    // ска́жут / сказа́л / скажи́ share only "ска" once stress is stripped.
    expect(p.stem).toBe('ска')
  })
})

describe('buildParadigm — defective / impersonal verb (#445)', () => {
  // Impersonal перфектив: a 3sg future and a neuter past, nothing else. Marked
  // `defective` so the two-cell table is allowed instead of being dropped.
  const povezti = {
    key: 'повезти=to be lucky',
    pos: 'verb',
    headword: 'повезти́',
    meaning: 'to be lucky',
    extra: {
      defective: true,
      conjugation: { future: { '3sg': 'повезёт' }, past_n: 'повезло́' },
    },
  }

  it('builds a genuine two-cell paradigm and prunes the empty rows/cols', () => {
    const p = buildParadigm(povezti)
    expect(p).not.toBeNull()
    expect(p.cells).toHaveLength(2)
    // Only the finite and past columns survive — no imperative — and only the
    // 3sg and neuter-past rows, so no cell implies a person/gender that's absent.
    expect(p.cols.map((c) => c.key)).toEqual(['finite', 'past'])
    expect(p.rows.map((r) => r.key)).toEqual(['3sg', 'past_n'])
    expect(p.cells.find((c) => c.row === 'past_n').form).toBe('повезло́')
    expect(p.cells.some((c) => ['past_m', 'past_f', 'past_pl'].includes(c.row))).toBe(false)
  })

  it('still drops a sparse paradigm that is not marked defective', () => {
    const notMarked = { ...povezti, extra: { ...povezti.extra, defective: false } }
    expect(buildParadigm(notMarked)).toBeNull()
    const noFlag = { ...povezti, extra: { conjugation: povezti.extra.conjugation } }
    expect(buildParadigm(noFlag)).toBeNull()
  })

  it('keeps a four-cell reflexive-passive without fabricated masc/fem past', () => {
    // говориться: 3sg/3pl present + neuter/plural past, no 1st/2nd person and no
    // masculine/feminine past.
    const govoritsya = {
      key: 'говориться=to be said',
      pos: 'verb',
      headword: 'говори́ться',
      meaning: 'to be said',
      extra: {
        defective: true,
        conjugation: {
          present: { '3sg': 'говори́тся', '3pl': 'говоря́тся' },
          past_n: 'говори́лось',
          past_pl: 'говори́лись',
        },
      },
    }
    const p = buildParadigm(govoritsya)
    expect(p.cells).toHaveLength(4)
    expect(p.rows.map((r) => r.key)).toEqual(['3sg', '3pl', 'past_n', 'past_pl'])
    expect(p.cells.some((c) => c.row === 'past_m' || c.row === 'past_f')).toBe(false)
  })
})

describe('buildParadigm — adjective', () => {
  const p = buildParadigm(novyy)
  it('builds the full case × gender/number grid with the derived animate accusative', () => {
    expect(p.rows.map((r) => r.key)).toEqual(['nom', 'gen', 'dat', 'acc', 'acc_anim', 'ins', 'pre'])
    expect(p.cols.map((c) => c.key)).toEqual(['m', 'n', 'f', 'pl'])
    // 24 case×gender cells + the animate-accusative masc & plural (n/f pruned).
    expect(p.cells).toHaveLength(26)
    expect(isMultiColumn(p)).toBe(true)
    expect(p.stem).toBe('нов')
    expect(p.lemma).toBe('но́вый') // accented masculine headword
  })
  it('derives the animate accusative (= genitive) for masculine and plural only', () => {
    const animCells = p.cells.filter((c) => c.row === 'acc_anim')
    expect(animCells.map((c) => c.col)).toEqual(['m', 'pl'])
    expect(animCells.find((c) => c.col === 'm').form).toBe('но́вого')
    expect(animCells.find((c) => c.col === 'pl').form).toBe('но́вых')
    // The inanimate accusative stays the nominative form.
    expect(p.cells.find((c) => c.row === 'acc' && c.col === 'm').form).toBe('но́вый')
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
  const words = fromYaml(files)

  it.each([
    ['noun', 100],
    ['pronoun', 20],
    ['verb', 50],
    ['adjective', 100],
  ])('produces plenty of %s paradigms (≥ %i)', (pos, min) => {
    const paradigms = buildParadigms(words, pos)
    expect(paradigms.length).toBeGreaterThanOrEqual(min)
    // Every paradigm must carry enough filled cells to be drillable: three in
    // general, or at least two for an explicitly defective/impersonal paradigm
    // (impersonal повезти is a legitimate two-cell table — issue #445).
    for (const p of paradigms) {
      const floor = p.word?.extra?.defective ? 2 : 3
      expect(p.cells.length, p.key).toBeGreaterThanOrEqual(floor)
    }
  })

  it('ships short-form adjective paradigms and keeps every short: block complete', () => {
    // Every adjective carrying a `short:` block must yield a 4-cell (m/f/n/pl)
    // short-form paradigm, with a distinct key so it drills separately from the
    // full declension.
    const shortWords = words.filter((w) => w.pos === 'adjective' && w.short)
    expect(shortWords.length).toBeGreaterThanOrEqual(6)
    for (const w of shortWords) {
      for (const g of ['m', 'f', 'n', 'pl']) {
        expect(typeof w.short[g], `${w.key}.${g}`).toBe('string')
        expect(w.short[g].length, `${w.key}.${g}`).toBeGreaterThan(0)
      }
      const sp = buildShortParadigm(w)
      expect(sp, w.key).not.toBeNull()
      expect(sp.variant, w.key).toBe('short')
      expect(sp.key, w.key).toBe(`${w.key}#short`)
      expect(sp.cols, w.key).toHaveLength(1)
      expect(sp.cells.map((c) => c.row), w.key).toEqual(['m', 'f', 'n', 'pl'])
    }
    // The short paradigms show up in the adjective rotation alongside declensions.
    const adjParadigms = buildParadigms(words, 'adjective')
    expect(adjParadigms.filter((p) => p.variant === 'short').length).toBe(shortWords.length)
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
      expect(p.rows.map((r) => r.key), w.key).toEqual([
        'nom', 'gen', 'dat', 'acc', 'acc_anim', 'ins', 'pre',
      ])
      expect(p.cols.map((c) => c.key), w.key).toEqual(['m', 'n', 'f', 'pl'])
      // 24 case×gender cells + the derived animate-accusative masc & plural.
      expect(p.cells, w.key).toHaveLength(26)
    }
  })
})

describe('buildShortParadigm', () => {
  // A long adjective that also carries a short form (готовый → гото́в/гото́ва/…).
  const gotovyy = {
    key: 'готовый=ready',
    pos: 'adjective',
    headword: 'гото́вый',
    meaning: 'ready',
    cefr: 'A2',
    short: { m: 'гото́в', f: 'гото́ва', n: 'гото́во', pl: 'гото́вы' },
    extra: { forms: { m: 'гото́вый', f: 'гото́вая', n: 'гото́вое', pl: 'гото́вые' } },
  }
  // A short-form-only lexeme: no long form / declension at all (рад, до́лжен).
  const rad = {
    key: 'рад=glad',
    pos: 'adjective',
    headword: 'рад',
    meaning: 'glad',
    cefr: 'A1',
    short: { m: 'рад', f: 'ра́да', n: 'ра́до', pl: 'ра́ды' },
    extra: {},
  }

  it('builds a single-column m/f/n/pl table from the short block', () => {
    const p = buildShortParadigm(gotovyy)
    expect(p.variant).toBe('short')
    expect(p.variantLabel).toBe('Short form')
    expect(p.key).toBe('готовый=ready#short')
    expect(p.cols).toHaveLength(1)
    expect(p.cells.map((c) => c.form)).toEqual(['гото́в', 'гото́ва', 'гото́во', 'гото́вы'])
  })

  it('is the only paradigm a short-only lexeme yields', () => {
    // рад has no forms/declension, so its full paradigm is null…
    expect(buildParadigm(rad)).toBeNull()
    // …but the short-form paradigm still drills.
    expect(buildShortParadigm(rad).cells).toHaveLength(4)
  })

  it('returns null for an adjective with no short block', () => {
    expect(buildShortParadigm(novyy)).toBeNull()
  })
})
