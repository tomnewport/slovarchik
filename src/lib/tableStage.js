// Staged word-bank tables (#645).
//
// The first time a learner assembles a *big* paradigm from a bank of forms, the
// whole table at once is a lot of choice: an adjective's declension is four
// columns of six or seven cells, so the bank offers two dozen chips whose only
// distinguishing feature is an ending. Those tables are walked one column at a
// time — masculine, then neuter, then feminine, then plural — offering only the
// forms of the column being filled. Once a learner has assembled such a table
// with nothing placed in the wrong cell, that table is "clean" and is afterwards
// served whole.
//
// Only the big tables split. A noun (seven cases × singular/plural) or a verb
// (present, past, imperative) fits under STAGE_MIN_CELLS and is dealt whole from
// the start — splitting a two-column table gains little and costs a click.
//
// Which tables are clean is learning progress, so it lives on the word's
// progress record (`rec.tables`, keyed by {@link tableKey}); this module holds
// only the pure shape of the staging. No Vue, no I/O.

/** Record key for a word's primary paradigm (its variants use their own name). */
export const PRIMARY_TABLE = 'primary'

/**
 * How many cells a table must exceed before its first pass is split by column.
 * Fifteen puts the case × gender grids (up to 28 cells) above the line and
 * leaves every noun and verb table below it.
 */
export const STAGE_MIN_CELLS = 15

/**
 * The key a table is remembered under on a word's progress record: the variant
 * name (`'short'`, `'nonfinite'`, `'passive-short'`) or `'primary'` for the
 * word's main paradigm.
 */
export function tableKey(variant) {
  return variant || PRIMARY_TABLE
}

/**
 * Split a paradigm's columns into the stages the bank drill walks through: one
 * stage per column when staging, a single stage holding every column otherwise.
 * Only a multi-column table with more than {@link STAGE_MIN_CELLS} cells splits;
 * everything smaller — and every single-column paradigm (personal pronouns,
 * short forms, participles) — is one stage.
 *
 * @param {object} paradigm a built paradigm (see lib/paradigm.js)
 * @param {boolean} [staged] whether to split at all
 * @returns {string[][]} column keys per stage — never empty
 */
export function columnStages(paradigm, staged = false) {
  const cols = (paradigm?.cols ?? []).map((c) => c.key)
  if (!staged || cols.length < 2) return [cols]
  if ((paradigm?.cells?.length ?? 0) <= STAGE_MIN_CELLS) return [cols]
  return cols.map((key) => [key])
}

/**
 * Whether a completed table earns its promotion to the full-table drill: every
 * cell holds a form that belongs in it. A stress mismatch does not count against
 * it — the drill already flags о́кна for окна́ as a soft warning rather than a
 * wrong answer, and the staging is about cutting down the choice of forms, not
 * about drilling stress.
 *
 * @param {Array<{correct: boolean}>} records
 */
export function isCleanTable(records = []) {
  return records.length > 0 && records.every((r) => r.correct)
}
