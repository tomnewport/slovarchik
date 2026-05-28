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
 * Normalise an answer for comparison: drop stress marks, trim, lowercase,
 * collapse whitespace and treat ё/е as equivalent (a common typing slip).
 * @param {string} value
 * @returns {string}
 */
export function normalize(value) {
  return stripStress(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ё/g, 'е')
}
