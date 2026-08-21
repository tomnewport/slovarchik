#!/usr/bin/env node
/**
 * apply-gloss-review.mjs — widen headword glosses from a gloss-review pass.
 *
 * The translation review kept finding sentences whose English was right while
 * the word's own gloss did not reach that sense. Those were recorded as flags
 * rather than edits, because a gloss is not local: it is shown on every tap
 * hint, it seeds the accepted answers for the vocabulary drill, and it feeds
 * the spelling prompt. Widening one is a deliberate act.
 *
 * A gloss is widened by appending to `en_gb.alt`. The key is never touched —
 * it is the word's identity and the progress store is keyed on it, so
 * `"кран=tap"` stays `"кран=tap"` and gains an alt of "crane". See
 * public/vocab/CONTRIBUTING.md.
 *
 * Proposal record (one JSON object per line):
 * {
 *   "key":     "кран=tap",
 *   "verdict": "widen" | "keep",
 *   "alt":     ["crane (a machine for lifting)"],   // required for widen
 *   "note":    "why",
 *   "confidence": "high" | "medium" | "low"
 * }
 *
 * Each alt follows the same convention as `standard`: the text before the first
 * "(" is the short gloss that is shown and graded; the parenthetical is a
 * clarifying note. The note must *distinguish* — the spelling drill prompts
 * with gloss + note + part of speech and nothing else, so two words sharing all
 * three ask an unanswerable question and `spellPromptData.test.js` fails CI.
 *
 * Usage:
 *   node scripts/apply-gloss-review.mjs review/gloss/*.jsonl          # dry run
 *   node scripts/apply-gloss-review.mjs review/gloss/*.jsonl --apply
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vocabDir = join(__dirname, '..', 'public', 'vocab')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const inputs = args.filter((a) => !a.startsWith('--') && a.endsWith('.jsonl'))
if (!inputs.length) {
  console.error('no .jsonl proposal files given')
  process.exit(1)
}

/** Render a string as a YAML scalar, quoting only when plain style would break. */
function yamlScalar(value) {
  const s = String(value)
  const needsQuote = /^[\s>|*&!%@`'"[\]{}#,-]/.test(s) || /:\s|\s#/.test(s) || /[:#]$/.test(s) || s !== s.trim()
  return needsQuote ? JSON.stringify(s) : s
}

const proposals = []
let parseFailures = 0
for (const file of inputs) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return
    try {
      proposals.push({ ...JSON.parse(line), _src: `${file}:${i + 1}` })
    } catch {
      console.error(`  ! ${file}:${i + 1} is not valid JSON`)
      parseFailures += 1
    }
  })
}

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const fileByKey = new Map()
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) fileByKey.set(key, `${name}.yml`)
}

const stats = { read: proposals.length, keep: 0, widen: 0, alreadyPresent: 0, unmatched: 0 }
const unmatched = []
const byFile = new Map()
for (const p of proposals) {
  if (p.verdict === 'keep') { stats.keep += 1; continue }
  if (p.verdict !== 'widen') { unmatched.push({ ...p, why: `unknown verdict ${p.verdict}` }); stats.unmatched += 1; continue }
  if (!(p.alt ?? []).filter(Boolean).length) { unmatched.push({ ...p, why: 'widen without alt' }); stats.unmatched += 1; continue }
  const file = fileByKey.get(p.key)
  if (!file) { unmatched.push({ ...p, why: 'no such word key' }); stats.unmatched += 1; continue }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(p)
}

let writeFailures = 0
for (const [file, items] of byFile) {
  const path = join(vocabDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')

  // Line span of each word entry: from its `  "key":` line to the next one.
  const starts = []
  lines.forEach((l, i) => {
    const m = l.match(/^ {2}"([^"]+)":\s*$/)
    if (m) starts.push({ key: m[1], line: i })
  })
  const spanOf = new Map()
  starts.forEach((s, i) => spanOf.set(s.key, [s.line, i + 1 < starts.length ? starts[i + 1].line : lines.length]))

  // Merge every proposal for a word into one. Two `widen` rows for the same key
  // used to be handled independently, and when the word had no `alt:` block yet
  // each of them opened its own — producing a duplicate mapping key and invalid
  // YAML. Reviewers work in parallel over re-cut packets, so two rows for one
  // key is ordinary, not a malformed input.
  const merged = new Map() // key → {key, alt[], _src[]}
  for (const p of items) {
    const at = merged.get(p.key)
    if (at) {
      at.alt.push(...p.alt)
      at._src.push(p._src)
    } else {
      merged.set(p.key, { ...p, alt: [...p.alt], _src: [p._src] })
    }
  }

  const insertions = new Map() // afterLine → string[]
  for (const p of merged.values()) {
    const span = spanOf.get(p.key)
    if (!span) { unmatched.push({ ...p, why: 'word entry not found in file' }); stats.unmatched += 1; continue }
    const [from, to] = span
    const enAt = lines.slice(from, to).findIndex((l) => /^ {4}en_gb:\s*$/.test(l))
    if (enAt === -1) { unmatched.push({ ...p, why: 'no en_gb block' }); stats.unmatched += 1; continue }
    const stdAt = lines.slice(from, to).findIndex((l) => /^ {6}standard:/.test(l))
    const altAt = lines.slice(from, to).findIndex((l) => /^ {6}alt:\s*$/.test(l))

    // Existing alts, so re-running cannot stack duplicates.
    const existing = new Set()
    if (altAt !== -1) {
      for (let i = from + altAt + 1; i < to; i += 1) {
        if (!/^ {8}- /.test(lines[i])) break
        existing.add(lines[i].replace(/^ {8}- /, '').trim().replace(/^["'](.*)["']$/, '$1'))
      }
    }
    const fresh = p.alt.filter(Boolean).map((a) => String(a).trim()).filter((a) => !existing.has(a))
    if (!fresh.length) { stats.alreadyPresent += 1; continue }

    const rendered = fresh.map((a) => `        - ${yamlScalar(a)}`)
    if (altAt === -1) {
      // Open an alt block right after `standard:`, matching the file's layout.
      const anchor = from + (stdAt === -1 ? enAt : stdAt)
      insertions.set(anchor, [...(insertions.get(anchor) ?? []), '      alt:', ...rendered])
    } else {
      const anchor = from + altAt
      insertions.set(anchor, [...(insertions.get(anchor) ?? []), ...rendered])
    }
    stats.widen += 1
  }

  if (!insertions.size) continue
  const out = []
  lines.forEach((line, i) => {
    out.push(line)
    if (insertions.has(i)) out.push(...insertions.get(i))
  })
  const text = out.join('\n')
  try {
    yaml.load(text)
  } catch (err) {
    console.error(`  ! ${file}: edits produce invalid YAML (${err.message}) — left untouched`)
    writeFailures += 1
    continue
  }
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file}: ${[...insertions.values()].flat().length} line(s)`)
}

console.log(`\nproposals read     ${stats.read}`)
console.log(`  keep             ${stats.keep}`)
console.log(`  widen            ${stats.widen}`)
console.log(`  alt already there ${stats.alreadyPresent}`)
console.log(`  unmatched        ${stats.unmatched}`)
for (const u of unmatched.slice(0, 20)) console.log(`  ! ${u._src}: ${u.why} — ${u.key}`)

const failures = writeFailures + stats.unmatched + parseFailures
if (failures) {
  console.error(`\nFAILED: ${writeFailures} file(s) unwritten, ${stats.unmatched} unmatched, ${parseFailures} unparseable`)
}
if (!APPLY) console.log('\ndry run — pass --apply to write')
else if (stats.widen) console.log('\nnow run: npm test (spellPromptData guards gloss+note collisions)')

if (failures) process.exit(1)
