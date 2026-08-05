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
import {
  annotatedStressDivergences,
  latinInRussianText,
  missingStressMarks,
  stressGoldenMismatches,
} from './stressAudit.js'
import { STRESS_GOLDEN } from './stressGolden.js'

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

  it('has no multi-syllable Russian token written without a stress mark', () => {
    const missing = missingStressMarks(words)
    expect(
      missing,
      `Multi-syllable forms missing their stress mark:\n${missing
        .map((m) => `  [${m.key}] ${m.where} «${m.token}»${m.ru ? `  (${m.ru})` : ''}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('agrees with the curated stress-golden table on every pinned form', () => {
    const mismatches = stressGoldenMismatches(words, STRESS_GOLDEN)
    expect(
      mismatches,
      `Stored stress disagrees with the golden reference — fix the vocab YAML:\n${mismatches
        .map((m) => `  [${m.key}] ${m.slot}: expected «${m.expected}», found ${m.actual == null ? '(missing)' : `«${m.actual}»`}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
