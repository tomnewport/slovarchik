// Type-ahead options for the flashcard drill (#473, refined in #503).
//
// The flashcard input doubles as an autocomplete: as the learner types the
// English, a short list of candidate words appears so a known word can be
// tapped instead of typed in full — and, crucially, so near-identical glosses
// (a *winter* hat vs a *brimmed* hat) can be told apart by picking the exact
// form.
//
// The list is a plain substring match (#503): every pool word whose gloss
// contains what has been typed so far is a candidate. There are no decoys and
// no correctness scoring — the older "the closer your guess, the fewer random
// decoys" machinery is gone. Instead the list only appears once the guess has
// narrowed the field to FEWER THAN `OPTION_LIMIT` words, so it stays a short,
// useful shortlist (all the hats, say) rather than a wall of every word
// containing a common letter.
//
// Pure and framework-free.

/** Show the shortlist only once the substring match is narrower than this. */
export const OPTION_LIMIT = 10

/**
 * Strip a bracketed qualifier — "(winter)", "[pl]", "{formal}" — and collapse
 * whitespace, so "hat (winter)" and "hat" compare equal. Lower-casing is left to
 * the caller. Returns the trimmed remainder.
 * @param {string} text
 * @returns {string}
 */
export function stripBrackets(text) {
  return String(text ?? '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build the option list for the current guess: every pool word whose gloss
 * contains the typed text, but only once that leaves fewer than `limit`
 * matches (otherwise the field is too wide to be a useful shortlist).
 *
 * @param {object} args
 * @param {string} args.typed   the learner's current input
 * @param {Array<object>} args.pool  candidate options ({ key, en, label, … })
 * @param {number} [args.limit]  hide the list until fewer than this many match
 * @param {(o: object) => string} [args.keyOf]   identity, for de-duplication
 * @param {(o: object) => string} [args.textOf]  the gloss a guess matches against
 * @returns {Array<object>} the matching options (empty when nothing is typed,
 *   or when the match is still `limit` words or wider).
 */
export function buildOptions({
  typed,
  pool = [],
  limit = OPTION_LIMIT,
  keyOf = (o) => o.key,
  textOf = (o) => o.en,
} = {}) {
  const guess = stripBrackets(typed).toLowerCase()
  // Nothing typed yet: no autocomplete to offer (an empty guess substring-matches
  // the whole dictionary, which would just be noise).
  if (!guess) return []

  const seen = new Set()
  const matches = []
  for (const o of pool) {
    const text = stripBrackets(textOf(o)).toLowerCase()
    if (!text || !text.includes(guess)) continue
    const k = keyOf(o)
    if (seen.has(k)) continue
    seen.add(k)
    matches.push(o)
  }
  // Too many still match to be a useful shortlist — keep the list hidden until
  // the guess narrows the field.
  if (matches.length >= limit) return []
  return matches
}
