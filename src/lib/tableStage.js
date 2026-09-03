// Staged word-bank tables (#645).
//
// The first time a learner assembles a paradigm from a bank of forms, the whole
// table at once is a lot of choice: an adjective's declension is four columns of
// six or seven cells, so the bank offers two dozen chips whose only distinguishing
// feature is an ending. So the drill walks the table one column at a time —
// masculine, then neuter, then feminine, then plural for the gender tables;
// singular then plural for a noun; present / past / imperative for a verb —
// and only offers the forms of the column being filled. Once a learner has
// assembled a table with no corrections at all, that table is "clean" and is
// afterwards served whole.
//
// Which tables are clean is learning progress, so it lives on the word's
// progress record (`rec.tables`, keyed by {@link tableKey}); this module holds
// only the pure shape of the staging. No Vue, no I/O.

/** Record key for a word's primary paradigm (its variants use their own name). */
export const PRIMARY_TABLE = 'primary'

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
 * A single-column paradigm (personal pronouns, short forms, participles) has
 * nothing to split, so it is always one stage.
 *
 * @param {object} paradigm a built paradigm (see lib/paradigm.js)
 * @param {boolean} [staged] whether to split at all
 * @returns {string[][]} column keys per stage — never empty
 */
export function columnStages(paradigm, staged = false) {
  const cols = (paradigm?.cols ?? []).map((c) => c.key)
  if (!staged || cols.length < 2) return [cols]
  return cols.map((key) => [key])
}

/**
 * Whether a completed table earns its promotion to the full-table drill: every
 * cell right, with nothing to correct. A stress mismatch counts against it —
 * in the bank drill о́кна and окна́ are two different chips, so putting one where
 * the other belongs is a misplacement, not a typo.
 *
 * @param {Array<{correct: boolean, stressCorrect?: boolean|null}>} records
 */
export function isCleanTable(records = []) {
  return records.length > 0 && records.every((r) => r.correct && r.stressCorrect !== false)
}
