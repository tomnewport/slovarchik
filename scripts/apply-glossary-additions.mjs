#!/usr/bin/env node
/**
 * apply-glossary-additions.mjs — add the gloss-only entries a Russian rewrite
 * makes necessary.
 *
 * `glossary.yml` holds surface forms that are not curriculum words but must be
 * glossable, because every word in an example sentence gets a tap hint and
 * `glossCoverage.test.js` fails on a hole. Rewriting a sentence can introduce a
 * form the corpus has never seen — «Существу́ют разли́чные подхо́ды к зада́че»
 * introduced подхо́ды, whose singular was already glossed and whose plural was
 * not — and the hole only surfaces when the test runs.
 *
 * Those entries used to be added by hand, which put them outside the replay:
 * `verify:review` skipped `glossary.yml` entirely, so nothing checked that the
 * committed file matched any record of why its entries exist. Recording them
 * here instead keeps the whole corpus reproducible from its inputs.
 *
 * Record (one JSON object per line):
 * {
 *   "key":        "подходы=approaches",
 *   "accented":   "подхо́ды",
 *   "cefr_level": "B1",
 *   "standard":   "approaches",
 *   "why":        "which rewrite introduced the form"
 * }
 *
 * Entries are inserted in the file's existing key order. `learn: false` is
 * implied — these are hint-only entries and never enter the curriculum.
 *
 * Usage:
 *   node scripts/apply-glossary-additions.mjs           # dry run
 *   node scripts/apply-glossary-additions.mjs --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const glossaryPath = join(__dirname, '..', 'public', 'vocab', 'glossary.yml')
const additionsPath = join(__dirname, '..', 'review', 'glossary-additions.jsonl')
const APPLY = process.argv.slice(2).includes('--apply')

if (!existsSync(additionsPath)) {
  console.log('no glossary additions recorded')
  process.exit(0)
}
const rows = readFileSync(additionsPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

const lines = readFileSync(glossaryPath, 'utf8').split('\n')
const present = new Set()
const starts = []
lines.forEach((l, i) => {
  const m = l.match(/^ {2}"([^"]+)":\s*$/)
  if (m) {
    present.add(m[1])
    starts.push({ key: m[1], line: i })
  }
})

const insertions = new Map() // beforeLine → string[]
let added = 0
for (const row of rows) {
  if (present.has(row.key)) continue
  const block = [
    `  ${JSON.stringify(row.key)}:`,
    `    cefr_level: ${row.cefr_level}`,
    '    learn: false',
    `    accented: ${JSON.stringify(row.accented)}`,
    '    en_gb:',
    `      standard: ${JSON.stringify(row.standard)}`,
  ]
  // Keep the file's key order; fall back to the end when it sorts last.
  const after = starts.find((s) => s.key.localeCompare(row.key, 'ru') > 0)
  const at = after ? after.line : lines.length
  insertions.set(at, [...(insertions.get(at) ?? []), ...block])
  added += 1
}

if (!added) {
  console.log(`all ${rows.length} glossary addition(s) already present`)
  process.exit(0)
}

const out = []
lines.forEach((line, i) => {
  if (insertions.has(i)) out.push(...insertions.get(i))
  out.push(line)
})
if (insertions.has(lines.length)) out.push(...insertions.get(lines.length))
const text = out.join('\n')
try {
  yaml.load(text)
} catch (err) {
  console.error(`glossary.yml: additions produce invalid YAML (${err.message}) — left untouched`)
  process.exit(1)
}
if (APPLY) writeFileSync(glossaryPath, text)
console.log(`${APPLY ? 'wrote' : 'would write'} ${added} glossary entr${added === 1 ? 'y' : 'ies'}`)
if (!APPLY) console.log('dry run — pass --apply to write')
