// Shared text helpers for Russian strings.

// Combining acute accent (U+0301) used to mark stress in the data files.
const STRESS_MARK = /́/g

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
