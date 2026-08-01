// Data-integrity guards for lexical stress (issue #457). Structural tests check
// that a form has the right *letters*; these check that the stress sits on the
// right *syllable* — the class of error that "keeps surfacing" because it's
// valid Cyrillic, just wrong.
//
//   1. No Latin accented vowels / homoglyphs in Russian text. An `á`/`é`/`ó`…
//      (or an ASCII look-alike) pasted into a Cyrillic string renders like a
//      stressed vowel but is the wrong codepoint, so stress-aware matching
//      silently fails on it.
//
//   2. Annotated usage tokens agree on stress with their paradigm. Every token
//      carrying an `inflect:` annotation names its lemma and exact paradigm
//      slot, so the app already knows the one correct stressed form: the word's
//      own stored declension/conjugation cell. A token whose stress disagrees
//      with that cell is either a mis-stressed phrase or a mis-stressed
//      paradigm — the meaning-changing homograph class (сто́ит/стои́т,
//      гóрода/городá). Both must always be zero so this can't silently regrow.
//
// Run `node scripts/check-stress.mjs` for the full report while editing data.
import { describe, it, expect } from 'vitest'

import { loadFixtureWords, loadFixtureRules } from '../test/fixtures.js'
import { annotatedStressDivergences, latinInRussianText } from './stressAudit.js'

const words = loadFixtureWords()
const rules = loadFixtureRules()

describe('stress data integrity', () => {
  it('has no Latin accented vowels / homoglyphs in Russian text', () => {
    const hits = latinInRussianText(words)
    expect(
      hits,
      `Latin letters in Russian text:\n${hits.map((h) => `  [${h.label}] ${JSON.stringify(h.text)}`).join('\n')}`,
    ).toEqual([])
  })

  it('has no annotated token whose stress disagrees with its paradigm form', () => {
    const divergences = annotatedStressDivergences(words, rules)
    expect(
      divergences,
      `Wrong-syllable stress — fix the mis-stressed side (phrase or paradigm):\n${divergences
        .map((d) => `  [${d.id}] token «${d.token}» vs stored «${d.stored}»  (${d.ru})`)
        .join('\n')}`,
    ).toEqual([])
  })
})
