// Gloss-coverage analysis: which words inside the phrase bank can't be hinted.
//
// Every example sentence on a learnable word becomes a phrase in the drills (see
// shapePhrases). When the learner taps a word inside a phrase we look it up in
// the form index (buildFormIndex) to show its meaning. A token that resolves to
// no index entry can never be glossed — it's a hole in the dictionary, either a
// missing lemma or a missing inflected form of one that's present.
//
// This module enumerates those holes so a test can guard against them and a
// script can report the long tail. It is pure and framework-free.
import { shapePhrases } from './vocabBuild.js'
import { buildFormIndex, phraseHintTokens, normToken } from './phraseHint.js'

/**
 * Find every distinct word-form that appears in the (learnable) phrase bank but
 * resolves to no gloss. Glosses are drawn from the *full* word list — including
 * `learn: false` gloss-only entries — so adding such an entry removes the hole.
 *
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {Array<{form: string, sample: string, count: number, phrases: string[]}>}
 *   one entry per unglossed normalised form, busiest first
 */
export function unglossedExampleForms(words) {
  const index = buildFormIndex(words)
  const phrases = shapePhrases(words)
  const missing = new Map()
  for (const p of phrases) {
    for (const tok of phraseHintTokens(p.ru, index)) {
      if (tok.hint) continue
      const form = normToken(tok.text)
      if (!form) continue // punctuation / digits — nothing to gloss
      if (!missing.has(form)) missing.set(form, { form, sample: tok.text, phrases: [] })
      missing.get(form).phrases.push(p.ru)
    }
  }
  return [...missing.values()]
    .map((m) => ({ form: m.form, sample: m.sample, count: m.phrases.length, phrases: m.phrases }))
    .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form, 'ru'))
}
