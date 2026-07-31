#!/usr/bin/env node
/**
 * check-stress.mjs
 *
 * Proof-reads lexical stress across the vocab YAML (issue #457). Reports:
 *
 *   - Latin accented-vowel / homoglyph contamination in Russian text
 *     (an `á`/`é`/`ó`… or ASCII look-alike pasted into a Cyrillic string).
 *   - Wrong-syllable stress in usage phrases: annotated tokens whose stress
 *     disagrees with the word's own stored paradigm form for that slot — the
 *     meaning-changing homograph class (сто́ит/стои́т, гóрода/городá, …).
 *
 * The unit test `src/lib/stressData.test.js` guards the same two checks in CI;
 * run this script to eyeball the full list (and to burn down the divergence
 * backlog baselined there).
 *
 * Run: node scripts/check-stress.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { annotatedStressDivergences, latinInRussianText } from '../src/lib/stressAudit.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vocab')

function loadWords() {
  const files = readdirSync(vocabDir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')], text: readFileSync(resolve(vocabDir, f), 'utf8') }))
    .filter((r) => r.pos)
  return buildWords(files)
}

const words = loadWords()
const rules = yaml.load(readFileSync(resolve(vocabDir, 'grammar-rules.yml'), 'utf8')).rules

const latin = latinInRussianText(words)
console.log(`=== Latin homoglyphs in Russian text (${latin.length}) ===`)
for (const h of latin) console.log(`  [${h.label}] ${JSON.stringify(h.text)}`)

const div = annotatedStressDivergences(words, rules)
console.log(`\n=== Annotated token vs paradigm stress divergences (${div.length}) ===`)
for (const d of div) {
  console.log(`  [${d.id}] token «${d.token}» vs stored «${d.stored}»`)
  console.log(`      ${d.ru}`)
}

const total = latin.length + div.length
console.log(`\nTOTAL: ${total}`)
process.exitCode = total ? 1 : 0
