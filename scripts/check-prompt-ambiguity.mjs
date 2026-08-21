#!/usr/bin/env node
/**
 * check-prompt-ambiguity.mjs — hold the line on unanswerable English prompts.
 *
 * The phrase drill runs English→Russian as well as Russian→English, and in that
 * direction a prompt is only fair if the English picks out one Russian sentence.
 * Where two sentences share a prompt and nothing separates them, the learner is
 * guessing and the grader marks one of two correct answers wrong.
 *
 * Most of these resolve themselves: `phraseAmbiguity.js` annotates the ты/вы and
 * gender ones from the Russian, and `promptDisambiguation.js` covers the rest
 * with the distinguishing note the headword gloss already carries. What this
 * guards is the remainder — prompts where neither mechanism can help, because
 * the words involved are not glossed apart.
 *
 * It is a ratchet, not a clean bill of health: BUDGET is the number that stands
 * today, and CI fails if it grows. Lower it as the backlog is worked off; never
 * raise it to make a red build green.
 *
 * Usage:
 *   node scripts/check-prompt-ambiguity.mjs          # report + enforce
 *   node scripts/check-prompt-ambiguity.mjs --list   # full detail, no enforcement
 */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load as yamlLoad } from 'js-yaml'
import { buildWords, shapePhrases, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { ambiguousPrompts, collidingPrompts, promptHints } from '../src/lib/promptDisambiguation.js'

const BUDGET = 18

const __dirname = dirname(fileURLToPath(import.meta.url))
const vocabDir = join(__dirname, '..', 'public', 'vocab')
const LIST = process.argv.slice(2).includes('--list')

const docs = readdirSync(vocabDir)
  .filter((f) => f.endsWith('.yml'))
  .sort()
  .map((file) => ({ file, pos: POS_BY_FILE[file.replace(/\.yml$/, '')], doc: yamlLoad(readFileSync(join(vocabDir, file), 'utf8')) }))
  .filter((r) => r.pos)
const words = buildWords(docs)
const phrases = shapePhrases(words)

const colliding = collidingPrompts(phrases)
const hinted = promptHints(phrases, words)
const left = ambiguousPrompts(phrases, words)

console.log(`English prompts shared by 2+ distinct Russian sentences: ${colliding.length}`)
console.log(`  resolved by ты/вы + gender annotation or a gloss note: ${colliding.length - left.length}`)
console.log(`  still unanswerable                                   : ${left.length}  (budget ${BUDGET})`)
console.log(`  phrases carrying a disambiguating hint               : ${hinted.size}`)

const byWhy = new Map()
for (const l of left) byWhy.set(l.why, (byWhy.get(l.why) ?? 0) + 1)
if (byWhy.size) {
  console.log('\nwhy each is unresolved:')
  for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${why}`)
}

if (LIST) {
  console.log()
  for (const l of left) {
    console.log(`  "${l.en}"   (${l.why})`)
    for (const m of l.members) console.log(`     ${m.ru}   [${m.source}]`)
  }
}

if (left.length > BUDGET) {
  console.error(
    `\nFAILED: ${left.length} unanswerable prompt(s), budget is ${BUDGET}.\n` +
      'Give the words that differ distinguishing notes in their `en_gb.standard`\n' +
      'parenthetical — that is what the drill shows — or fix the sentence. Run with\n' +
      '--list to see which. Do not raise the budget to make this pass.',
  )
  process.exit(1)
}
if (left.length < BUDGET) {
  console.log(`\n✓ down to ${left.length} from a budget of ${BUDGET} — lower BUDGET in this script to lock the gain in.`)
} else {
  console.log(`\n✓ at budget`)
}
