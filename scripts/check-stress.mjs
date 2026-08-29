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
import {
  annotatedStressDivergences,
  latinInRussianText,
  missingStressMarks,
  stressGoldenMismatches,
  unannotatedStressDivergences,
} from '../src/lib/stressAudit.js'
import { STRESS_GOLDEN } from '../src/lib/stressGolden.js'

/** Unannotated stress divergences that stand today (#600). Only ever lower it. */
const BUDGET = 177

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vocab')

function loadWords() {
  const files = readdirSync(vocabDir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')], doc: yaml.load(readFileSync(resolve(vocabDir, f), 'utf8')) }))
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

const golden = stressGoldenMismatches(words, STRESS_GOLDEN)
console.log(`\n=== Stored stress vs curated golden table (${golden.length}) ===`)
for (const m of golden) {
  console.log(
    `  [${m.key}] ${m.slot}: expected «${m.expected}», found ${m.actual == null ? '(missing)' : `«${m.actual}»`}`,
  )
}

const missing = missingStressMarks(words)
console.log(`\n=== Multi-syllable tokens missing a stress mark (${missing.length}) ===`)
for (const m of missing) {
  console.log(`  [${m.key}] ${m.where} «${m.token}»${m.ru ? `  ${m.ru}` : ''}`)
}

const loose = unannotatedStressDivergences(words)
const bySpelling = new Map()
for (const d of loose) {
  const k = d.dictionary
  if (!bySpelling.has(k)) bySpelling.set(k, [])
  bySpelling.get(k).push(d)
}
console.log(
  `\n=== Unannotated token vs the dictionary's only form (${loose.length} in ${bySpelling.size} spellings) ===\n`,
)
console.log('  Spellings more than one word claims are skipped, as is the count')
console.log('  form after 2/3/4. What is left is a sentence that is wrong, a')
console.log('  paradigm cell that is wrong, or a word the corpus does not have.\n')
for (const [dictionary, hits] of [...bySpelling.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(hits.length).padStart(3)}  «${hits[0].token}» vs «${dictionary}»  [${hits[0].owner}]`)
  console.log(`       ${hits[0].ru}`)
}

const total = latin.length + div.length + golden.length + missing.length
console.log(`\nTOTAL (must be zero): ${total}`)
if (loose.length > BUDGET) {
  console.error(
    `\nFAILED: ${loose.length} unannotated stress divergence(s), budget is ${BUDGET}.\n` +
      'Fix the mis-stressed side — the sentence or the paradigm cell. Where the\n' +
      'spelling really is shared with a word the corpus lacks, adding that word\n' +
      'resolves it. Do not raise the budget to make this pass.',
  )
} else if (loose.length < BUDGET) {
  console.log(`✓ unannotated: down to ${loose.length} from a budget of ${BUDGET} — lower BUDGET to lock the gain in.`)
} else {
  console.log('✓ unannotated: at budget')
}
process.exitCode = total || loose.length > BUDGET ? 1 : 0
