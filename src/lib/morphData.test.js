// Data-integrity gate for the morphology oracle (issue #446).
//
// Shape tests prove a cell has the right *fields*; the stress test proves the
// *stress* sits right; this proves the stored *form itself* is valid Russian —
// the layer that was missing when a bad source value (`слу́чайа`, a wrong-person
// verb cell, `не́кого` under некий) could be consumed identically by both a
// table and a drill and leave CI green.
//
// It runs the curated oracle (morphOracle.js + morphGolden.js) over the live
// vocab and must find nothing. When it fails, the message names the exact cell;
// fix the YAML, or — if the form is a legitimate variant, an impersonal verb,
// or a genuinely defective slot — record that in morphGolden.js as documented
// there. Run `node scripts/check-morphology.mjs` for the same report by hand.
import { describe, it, expect } from 'vitest'

import { loadFixtureWords } from '../test/fixtures.js'
import { morphologyViolations } from './morphOracle.js'
import { latinInRussianText } from './stressAudit.js'
import { MORPH_ORACLE } from './morphGolden.js'

const words = loadFixtureWords()

describe('morphology data integrity', () => {
  it('has no cells the oracle can prove wrong', () => {
    const violations = morphologyViolations(words, MORPH_ORACLE)
    expect(
      violations,
      `Morphology oracle findings — fix the cell or allowlist it in morphGolden.js:\n${violations
        .map((v) => `  [${v.check}] ${v.key} · ${v.slot} — ${v.message}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('treats Latin accented vowels / homoglyphs in Russian text as hard failures', () => {
    // Shared with stressData.test.js — a Latin á/é/ó (or ASCII look-alike) in a
    // Cyrillic string is a hard fail for the oracle too (issue #446).
    const hits = latinInRussianText(words)
    expect(
      hits,
      `Latin letters in Russian text:\n${hits.map((h) => `  [${h.label}] ${JSON.stringify(h.text)}`).join('\n')}`,
    ).toEqual([])
  })
})
