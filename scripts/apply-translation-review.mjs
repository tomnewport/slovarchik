#!/usr/bin/env node
/**
 * apply-translation-review.mjs — merge reviewers' translation proposals back
 * into the vocab YAML.
 *
 * The review runs as many parallel passes over disjoint slices of the corpus
 * (see audit-translations.mjs --shard). Having each of those passes edit the
 * YAML directly would mean dozens of writers on six files, two of which are tens
 * of thousands of lines long — unmergeable in practice and unreviewable as a
 * diff. So reviewers emit **proposals** as JSONL and this script is the single
 * writer, applying them in one deterministic pass.
 *
 * Edits are line surgery, not a YAML round-trip: `yaml.dump` would reformat
 * every file and throw away the comments, burying real changes in noise.
 * `parseUsageItems` (from annotate-inflect.mjs) gives the line span of each
 * usage item, and only the lines that actually change are rewritten.
 *
 * Proposal record (one JSON object per line):
 * {
 *   "key":     "автобус=bus",              // the owning word's natural key
 *   "ru":      "Я жду авто́буса…",          // identifies the usage item, verbatim
 *   "verdict": "keep" | "retranslate" | "add-alt" | "fix-russian" | "flag",
 *   "en":      "…",                        // required for retranslate
 *   "en_alt":  ["…"],                      // required for add-alt
 *   "ru_new":  "…",                        // required for fix-russian
 *   "defect":  "over-translation",         // taxonomy, see docs/translation-review.md
 *   "note":    "why",
 *   "confidence": "high" | "medium" | "low"
 * }
 *
 * A `fix-russian` proposal is NOT applied here when the sentence carries an
 * `inflect:` block: the annotation is a 1-based index into the sentence's
 * whitespace tokens, so rewording silently retargets it and the inflection drill
 * starts teaching the wrong case. Those are written to a quarantine file for a
 * follow-up pass that re-annotates them.
 *
 * Usage:
 *   node scripts/apply-translation-review.mjs review/proposals/*.jsonl        # dry run
 *   node scripts/apply-translation-review.mjs review/proposals/*.jsonl --apply
 *
 * Options:
 *   --apply             write the files (default: report what would change)
 *   --min-confidence X  skip proposals below high|medium|low (default: low)
 *   --quarantine PATH   where deferred fix-russian proposals go
 *                       (default: review/quarantine-russian.jsonl)
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
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const inputs = args.filter((a) => !a.startsWith('--') && a.endsWith('.jsonl'))
const RANK = { low: 0, medium: 1, high: 2 }
const minConfidence = RANK[opt('min-confidence', 'low')] ?? 0
const quarantinePath = opt('quarantine', join(__dirname, '..', 'review', 'quarantine-russian.jsonl'))

if (!inputs.length) {
  console.error('no .jsonl proposal files given')
  process.exit(1)
}

/** Render a string as a YAML scalar, quoting only when plain style would break. */
export function yamlScalar(value) {
  const s = String(value)
  const needsQuote =
    /^[\s>|*&!%@`'"[\]{}#,-]/.test(s) ||
    /:\s|\s#/.test(s) ||
    /[:#]$/.test(s) ||
    s !== s.trim()
  return needsQuote ? JSON.stringify(s) : s
}

const proposals = []
for (const file of inputs) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      proposals.push({ ...JSON.parse(trimmed), _src: `${file}:${i + 1}` })
    } catch {
      console.error(`  ! ${file}:${i + 1} is not valid JSON — skipped`)
    }
  })
}

const stats = {
  read: proposals.length, keep: 0, retranslate: 0, addAlt: 0, fixRussian: 0,
  flag: 0, quarantined: 0, lowConfidence: 0, unmatched: 0, altAlreadyPresent: 0,
}
const quarantine = []
const flags = []
const unmatched = []

// key → file, so a proposal can be routed without the reviewer naming the file.
const filesByKey = new Map()
const vocabFiles = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
for (const name of vocabFiles) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) filesByKey.set(key, `${name}.yml`)
}

const byFile = new Map()
for (const p of proposals) {
  if ((RANK[p.confidence] ?? 2) < minConfidence) { stats.lowConfidence += 1; continue }
  if (p.verdict === 'keep') { stats.keep += 1; continue }
  if (p.verdict === 'flag') { stats.flag += 1; flags.push(p); continue }
  const file = filesByKey.get(p.key)
  if (!file) { stats.unmatched += 1; unmatched.push({ ...p, why: 'no such word key' }); continue }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(p)
}

/** Normalise for matching: the reviewer may echo a sentence with odd whitespace. */
const matchKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

for (const [file, filePoposals] of byFile) {
  const path = join(vocabDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const items = parseUsageItems(lines)
  const index = new Map()
  for (const item of items) index.set(`${item.key}\u0000${matchKey(item.ru)}`, item)

  // Collect edits first, apply last: line indices must stay valid while we work.
  const replacements = new Map() // lineNo → new text
  const insertions = new Map() // afterLineNo → string[]
  const deletions = new Set()

  for (const p of filePoposals) {
    const item = index.get(`${p.key}\u0000${matchKey(p.ru)}`)
    if (!item) {
      stats.unmatched += 1
      unmatched.push({ ...p, why: 'no usage item with that exact ru' })
      continue
    }
    const span = lines.slice(item.ruLine, item.lastLine + 1)
    const enOffset = span.findIndex((l) => /^ {8}en_gb:/.test(l))
    const altOffset = span.findIndex((l) => /^ {8}en_alt:/.test(l))
    const hasInflect = item.hasInflect

    if (p.verdict === 'retranslate') {
      if (!p.en) { unmatched.push({ ...p, why: 'retranslate without en' }); stats.unmatched += 1; continue }
      if (enOffset === -1) { unmatched.push({ ...p, why: 'no en_gb line found' }); stats.unmatched += 1; continue }
      replacements.set(item.ruLine + enOffset, `        en_gb: ${yamlScalar(p.en)}`)
      stats.retranslate += 1
    } else if (p.verdict === 'add-alt') {
      // Idempotent: an alt already present is skipped, so re-applying a
      // proposal set (a re-run, or a packet reviewed twice) can't stack
      // duplicates into en_alt. The comparison ignores quoting style, since
      // yamlScalar may or may not have quoted the same string.
      const existingAlts = new Set(
        span
          .filter((l) => /^ {10}- /.test(l))
          .map((l) => l.replace(/^ {10}- /, '').trim().replace(/^["'](.*)["']$/, '$1')),
      )
      const alts = (p.en_alt ?? []).filter(Boolean).filter((a) => !existingAlts.has(String(a).trim()))
      if (!(p.en_alt ?? []).filter(Boolean).length) { unmatched.push({ ...p, why: 'add-alt without en_alt' }); stats.unmatched += 1; continue }
      if (!alts.length) { stats.altAlreadyPresent += 1; continue }
      const rendered = alts.map((a) => `          - ${yamlScalar(a)}`)
      if (altOffset === -1) {
        // No en_alt block yet — open one directly after the en_gb line so the
        // item keeps the ru / en_gb / en_alt / inflect order used everywhere.
        const anchor = item.ruLine + (enOffset === -1 ? 0 : enOffset)
        insertions.set(anchor, [...(insertions.get(anchor) ?? []), '        en_alt:', ...rendered])
      } else {
        const anchor = item.ruLine + altOffset
        insertions.set(anchor, [...(insertions.get(anchor) ?? []), ...rendered])
      }
      stats.addAlt += 1
    } else if (p.verdict === 'fix-russian') {
      if (!p.ru_new) { unmatched.push({ ...p, why: 'fix-russian without ru_new' }); stats.unmatched += 1; continue }
      if (hasInflect) {
        // Deferred on purpose — see the header comment on inflect token indices.
        quarantine.push({ ...p, file, reason: 'carries an inflect annotation; needs re-annotation' })
        stats.quarantined += 1
        continue
      }
      replacements.set(item.ruLine, `      - ru: ${yamlScalar(p.ru_new)}`)
      if (p.en && enOffset !== -1) replacements.set(item.ruLine + enOffset, `        en_gb: ${yamlScalar(p.en)}`)
      stats.fixRussian += 1
    }
  }

  if (!replacements.size && !insertions.size && !deletions.size) continue
  const out = []
  lines.forEach((line, i) => {
    if (deletions.has(i)) return
    out.push(replacements.has(i) ? replacements.get(i) : line)
    if (insertions.has(i)) out.push(...insertions.get(i))
  })
  const text = out.join('\n')
  // Parse before writing: a malformed scalar must fail here, not in CI.
  try {
    yaml.load(text)
  } catch (err) {
    console.error(`  ! ${file}: edits produce invalid YAML (${err.message}) — file left untouched`)
    continue
  }
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file}: ${replacements.size} replaced, ${[...insertions.values()].flat().length} inserted`)
}

if (quarantine.length && APPLY) {
  // Accumulate. The review applies in batches as reviewers finish, so writing
  // this file fresh each run would drop every proposal quarantined by an
  // earlier batch — and since the file is gitignored, silently. Existing
  // entries are re-read and merged, keyed by the sentence they would rewrite.
  const existing = new Map()
  if (existsSync(quarantinePath)) {
    for (const line of readFileSync(quarantinePath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        existing.set(`${row.key}\u0000${row.ru}`, row)
      } catch {
        // A hand-edited line that no longer parses is kept verbatim rather than
        // dropped — this file is a worklist someone may have annotated.
        existing.set(line, line)
      }
    }
  }
  for (const q of quarantine) existing.set(`${q.key}\u0000${q.ru}`, q)
  const rendered = [...existing.values()].map((q) => (typeof q === 'string' ? q : JSON.stringify(q)))
  writeFileSync(quarantinePath, `${rendered.join('\n')}\n`)
  console.log(`  quarantine now holds ${rendered.length} proposal(s)`)
}

console.log(`\nproposals read      ${stats.read}`)
console.log(`  keep              ${stats.keep}`)
console.log(`  retranslate       ${stats.retranslate}`)
console.log(`  add-alt           ${stats.addAlt}`)
console.log(`  fix-russian       ${stats.fixRussian}`)
console.log(`  quarantined       ${stats.quarantined}${quarantine.length ? `  → ${quarantinePath}` : ''}`)
console.log(`  flagged for human ${stats.flag}`)
console.log(`  alt already present ${stats.altAlreadyPresent}`)
console.log(`  below confidence  ${stats.lowConfidence}`)
console.log(`  unmatched         ${stats.unmatched}`)

for (const u of unmatched.slice(0, 20)) console.log(`  ! ${u._src}: ${u.why} — ${u.key} / ${String(u.ru).slice(0, 50)}`)
for (const f of flags.slice(0, 20)) console.log(`  ? ${f.key}: ${f.note ?? ''}`)

if (!APPLY) console.log('\ndry run — pass --apply to write')
else if (stats.fixRussian) {
  console.log('\nRussian sentences changed. Now run:')
  console.log('  npm run check:inflect')
  console.log('  node scripts/triage-inflect.mjs --verify')
  console.log('  npm run audit:gender')
}
