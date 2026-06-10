// Generic inflection-paradigm model shared by every word type.
//
// A *paradigm* turns one word record into a 2-axis table of forms so the same
// four exercises (identify / drag / guided endings / blind endings) can drill
// nouns, pronouns, verbs and adjectives alike. Each word type only differs in
// how its rows, columns and cells are sourced; everything downstream operates on
// the uniform { rows, cols, cells, stem } shape.

import { stripStress, normalize } from './text.js'
import {
  CASES,
  CASE_LABELS,
  CASE_HINTS,
  NUMBERS,
  NUMBER_LABELS,
  commonStem,
} from './declension.js'

/**
 * Strip a parenthetical hint and collapse whitespace, e.g. "(о) столе́" → "столе́"
 * and "(обо) мне" → "мне". The data marks the governing preposition in parens;
 * learners shouldn't have to type it.
 */
export function cleanForm(value) {
  return String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasCyrillic(value) {
  return /[а-яё]/i.test(value)
}

// Person × number rows for the finite (present/future) verb conjugation.
const VERB_PERSONS = [
  { key: '1sg', label: '1st singular', sub: 'я' },
  { key: '2sg', label: '2nd singular', sub: 'ты' },
  { key: '3sg', label: '3rd singular', sub: 'он / она' },
  { key: '1pl', label: '1st plural', sub: 'мы' },
  { key: '2pl', label: '2nd plural', sub: 'вы' },
  { key: '3pl', label: '3rd plural', sub: 'они' },
]

// Past-tense rows: Russian past tense drops person and agrees by gender (in the
// singular) and number instead, so it gets its own row axis alongside the
// person rows above.
const VERB_PAST_ROWS = [
  { key: 'past_m', label: 'Past masc.', sub: 'он' },
  { key: 'past_f', label: 'Past fem.', sub: 'она' },
  { key: 'past_n', label: 'Past neut.', sub: 'оно' },
  { key: 'past_pl', label: 'Past plural', sub: 'они' },
]

// Gender × number agreement rows. Adjectives and the adjective-like pronouns
// (possessives, determiners, demonstratives, какой/чей) decline like this: the
// data gives the nominative form for each gender plus the shared plural.
const GENDER_FORMS = [
  { key: 'm', label: 'Masculine', sub: 'он' },
  { key: 'f', label: 'Feminine', sub: 'она' },
  { key: 'n', label: 'Neuter', sub: 'оно' },
  { key: 'pl', label: 'Plural', sub: 'они' },
]

// Gender/number columns for the full adjective case × agreement grid.
const GENDER_COLS = [
  { key: 'm', label: 'Masc.' },
  { key: 'n', label: 'Neut.' },
  { key: 'f', label: 'Fem.' },
  { key: 'pl', label: 'Plural' },
]

const SINGLE_COL = (label) => [{ key: '_', label }]

/** Human-readable title for a part of speech. */
export const POS_TITLES = {
  noun: 'Noun declension',
  pronoun: 'Pronoun declension',
  verb: 'Verb conjugation',
  adjective: 'Adjective forms',
}

/** Canonical key for a cell, e.g. "gen.pl". */
export function cellKey(row, col) {
  return `${row}.${col}`
}

/**
 * Assemble a paradigm from row/column axes and a lookup. Empty cells are
 * dropped, then any fully-empty row or column is pruned so the rendered table is
 * tight (e.g. pluralia-tantum nouns lose the singular column).
 */
function assemble(meta, rows, cols, lookup) {
  const cells = []
  for (const row of rows) {
    for (const col of cols) {
      const form = cleanForm(lookup(row.key, col.key))
      if (form && hasCyrillic(form)) {
        cells.push({ row: row.key, col: col.key, form })
      }
    }
  }
  const usedRows = rows.filter((r) => cells.some((c) => c.row === r.key))
  const usedCols = cols.filter((c) => cells.some((cell) => cell.col === c.key))
  const stem = commonStem(cells.map((c) => stripStress(c.form)))
  return { ...meta, rows: usedRows, cols: usedCols, cells, stem }
}

/**
 * Build a paradigm for a single normalised word record, or null if the word
 * carries no usable inflection table.
 * @param {object} word a record from buildWords()
 * @returns {object|null}
 */
export function buildParadigm(word) {
  const meta = {
    key: word.key,
    pos: word.pos,
    lemma: word.headword || word.ru,
    en: word.meaning || word.en,
    cefr: word.cefr ?? null,
    word,
  }

  let paradigm = null
  switch (word.pos) {
    case 'noun': {
      const rows = CASES.map((c) => ({ key: c, label: CASE_LABELS[c], sub: CASE_HINTS[c] }))
      const cols = NUMBERS.map((n) => ({ key: n, label: NUMBER_LABELS[n] }))
      // forms is nested number → case, columns are numbers and rows are cases.
      paradigm = assemble(meta, rows, cols, (row, col) => word.forms?.[col]?.[row])
      break
    }
    case 'pronoun': {
      // Raw YAML `forms`/`declension` (word.forms is only populated for nouns).
      // Three shapes, in priority order: the adjective-like pronouns
      // (possessives, determiners, demonstratives, какой/чей) carry a full
      // case × gender `declension` block; personal/reflexive/кто-что decline by
      // case only; anything left falls back to the nominative gender forms.
      const decl = word.extra?.declension
      const raw = word.extra?.forms ?? {}
      if (decl && Object.keys(decl).length) {
        // Full case × gender/number grid: cases are rows, genders are columns.
        // declension keys are "<gender>_<case>" (same layout as adjectives).
        const rows = CASES.map((c) => ({ key: c, label: CASE_LABELS[c], sub: CASE_HINTS[c] }))
        paradigm = assemble(meta, rows, GENDER_COLS, (row, col) => decl[`${col}_${row}`])
      } else if (CASES.some((c) => raw[c] != null)) {
        const rows = CASES.map((c) => ({ key: c, label: CASE_LABELS[c], sub: CASE_HINTS[c] }))
        paradigm = assemble(meta, rows, SINGLE_COL('Form'), (row) => raw[row])
      } else {
        paradigm = assemble(meta, GENDER_FORMS, SINGLE_COL('Form'), (row) => raw[row])
      }
      break
    }
    case 'verb': {
      // Imperfective verbs carry a present tense; perfective verbs a simple
      // future. Either way it is the finite, person-conjugated paradigm — it
      // becomes one column, with the gender/number past tense as a second.
      const conj = word.extra?.conjugation ?? {}
      const finite = conj.present ?? conj.future ?? {}
      const cols = [
        { key: 'finite', label: conj.present ? 'Present' : 'Simple Future' },
        { key: 'past', label: 'Past' },
      ]
      const rows = [...VERB_PERSONS, ...VERB_PAST_ROWS]
      paradigm = assemble(meta, rows, cols, (row, col) =>
        col === 'finite' ? finite[row] : conj[row],
      )
      break
    }
    case 'adjective': {
      const decl = word.extra?.declension
      if (decl && Object.keys(decl).length) {
        // Full case × gender/number grid: cases are rows, genders are columns.
        // declension keys are "<gender>_<case>".
        const rows = CASES.map((c) => ({ key: c, label: CASE_LABELS[c], sub: CASE_HINTS[c] }))
        paradigm = assemble(meta, rows, GENDER_COLS, (row, col) => decl[`${col}_${row}`])
      } else {
        // Fallback: just the nominative agreement forms (m / f / n / pl). The
        // comparative is excluded — it is a separate, often suppletive degree
        // (лучше, больше) that would break the shared stem of the ending drills.
        const raw = word.extra?.forms ?? {}
        paradigm = assemble(meta, GENDER_FORMS, SINGLE_COL('Form'), (row) => raw[row])
      }
      break
    }
    default:
      return null
  }

  // Need at least a few cells for any drill to make sense.
  return paradigm.cells.length >= 3 ? paradigm : null
}

/** Build every usable paradigm of a given part of speech. */
export function buildParadigms(words, pos) {
  const out = []
  for (const word of words) {
    if (word.pos !== pos) continue
    const paradigm = buildParadigm(word)
    if (paradigm) out.push(paradigm)
  }
  return out
}

/** Whether a paradigm has a real second axis (more than one column). */
export function isMultiColumn(paradigm) {
  return paradigm.cols.length > 1
}

/**
 * Stress-free ending of a cell relative to the paradigm stem.
 *
 * The stem is the longest common prefix of every form (see {@link assemble}),
 * so this is exact for regular nouns, verbs and adjective agreement. For
 * stem-mutating or suppletive paradigms (e.g. personal pronouns я/меня, where
 * the common prefix is empty) the "ending" degrades to the whole form — the
 * ending drills then ask for the full word, which is acceptable for those.
 */
export function endingOf(paradigm, cell) {
  const stemLen = [...paradigm.stem].length
  return [...stripStress(cell.form)].slice(stemLen).join('')
}

/** Every cell whose form matches `form` (ignoring stress/case/parentheticals). */
export function matchingCells(paradigm, form) {
  const target = normalize(form)
  return paradigm.cells.filter((c) => normalize(c.form) === target)
}

/** A human label for a cell, e.g. "Genitive · Plural" or just "Dative". */
export function cellLabel(paradigm, cell) {
  const row = paradigm.rows.find((r) => r.key === cell.row)
  const col = paradigm.cols.find((c) => c.key === cell.col)
  const rowLabel = row?.label ?? cell.row
  if (paradigm.cols.length > 1 && col) return `${rowLabel} · ${col.label}`
  return rowLabel
}
