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
  CASE_NOTES,
  LOCATIVE,
  ACC_ANIMATE,
  NUMBERS,
  NUMBER_LABELS,
  commonStem,
} from './declension.js'
import {
  FORM_HINT,
  FORM_LABEL,
  PARTICIPLE_SLOTS,
  gerundForm,
  participleNominative,
  shortPassiveCell,
} from './participles.js'

const caseRow = (c) => ({ key: c, label: CASE_LABELS[c], sub: CASE_HINTS[c], note: CASE_NOTES[c] })

// Noun rows: the six core cases plus the optional second locative. The locative
// row is pruned automatically for nouns that don't declare one (see assemble).
const NOUN_ROWS = [...CASES, LOCATIVE].map(caseRow)

// Adjective / adjective-like-pronoun rows: the six cases with a derived
// animate-accusative row spliced in right after the accusative. Its masculine
// and plural cells hold the genitive form (ви́жу хоро́шего дру́га); the neuter and
// feminine cells are empty (unchanged by animacy) and get pruned by `assemble`.
const ADJ_ROWS = [...CASES.slice(0, 4), ACC_ANIMATE, ...CASES.slice(4)].map(caseRow)

/** Lookup over a `<gender>_<case>` declension map that derives the animate acc. */
function adjLookup(decl) {
  return (row, col) =>
    row === ACC_ANIMATE
      ? col === 'm' || col === 'pl'
        ? decl[`${col}_gen`]
        : null
      : decl[`${col}_${row}`]
}

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

// Imperative rows: the command forms address ты (singular/informal) or вы
// (plural/formal). They live under `conjugation.imperative: { sg, pl }` in the
// data and are pruned automatically for verbs that don't carry them.
const VERB_IMPERATIVE_ROWS = [
  { key: 'imp_sg', label: 'Imperative sg.', sub: 'ты' },
  { key: 'imp_pl', label: 'Imperative pl.', sub: 'вы' },
]
const IMPERATIVE_KEY = { imp_sg: 'sg', imp_pl: 'pl' }

// Non-finite rows: the four long participles plus the gerund, each a single
// stored form. They are a paradigm of their own rather than columns on the
// finite table — see buildNonFiniteParadigm for why. The short passive agrees
// by gender/number, so it gets its own table (buildPassiveShortParadigm) and is
// not a row here.
const VERB_NON_FINITE_ROWS = PARTICIPLE_SLOTS.concat('gerund').map((key) => ({
  key,
  label: FORM_LABEL[key],
  sub: FORM_HINT[key],
}))

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
function assemble(meta, rows, cols, lookup, noteLookup) {
  const cells = []
  for (const row of rows) {
    for (const col of cols) {
      const form = cleanForm(lookup(row.key, col.key))
      if (form && hasCyrillic(form)) {
        const cell = { row: row.key, col: col.key, form }
        // An optional per-cell note (e.g. год's suppletive genitive plural лет)
        // rides along so tables can surface it as a tooltip on that cell.
        const note = noteLookup?.(row.key, col.key)
        if (note) cell.note = String(note).trim()
        cells.push(cell)
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
      const cols = NUMBERS.map((n) => ({ key: n, label: NUMBER_LABELS[n] }))
      // forms is nested number → case, columns are numbers and rows are cases;
      // formNotes mirrors that shape and carries the optional per-cell tooltips.
      paradigm = assemble(
        meta,
        NOUN_ROWS,
        cols,
        (row, col) => word.forms?.[col]?.[row],
        (row, col) => word.formNotes?.[col]?.[row],
      )
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
        // declension keys are "<gender>_<case>" (same layout as adjectives), with
        // the derived animate-accusative row.
        paradigm = assemble(meta, ADJ_ROWS, GENDER_COLS, adjLookup(decl))
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
      // becomes one column, with the gender/number past tense as a second and
      // the imperative (where the data carries one) as a third.
      const conj = word.extra?.conjugation ?? {}
      const finite = conj.present ?? conj.future ?? {}
      const imperative = conj.imperative ?? {}
      const cols = [
        { key: 'finite', label: conj.present ? 'Present' : 'Simple Future' },
        { key: 'past', label: 'Past' },
        { key: 'imper', label: 'Imperative' },
      ]
      const rows = [...VERB_PERSONS, ...VERB_PAST_ROWS, ...VERB_IMPERATIVE_ROWS]
      paradigm = assemble(meta, rows, cols, (row, col) =>
        col === 'finite'
          ? finite[row]
          : col === 'imper'
            ? imperative[IMPERATIVE_KEY[row]]
            : conj[row],
      )
      break
    }
    case 'adjective': {
      const decl = word.extra?.declension
      if (decl && Object.keys(decl).length) {
        // Full case × gender/number grid: cases are rows, genders are columns
        // ("<gender>_<case>"), with the derived animate-accusative row.
        paradigm = assemble(meta, ADJ_ROWS, GENDER_COLS, adjLookup(decl))
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

  // A drill needs at least a few cells to make sense. Genuinely defective or
  // impersonal paradigms (impersonal повезти: 3sg future + neuter past; a
  // reflexive-passive говориться with no 1st/2nd person) are marked `defective:
  // true` in the data — they are allowed down to two cells rather than padded
  // with fabricated filler forms (issue #445). Anything unmarked still needs
  // three, so an incompletely-authored table never becomes a degenerate drill.
  const minCells = word.extra?.defective ? 2 : 3
  return paradigm.cells.length >= minCells ? paradigm : null
}

/**
 * Build the short-form (predicate) paradigm for an adjective, or null if it
 * carries no `short:` block. Short forms agree by gender/number only (m/f/n/pl),
 * so this is a single-column agreement table — the same shape as the personal
 * pronouns — and drills identically. It is a *separate* paradigm from the full
 * case × gender declension: a short-only word (рад, до́лжен) has only this one.
 */
export function buildShortParadigm(word) {
  if (word.pos !== 'adjective' || !word.short) return null
  const meta = {
    key: `${word.key}#short`,
    pos: word.pos,
    lemma: word.headword || word.ru,
    en: word.meaning || word.en,
    cefr: word.cefr ?? null,
    variant: 'short',
    variantLabel: 'Short form',
    word,
  }
  const paradigm = assemble(meta, GENDER_FORMS, SINGLE_COL('Short form'), (row) => word.short[row])
  return paradigm.cells.length >= 3 ? paradigm : null
}

/**
 * Build the non-finite paradigm for a verb — its participles and gerund — or
 * null if it stores fewer than the usual three cells.
 *
 * This is a *separate* paradigm rather than extra columns on the finite table,
 * and deliberately so: {@link assemble} takes the paradigm's stem to be the
 * longest common prefix of every cell, so folding пи́шущий/пи́санный in beside
 * пишу́/писа́л would collapse писа́ть's common stem from `пиш`/`писа` to `пи` and
 * degrade "Type the endings" for the finite cells that work today. Adjective
 * short forms are split out for the same reason (see {@link buildShortParadigm}).
 *
 * `assemble` prunes the empty rows, so a perfective intransitive — which has
 * only two of these forms — falls under the three-cell floor and is correctly
 * dropped rather than drilled as a degenerate table.
 */
export function buildNonFiniteParadigm(word) {
  if (word.pos !== 'verb') return null
  const meta = {
    key: `${word.key}#nonfinite`,
    pos: word.pos,
    lemma: word.headword || word.ru,
    en: word.meaning || word.en,
    cefr: word.cefr ?? null,
    variant: 'nonfinite',
    variantLabel: 'Participles & gerund',
    word,
  }
  const paradigm = assemble(meta, VERB_NON_FINITE_ROWS, SINGLE_COL('Form'), (row) =>
    row === 'gerund' ? gerundForm(word) : participleNominative(word, row),
  )
  return paradigm.cells.length >= 3 ? paradigm : null
}

/**
 * Build the short (predicate) passive paradigm for a verb — «Магази́н закры́т»,
 * «Кни́га прочи́тана» — or null if it carries no `pass_short` block. Structurally
 * identical to an adjective's short form: agreement by gender/number only, no
 * case, and stored rather than derived because this is where participial stress
 * genuinely moves (при́нятый → принята́).
 */
export function buildPassiveShortParadigm(word) {
  if (word.pos !== 'verb') return null
  const meta = {
    key: `${word.key}#passive-short`,
    pos: word.pos,
    lemma: word.headword || word.ru,
    en: word.meaning || word.en,
    cefr: word.cefr ?? null,
    variant: 'passive-short',
    variantLabel: 'Short passive',
    word,
  }
  const paradigm = assemble(meta, GENDER_FORMS, SINGLE_COL('Short passive'), (row) =>
    shortPassiveCell(word, row),
  )
  return paradigm.cells.length >= 3 ? paradigm : null
}

// The *variant* tables a word can carry beyond its primary paradigm: an
// adjective's short form, and a verb's participles/gerund and short passive.
// Order matters — it is the order a word's tables are offered in, in free
// practice and in the session alike.
const VARIANT_BUILDERS = [buildShortParadigm, buildNonFiniteParadigm, buildPassiveShortParadigm]

/**
 * Every usable table for one word: its primary paradigm first, then any variant.
 * A handful of adjectives (до́лжен, рад) are short-form *only* and have no primary
 * table at all, so this can return a list that starts with a variant.
 * @param {object} word a record from buildWords()
 * @returns {object[]} possibly empty
 */
export function buildWordParadigms(word) {
  return [buildParadigm(word), ...VARIANT_BUILDERS.map((build) => build(word))].filter(Boolean)
}

/**
 * Whether a word carries any drillable table at all. Short-circuits, so it is
 * cheaper than `buildWordParadigms(word).length` for the common case of asking
 * the question of every word in the corpus.
 */
export function hasParadigm(word) {
  return Boolean(buildParadigm(word)) || VARIANT_BUILDERS.some((build) => build(word))
}

/**
 * The one table a drill means when it names a word and, optionally, a variant
 * (`'short'`, `'nonfinite'`, `'passive-short'`). A session exercise stores the
 * variant name rather than the table itself, so this is how it resolves back to
 * a paradigm at render time. Null when the word has no such table.
 */
export function paradigmFor(word, variant) {
  if (!variant) return buildParadigm(word)
  return buildWordParadigms(word).find((p) => p.variant === variant) ?? null
}

/**
 * Build every usable paradigm of a given part of speech — each word's primary
 * table plus its variants (see {@link buildWordParadigms}). Feeds the free
 * practice routes (`/adjectives`, `/verbs`); the mastery session draws the same
 * tables one word at a time through {@link paradigmFor}.
 */
export function buildParadigms(words, pos) {
  const out = []
  for (const word of words) {
    if (word.pos !== pos) continue
    out.push(...buildWordParadigms(word))
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
  // Skip a column whose label the row already spells out ("Past fem." needs no
  // "· Past"; "Imperative sg." needs no "· Imperative").
  if (paradigm.cols.length > 1 && col && !rowLabel.startsWith(col.label)) {
    return `${rowLabel} · ${col.label}`
  }
  return rowLabel
}
