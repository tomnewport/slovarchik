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
let parseFailures = 0
let writeFailures = 0
for (const file of inputs) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      proposals.push({ ...JSON.parse(trimmed), _src: `${file}:${i + 1}` })
    } catch {
      console.error(`  ! ${file}:${i + 1} is not valid JSON`)
      parseFailures += 1
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
  // A proposal names its target by (word key, ru sentence). Two usage items of
  // one word can carry the *same* Russian with different English — «Ве́тер
  // ва́лит дере́вья.» appears twice under валить — so that pair does not
  // identify a line. Keeping one silently would edit whichever was indexed
  // last, so ambiguous keys are recorded and refused below.
  const index = new Map()
  const ambiguous = new Set()
  for (const item of items) {
    const k = `${item.key}\u0000${matchKey(item.ru)}`
    if (index.has(k)) ambiguous.add(k)
    index.set(k, item)
  }

  // Collect edits first, apply last: line indices must stay valid while we work.
  const replacements = new Map() // lineNo → new text
  const insertions = new Map() // afterLineNo → string[]
  const deletions = new Set()
  // Alts already queued for a usage item during THIS run, and the items for
  // which an `en_alt:` header has been queued. Both are essential: two
  // proposals can target one sentence (packets overlap where a word was
  // re-cut between shardings), and without this each would see no en_alt in
  // the file and open a second block — producing a duplicate mapping key and
  // invalid YAML. Checking the file alone is not enough; #581 caught this.
  const queuedAlts = new Map() // ruLine → Set of alt strings
  const queuedHeader = new Set() // ruLine

  /**
   * Queue an item's `en_alt` additions, skipping any already present in the
   * file or already queued in this run. Returns true if anything was added.
   */
  function queueAlts(p, item, span, enOffset, altOffset) {
    const inFile = new Set(
      span
        .filter((l) => /^ {10}- /.test(l))
        .map((l) => l.replace(/^ {10}- /, '').trim().replace(/^["'](.*)["']$/, '$1')),
    )
    const already = queuedAlts.get(item.ruLine) ?? new Set()
    const alts = (p.en_alt ?? [])
      .filter(Boolean)
      .map((a) => String(a).trim())
      .filter((a) => !inFile.has(a) && !already.has(a))
    if (!alts.length) return false
    for (const a of alts) already.add(a)
    queuedAlts.set(item.ruLine, already)

    const rendered = alts.map((a) => `          - ${yamlScalar(a)}`)
    const needsHeader = altOffset === -1 && !queuedHeader.has(item.ruLine)
    if (needsHeader) queuedHeader.add(item.ruLine)
    // Anchor on the en_alt line when the file already has one, otherwise on
    // en_gb so the item keeps its ru / en_gb / en_alt / inflect order.
    const anchor = item.ruLine + (altOffset !== -1 ? altOffset : enOffset === -1 ? 0 : enOffset)
    insertions.set(anchor, [
      ...(insertions.get(anchor) ?? []),
      ...(needsHeader ? ['        en_alt:'] : []),
      ...rendered,
    ])
    return true
  }

  for (const p of filePoposals) {
    const lookup = `${p.key}\u0000${matchKey(p.ru)}`
    const item = index.get(lookup)
    if (!item) {
      stats.unmatched += 1
      unmatched.push({ ...p, why: 'no usage item with that exact ru' })
      continue
    }
    if (ambiguous.has(lookup)) {
      stats.unmatched += 1
      unmatched.push({ ...p, why: 'this word has two usage items with that exact ru — cannot tell which' })
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
      // A retranslate may also carry en_alt — reviewers routinely keep the
      // wording they replaced as an accepted alternative. Dropping those (as
      // this script did until #581) silently discards the compensating
      // alternate while still making the shown English worse.
      if ((p.en_alt ?? []).filter(Boolean).length) queueAlts(p, item, span, enOffset, altOffset)
    } else if (p.verdict === 'add-alt') {
      if (!(p.en_alt ?? []).filter(Boolean).length) { unmatched.push({ ...p, why: 'add-alt without en_alt' }); stats.unmatched += 1; continue }
      if (queueAlts(p, item, span, enOffset, altOffset)) stats.addAlt += 1
      else stats.altAlreadyPresent += 1
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
      if ((p.en_alt ?? []).filter(Boolean).length) queueAlts(p, item, span, enOffset, altOffset)
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
    writeFailures += 1
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

// Exit non-zero on anything that means the corpus does not reflect the
// proposals: a file skipped for invalid YAML, a proposal that matched nothing,
// or a JSONL line that did not parse. Reporting these and exiting 0 (as this
// script did until #581) lets a partial application pass for a complete one.
const failures = writeFailures + stats.unmatched + parseFailures
if (failures) {
  console.error(`\nFAILED: ${writeFailures} file(s) left unwritten, ${stats.unmatched} unmatched proposal(s), ${parseFailures} unparseable line(s)`)
}

if (!APPLY) console.log('\ndry run — pass --apply to write')
else if (stats.fixRussian) {
  console.log('\nRussian sentences changed. Now run:')
  console.log('  npm run check:inflect')
  console.log('  node scripts/triage-inflect.mjs --verify')
  console.log('  npm run audit:gender')
}

if (failures) process.exit(1)
