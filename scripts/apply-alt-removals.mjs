#!/usr/bin/env node
/**
 * apply-alt-removals.mjs — delete accepted alternates that are simply wrong.
 *
 * `en_alt` is the list of English renderings a phrase drill will mark correct.
 * A few of them are not renderings of their sentence at all: «Он дожда́лся у́тра
 * до́ма» ("He waited for the morning at home") accepts three variants of "he
 * works from morning to evening", which belongs to a different sentence
 * entirely. They look like a block that was left behind when the Russian it was
 * written for was replaced.
 *
 * These predate the translation review, and while they sat unreachable they did
 * little harm — the word-bank built its tiles from the primary alone, so a
 * learner could not assemble them. Widening the bank to make curated alternates
 * usable also made these usable, which turns dormant bad data into an answer the
 * drill reliably offers and accepts. Hence this.
 *
 * Removal is deliberately narrow: each record names the exact strings to drop,
 * and a string that is not present is an error rather than a no-op, so a typo
 * cannot quietly remove nothing. Removals live in a file rather than being
 * hand-edited into the YAML because `verify:review` replays the whole corpus
 * from its inputs and a hand edit would read as the review failing to reproduce
 * itself.
 *
 * Record (one JSON object per line):
 * {
 *   "key":    "утро=morning",
 *   "ru":     "Он дожда́лся у́тра до́ма.",
 *   "remove": ["From morning till evening he works.", …],
 *   "why":    "belongs to a different sentence"
 * }
 *
 * Usage:
 *   node scripts/apply-alt-removals.mjs                    # dry run
 *   node scripts/apply-alt-removals.mjs --apply
 *   node scripts/apply-alt-removals.mjs <file> --apply     # a subset
 *
 * The default is the whole record, which is what `verify:review` replays onto
 * the pre-review tree. Applying it to a tree that already carries some of those
 * removals fails — by design, since a record that resolves to nothing is how a
 * stale entry would hide. So a newly appended batch is applied by naming a file
 * holding just those lines; the full record still has to replay from the base.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { parseUsageItems } from './annotate-inflect.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vocabDir = join(__dirname, '..', 'public', 'vocab')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const named = args.find((a) => !a.startsWith('--'))
const removalsPath = named
  ? (named.startsWith('/') ? named : join(process.cwd(), named))
  : join(__dirname, '..', 'review', 'alt-removals.jsonl')

if (!existsSync(removalsPath)) {
  console.log('no alternate removals recorded')
  process.exit(0)
}
const rows = readFileSync(removalsPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const fileByKey = new Map()
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) fileByKey.set(key, `${name}.yml`)
}

const matchKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const byFile = new Map()
const failures = []
// Two records naming the same sentence would each plan against the same lines
// and one would be lost to the Map; refuse the pair instead.
const seen = new Set()
for (const row of rows) {
  const id = `${row.key}\u0000${matchKey(row.ru)}`
  if (seen.has(id)) { failures.push([row, 'duplicate record for this (key, ru)']); continue }
  seen.add(id)
  const file = fileByKey.get(row.key)
  if (!file) { failures.push([row, 'no such word key']); continue }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(row)
}

// Plan every file first and write nothing until the whole batch is known good.
// Writing as we go would let a stale record — one whose target has already been
// removed, or whose Russian has since changed — mutate some files and then exit
// non-zero, leaving the corpus in a state no input reproduces.
const planned = []
let removed = 0
let alreadyGone = 0
for (const [file, items] of byFile) {
  const path = join(vocabDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const index = new Map()
  for (const it of parseUsageItems(lines)) index.set(`${it.key}\u0000${matchKey(it.ru)}`, it)

  const drop = new Set() // line numbers
  for (const row of items) {
    const item = index.get(`${row.key}\u0000${matchKey(row.ru)}`)
    if (!item) { failures.push([row, 'usage item not found']); continue }
    const span = lines.slice(item.ruLine, item.lastLine + 1)
    const altAt = span.findIndex((l) => /^ {8}en_alt:/.test(l))
    if (altAt === -1) { failures.push([row, 'no en_alt block']); continue }

    // The alt list runs from the header to the first line that is not an item.
    const altLines = []
    for (let i = item.ruLine + altAt + 1; i <= item.lastLine; i += 1) {
      if (!/^ {10}- /.test(lines[i])) break
      altLines.push(i)
    }
    const textOf = (i) => lines[i].replace(/^ {10}- /, '').trim().replace(/^["'](.*)["']$/, '$1')

    // A record applies wholly or has already been applied wholly. Every target
    // still present is removed; every target already gone is fine, because this
    // stage is replayed from the base on every `verify:review` and the working
    // tree has usually had it applied already. What is not fine is a record that
    // matches *some* of its targets — that means the sentence has changed under
    // it, and the remaining strings name alternates that never existed.
    const hits = (row.remove ?? []).map((target) =>
      altLines.find((i) => !drop.has(i) && textOf(i) === String(target).trim()),
    )
    const found = hits.filter((h) => h !== undefined)
    if (found.length && found.length !== hits.length) {
      const missing = (row.remove ?? []).filter((_, i) => hits[i] === undefined)
      failures.push([row, `matched ${found.length}/${hits.length} alternates — not present: ${missing.join(' | ')}`])
      continue
    }
    for (const hit of found) { drop.add(hit); removed += 1 }
    if (!found.length) alreadyGone += 1
    // An emptied block would leave a dangling `en_alt:` key with no items.
    if (altLines.every((i) => drop.has(i))) drop.add(item.ruLine + altAt)
  }

  if (!drop.size) continue
  const text = lines.filter((_, i) => !drop.has(i)).join('\n')
  try {
    yaml.load(text)
  } catch (err) {
    failures.push([{ key: file }, `removals produce invalid YAML (${err.message})`])
    continue
  }
  planned.push({ file, path, text, count: drop.size })
}

console.log(`records ${rows.length} \u00b7 alternates removed ${removed} \u00b7 already absent ${alreadyGone} \u00b7 failures ${failures.length}`)
for (const [row, why] of failures) console.log(`  ! ${row.key}: ${why}`)

if (failures.length) {
  console.error('\nFAILED: nothing written. Every record must resolve before any file is touched.')
  process.exit(1)
}
for (const { file, path, text, count } of planned) {
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file}: ${count} line(s) removed`)
}
if (!APPLY) console.log('\ndry run — pass --apply to write')
