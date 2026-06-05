// Pure helpers for the phrase-fixing exercise.
//
// Given a Russian phrase and its source noun (with a declension table), this
// module finds the inflected form that appears in the phrase and builds an
// exercise where the learner must restore the correct inflection from the
// dictionary (nominative) form.
import { normalize } from './text.js'
import { phraseTokens } from './phrases.js'

/** Strip leading/trailing non-letter characters from a token. */
function wordCore(token) {
  return token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
}

/**
 * Find which token in the Russian phrase is a non-nominative inflected form of
 * the given noun. Nominative matches are excluded — they would make the
 * exercise trivial. Returns null if no non-nominative match is found.
 */
export function findInflectedToken(phraseRu, noun) {
  if (!noun?.forms || Object.keys(noun.forms).length === 0) return null

  // Build a map from normalised form string → {num, cas, accented}.
  // Also track nominative forms so we can skip them.
  const nomForms = new Set()
  const formMap = new Map()
  for (const [num, cases] of Object.entries(noun.forms)) {
    for (const [cas, accented] of Object.entries(cases)) {
      const key = normalize(accented)
      if (cas === 'nom') nomForms.add(key)
      // First match wins when multiple case/number combos share a form.
      if (!formMap.has(key)) formMap.set(key, { num, cas, accented })
    }
  }

  const tokens = phraseTokens(phraseRu)
  for (let i = 0; i < tokens.length; i++) {
    const core = normalize(wordCore(tokens[i]))
    if (!core || !formMap.has(core)) continue
    if (nomForms.has(core)) continue // nominative — skip
    return { tokenIndex: i, token: tokens[i], ...formMap.get(core) }
  }
  return null
}

/**
 * Build the phrase-fix exercise data for a phrase and its source noun.
 * Returns null if the exercise cannot be constructed (e.g. no non-nominative
 * inflected form of the noun appears in the phrase).
 *
 * Shape of the returned object:
 *   phrase        – original {id, ru, en, source, cefr}
 *   noun          – source noun word record
 *   tokens        – original phrase tokens (correct inflections)
 *   displayTokens – tokens with the target replaced by the lemma
 *   targetIndex   – index of the target token
 *   lemma         – the accented nominative form shown to the learner
 *   answer        – normalised correct answer (for comparison)
 *   answerAccented – the correct form with stress marks (for display)
 *   num / cas     – grammatical number and case of the target form
 */
export function buildFixExercise(phrase, noun) {
  const match = findInflectedToken(phrase.ru, noun)
  if (!match) return null

  // Prefer sg nominative; fall back to pl nominative for pluralia tantum.
  const lemma =
    noun.forms?.sg?.nom ??
    noun.forms?.pl?.nom ??
    noun.headword ??
    noun.ru

  const tokens = phraseTokens(phrase.ru)

  // Replace only the word part in the matched token, preserving surrounding
  // punctuation (e.g. a trailing full stop).
  const origToken = tokens[match.tokenIndex]
  const leadPunct = origToken.match(/^[^\p{L}]*/u)?.[0] ?? ''
  const trailPunct = origToken.match(/[^\p{L}]*$/u)?.[0] ?? ''
  const displayToken = leadPunct + lemma + trailPunct

  return {
    phrase,
    noun,
    tokens,
    displayTokens: tokens.map((t, i) => (i === match.tokenIndex ? displayToken : t)),
    targetIndex: match.tokenIndex,
    lemma,
    answer: normalize(match.accented),
    answerAccented: match.accented,
    num: match.num,
    cas: match.cas,
  }
}
