// Shared text helpers for Russian strings.

// Acute-accent marks used (or mis-typed) to mark stress. The data files use the
// combining acute accent (U+0301); a learner reaching for a stress key on a
// physical keyboard can instead land a spacing acute (U+00B4 ´), a modifier
// letter acute (U+02CA ˊ) or the combining acute *tone* mark (U+0341) — none of
// which are ever meaningful in a Russian answer, so all fold away for grading.
const STRESS_MARK = /[\u0301\u0341\u00B4\u02CA]/g

/**
 * Remove stress marks so stored (accented) forms can be compared against what a
 * learner actually types.
 * @param {string} value
 * @returns {string}
 */
export function stripStress(value) {
  return String(value ?? '').replace(STRESS_MARK, '')
}

/**
 * Fold ё onto е. The two letters are written interchangeably (ё is routinely
 * printed as е in everyday Russian), so for *comparison* — grading what a
 * learner typed or said — they're treated as equal. Display and pronunciation
 * keep the original ё; only the matching key folds.
 * @param {string} value
 * @returns {string}
 */
export function foldYo(value) {
  return String(value ?? '').replace(/ё/g, 'е')
}

/**
 * Normalise an answer for comparison: drop stress marks, trim, lowercase,
 * collapse whitespace and treat ё/е as equivalent (a common typing slip).
 * @param {string} value
 * @returns {string}
 */
export function normalize(value) {
  return foldYo(stripStress(value).trim().toLowerCase().replace(/\s+/g, ' '))
}

/**
 * Compare two answers while preserving the position of their stress mark.
 * Case, whitespace and ё/е are still folded like `normalize`; the supported
 * acute-accent variants are canonicalised instead of removed.
 *
 * This is intended as a companion check after a lenient spelling match: most
 * drills accept omitted/misplaced stress, but can still point the slip out.
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function stressMatches(actual, expected) {
  const key = (value) =>
    foldYo(String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).replace(
      STRESS_MARK,
      '\u0301',
    )
  return key(actual) === key(expected)
}
