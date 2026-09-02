#!/usr/bin/env node
/**
 * apply-rule-repointing.mjs — point an `inflect:` annotation at a narrower rule.
 *
 * The rule ids are shaped per case + number, so every genitive-singular example
 * in the corpus gets the same paragraph — possession, negation, after a
 * preposition, and after два alike. The learner is left to work out which of the
 * case's six jobs is operating, and the word that decides it (два, мно́го) is
 * never the word being highlighted (#592).
 *
 * The fix is data, not prose: name the trigger with its own rule and re-point
 * the annotations at it. `inflect:` lines are compared by verify-review-replay,
 * so like every other corpus edit this has to be replayable rather than a hand
 * pass — see review/rule-repointing.jsonl for the rows and their reasons.
 *
 * Only the `rule:` field is touched. The token index, case, number and gender
 * are what the drill *grades*, and this pass has no business moving them.
 *
 * Row (one JSON object per line of review/rule-repointing.jsonl):
 * {
 *   "key":     "парк=park",              // the owning word's natural key
 *   "ru":      "Ря́дом с до́мом два…",     // identifies the usage item, verbatim
 *   "rule":    "noun-count-gen-sg",      // the rule id to point at
 *   "trigger": "два"                     // the word that governs it, for review
 * }
 *
 * Usage:
 *   node scripts/apply-rule-repointing.mjs              # dry run
 *   node scripts/apply-rule-repointing.mjs --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { parseUsageItems } from './annotate-inflect.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repo = join(__dirname, '..')
const vocabDir = join(repo, 'public', 'vocab')
const APPLY = process.argv.slice(2).includes('--apply')

const source = join(repo, 'review', 'rule-repointing.jsonl')
if (!existsSync(source)) {
  console.log('no review/rule-repointing.jsonl — nothing to apply')
  process.exit(0)
}

const rows = []
let parseFailures = 0
readFileSync(source, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    if (!line.trim()) return
    try {
      rows.push({ ...JSON.parse(line), _src: `review/rule-repointing.jsonl:${i + 1}` })
    } catch {
      console.error(`  ! review/rule-repointing.jsonl:${i + 1} is not valid JSON`)
      parseFailures += 1
    }
  })

// Every id has to name a real rule, or the reveal silently shows nothing.
const known = new Set(
  Object.keys(yaml.load(readFileSync(join(vocabDir, 'grammar-rules.yml'), 'utf8'))?.rules ?? {}),
)

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const fileByKey = new Map()
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) fileByKey.set(key, `${name}.yml`)
}

const unmatched = []
const byFile = new Map()
for (const r of rows) {
  if (!known.has(r.rule)) {
    unmatched.push({ ...r, why: `no such rule ${r.rule}` })
    continue
  }
  const file = fileByKey.get(r.key)
  if (!file) {
    unmatched.push({ ...r, why: 'no such word key' })
    continue
  }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(r)
}

const stats = { read: rows.length, repointed: 0, unchanged: 0 }
let writeFailures = 0
for (const [file, items] of byFile) {
  const path = join(vocabDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const usage = parseUsageItems(lines)
  const replacements = new Map()

  for (const r of items) {
    const item = usage.find((u) => u.key === r.key && u.ru === r.ru)
    if (!item) {
      unmatched.push({ ...r, why: 'no usage item with that ru' })
      continue
    }
    const at = lines
      .slice(item.ruLine, item.lastLine + 1)
      .findIndex((l) => /^ {8}inflect:/.test(l))
    if (at === -1) {
      unmatched.push({ ...r, why: 'that usage item carries no inflect block' })
      continue
    }
    const line = lines[item.ruLine + at]
    if (!/\brule:\s*[\w-]+/.test(line)) {
      unmatched.push({ ...r, why: 'inflect block names no rule' })
      continue
    }
    const next = line.replace(/\brule:\s*[\w-]+/, `rule: ${r.rule}`)
    if (next === line) {
      stats.unchanged += 1
      continue
    }
    replacements.set(item.ruLine + at, next)
    stats.repointed += 1
  }

  if (!replacements.size) continue
  const text = lines.map((l, i) => replacements.get(i) ?? l).join('\n')
  try {
    yaml.load(text)
  } catch (err) {
    console.error(`  ! ${file} would not parse after the edit: ${err.message}`)
    writeFailures += 1
    continue
  }
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file} (${replacements.size})`)
}

for (const u of unmatched) console.error(`  ✗ ${u._src}: ${u.key} — ${u.why}`)
console.log(`\nread=${stats.read} repointed=${stats.repointed} alreadyApplied=${stats.unchanged} unmatched=${unmatched.length}`)
if (parseFailures || writeFailures || unmatched.length) process.exit(1)
