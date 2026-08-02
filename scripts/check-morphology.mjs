#!/usr/bin/env node
/**
 * check-morphology.mjs
 *
 * Runs the curated morphology oracle (issue #446) over the vocab YAML and
 * prints every cell it can prove wrong, grouped by check:
 *
 *   - orthography      impossible `й`+hard-vowel sequences in a generated
 *                      ending (`случай → слу́чайа`).
 *   - person-duplicate two persons in a verb's present/future spelled the same
 *                      (a wrong-person copy-paste), impersonal verbs excepted.
 *   - golden           a stored cell disagreeing with a curated correct form.
 *   - defective        a paradigm slot the language doesn't have, filled anyway.
 *   - latin            Latin accented vowels / homoglyphs in Russian text.
 *
 * The unit test `src/lib/morphData.test.js` guards the same checks in CI (and
 * `src/lib/morphOracle.test.js` locks in the regression seeds); run this script
 * to eyeball the full list while editing data.
 *
 * Run: node scripts/check-morphology.mjs   (npm run check:morph)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { morphologyViolations } from '../src/lib/morphOracle.js'
import { latinInRussianText } from '../src/lib/stressAudit.js'
import { MORPH_ORACLE } from '../src/lib/morphGolden.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vocab')

function loadWords() {
  const files = readdirSync(vocabDir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')], doc: yaml.load(readFileSync(resolve(vocabDir, f), 'utf8')) }))
    .filter((r) => r.pos)
  return buildWords(files)
}

const words = loadWords()
const violations = morphologyViolations(words, MORPH_ORACLE)
const latin = latinInRussianText(words).map((h) => ({ check: 'latin', key: h.label, slot: '', message: JSON.stringify(h.text) }))
const all = [...violations, ...latin]

const byCheck = new Map()
for (const v of all) byCheck.set(v.check, [...(byCheck.get(v.check) ?? []), v])

for (const [check, list] of byCheck) {
  console.log(`\n=== ${check} (${list.length}) ===`)
  for (const v of list) console.log(`  ${v.key}${v.slot ? ` · ${v.slot}` : ''} — ${v.message}`)
}

console.log(`\nTOTAL: ${all.length}`)
process.exitCode = all.length ? 1 : 0
