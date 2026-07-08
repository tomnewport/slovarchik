// Pure, framework-free helper for the after-answer spelling reveal.
//
// Unlike lib/phrases.spellingDiff — which marks where a *retry* went wrong
// without giving the letters away — this aligns the learner's answer against the
// correct form once the answer is settled and reveals BOTH sides, so the learner
// can see exactly which letter differs. It exists because a wrong answer can look
// identical to the correct one (a Latin homoglyph, a stray accent, an invisible
// character): showing the two rows side by side with the mismatches flagged makes
// the difference visible where a bare "✗ correct-answer" reveal could not.
//
// Characters are aligned on a folded key (case-insensitive, ё≡е, combining marks
// ignored) — the same leniency the grader applies — so legitimate variation is
// never flagged; only a genuinely different, extra or missing letter is.

import { foldYo } from './text.js'

/** The comparison key for one base character: lower-cased, ё folded onto е. */
function foldKey(ch) {
  return foldYo(String(ch).toLowerCase())
}

/**
 * Break a string into display units — one per base (non-combining) character,
 * with any following combining marks (e.g. the U+0301 stress accent) kept on the
 * unit's display text but excluded from its comparison key. Leading combining
 * marks (which have no base to attach to) are dropped.
 * @param {string} str
 * @returns {Array<{display: string, key: string}>}
 */
function toUnits(str) {
  const units = []
  for (const ch of stripSpacingAccents(String(str ?? ''))) {
    if (/\p{M}/u.test(ch)) {
      if (units.length) units[units.length - 1].display += ch
      continue
    }
    units.push({ display: ch, key: foldKey(ch) })
  }
  return units
}

// Spacing acute-accent lookalikes a learner can mis-type for a stress mark
// (U+00B4, U+02CA). They aren't combining marks, so drop them outright rather
// than let them align as their own units and read as spurious "extra" letters —
// matching stripStress, which forgives them at grading time.
function stripSpacingAccents(str) {
  return str.replace(/[\u00B4\u02CA]/g, '')
}

/**
 * Align `typed` against `answer` and reveal both. Returns one row of units per
 * side, each unit flagged `ok` (part of the common subsequence) or not:
 *   - a `typed` unit with `ok:false` is a wrong or extra character the learner
 *     typed;
 *   - an `answer` unit with `ok:false` is a character the answer needs that the
 *     learner's spelling doesn't line up with.
 * Comparison folds case, ё/е and stress, so those never show as differences.
 * @param {string} typed
 * @param {string} answer
 * @returns {{typed: Array<{text: string, ok: boolean}>, answer: Array<{text: string, ok: boolean}>}}
 */
export function revealDiff(typed, answer) {
  const a = toUnits(typed)
  const b = toUnits(answer)
  const n = a.length
  const m = b.length
  // Longest-common-subsequence table (built bottom-up) to backtrace an alignment
  // that keeps as many matching letters paired as possible.
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i].key === b[j].key
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const typedOut = []
  const answerOut = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      typedOut.push({ text: a[i].display, ok: true })
      answerOut.push({ text: b[j].display, ok: true })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      typedOut.push({ text: a[i].display, ok: false })
      i++
    } else {
      answerOut.push({ text: b[j].display, ok: false })
      j++
    }
  }
  while (i < n) typedOut.push({ text: a[i++].display, ok: false })
  while (j < m) answerOut.push({ text: b[j++].display, ok: false })
  return { typed: typedOut, answer: answerOut }
}
