#!/usr/bin/env node
/**
 * apply-prompt-fixes.mjs — the prompt-disambiguation pass (#601), as replayable
 * proposals rather than hand edits.
 *
 * English→Russian is only a fair question when the English picks out one Russian
 * sentence (see promptDisambiguation.js). Making the last 33 collisions
 * answerable took two kinds of edit that no existing review stage could express:
 *
 *   note      rewrite a headword's `en_gb.standard` **parenthetical**, where the
 *             two rivals were glossed as paraphrases of each other — вско́ре
 *             "a short time later" against ско́ро "in a short time" tells a
 *             learner nothing. The gloss itself (the text before the bracket) is
 *             never touched: it is the graded answer, and this pass is not a
 *             re-translation. `apply-gloss-review.mjs` only appends to `alt:`,
 *             so it cannot do this.
 *   sentence  rewrite a usage item's `ru`, `en_gb` and/or `en_alt` where the two
 *             sentences were near-duplicates, or where English could carry the
 *             distinction itself (ждать + genitive is "a bus", accusative "the
 *             bus").
 *
 * Both land in fields `verify-review-replay.mjs` compares, so they have to be
 * replayable or the audit trail stops reproducing the corpus. This is that
 * stage; it runs last, after the translation review's own six.
 *
 * Proposal record (one JSON object per line of review/prompt-fixes.jsonl):
 * {
 *   "key":      "вскоре=soon",        // the owning word's natural key
 *   "verdict":  "note" | "sentence",
 *   "standard": "soon (bookish, …)",  // required for note: the whole gloss line
 *   "ru":       "Куда́ ты е́дешь?",     // required for sentence: identifies the item
 *   "ru_new":   "…",                  // optional: rewrite the Russian
 *   "en":       "…",                  // optional: rewrite the English prompt
 *   "en_alt":   ["…"],                // optional: replace the accepted alternates
 *   "note":     "why",
 *   "confidence": "high" | "medium" | "low"
 * }
 *
 * A `ru_new` on a sentence carrying an `inflect:` block is refused unless the
 * annotated token survives the rewrite unchanged: the annotation is a 1-based
 * index into the whitespace tokens, so a reworded sentence can silently retarget
 * it and the inflection drill starts teaching the wrong cell. That is the same
 * hazard apply-translation-review.mjs quarantines for; here the rewrites are few
 * enough to check outright rather than defer.
 *
 * Usage:
 *   node scripts/apply-prompt-fixes.mjs              # dry run
 *   node scripts/apply-prompt-fixes.mjs --apply
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

/**
 * Quote a scalar only where YAML needs it — the same rule apply-translation-review
 * uses. Inlined rather than imported: that module runs its whole pass on import.
 */
function yamlScalar(value) {
  const s = String(value)
  const needsQuote =
    /^[\s>|*&!%@`'"[\]{}#,-]/.test(s) || /:\s|\s#/.test(s) || /[:#]$/.test(s) || s !== s.trim()
  return needsQuote ? JSON.stringify(s) : s
}

const source = join(repo, 'review', 'prompt-fixes.jsonl')
if (!existsSync(source)) {
  console.log('no review/prompt-fixes.jsonl — nothing to apply')
  process.exit(0)
}

const proposals = []
let parseFailures = 0
readFileSync(source, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    if (!line.trim()) return
    try {
      proposals.push({ ...JSON.parse(line), _src: `review/prompt-fixes.jsonl:${i + 1}` })
    } catch {
      console.error(`  ! review/prompt-fixes.jsonl:${i + 1} is not valid JSON`)
      parseFailures += 1
    }
  })

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const fileByKey = new Map()
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) fileByKey.set(key, `${name}.yml`)
}

const stats = { read: proposals.length, note: 0, sentence: 0, unchanged: 0, unmatched: 0 }
const unmatched = []
const byFile = new Map()
for (const p of proposals) {
  if (p.verdict !== 'note' && p.verdict !== 'sentence') {
    unmatched.push({ ...p, why: `unknown verdict ${p.verdict}` })
    continue
  }
  const file = fileByKey.get(p.key)
  if (!file) {
    unmatched.push({ ...p, why: 'no such word key' })
    continue
  }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(p)
}

/** Whitespace tokens of a sentence, as the `inflect:` token index counts them. */
const tokensOf = (ru) => String(ru).trim().split(/\s+/).filter(Boolean)

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

  const usage = parseUsageItems(lines)
  const replacements = new Map() // line index → new text
  const deletions = new Set()
  const insertions = new Map() // afterLine → string[]

  for (const p of items) {
    if (p.verdict === 'note') {
      const span = spanOf.get(p.key)
      if (!span) { unmatched.push({ ...p, why: 'word entry not found in file' }); continue }
      const [from, to] = span
      const at = lines.slice(from, to).findIndex((l) => /^ {6}standard:/.test(l))
      if (at === -1) { unmatched.push({ ...p, why: 'no standard: gloss' }); continue }
      const line = `      standard: ${yamlScalar(p.standard)}`
      if (lines[from + at] === line) { stats.unchanged += 1; continue }
      replacements.set(from + at, line)
      stats.note += 1
      continue
    }

    const item = usage.find((u) => u.key === p.key && u.ru === p.ru)
    if (!item) { unmatched.push({ ...p, why: 'no usage item with that ru' }); continue }
    const span = lines.slice(item.ruLine, item.lastLine + 1)

    if (p.ru_new) {
      const inflectAt = span.findIndex((l) => /^ {8}inflect:/.test(l))
      if (inflectAt !== -1) {
        const token = Number(span[inflectAt].match(/\btoken:\s*(\d+)/)?.[1])
        const before = tokensOf(p.ru)[token - 1]
        const after = tokensOf(p.ru_new)[token - 1]
        if (!token || !before || before !== after) {
          unmatched.push({ ...p, why: `rewrite moves the annotated token ${token}: «${before}» → «${after}»` })
          continue
        }
      }
      replacements.set(item.ruLine, `      - ru: ${yamlScalar(p.ru_new)}`)
    }
    if (p.en) {
      const at = span.findIndex((l) => /^ {8}en_gb:/.test(l))
      if (at === -1) { unmatched.push({ ...p, why: 'no en_gb on that usage item' }); continue }
      replacements.set(item.ruLine + at, `        en_gb: ${yamlScalar(p.en)}`)
    }
    if (p.en_alt) {
      const at = span.findIndex((l) => /^ {8}en_alt:/.test(l))
      if (at === -1) { unmatched.push({ ...p, why: 'no en_alt on that usage item' }); continue }
      // Replace the whole list: an alternate this pass promoted to `en_gb` has
      // to leave the list, which appending cannot do.
      for (let i = item.ruLine + at + 1; i <= item.lastLine; i += 1) {
        if (!/^ {10}- /.test(lines[i])) break
        deletions.add(i)
      }
      insertions.set(item.ruLine + at, p.en_alt.map((a) => `          - ${yamlScalar(a)}`))
    }
    stats.sentence += 1
  }

  if (!replacements.size && !insertions.size && !deletions.size) continue
  const out = []
  lines.forEach((line, i) => {
    if (!deletions.has(i)) out.push(replacements.get(i) ?? line)
    if (insertions.has(i)) out.push(...insertions.get(i))
  })
  const text = out.join('\n')
  try {
    yaml.load(text)
  } catch (err) {
    console.error(`  ! ${file} would not parse after the edit: ${err.message}`)
    writeFailures += 1
    continue
  }
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file}`)
}

for (const u of unmatched) console.error(`  ✗ ${u._src}: ${u.key} — ${u.why}`)
console.log(
  `\nread=${stats.read} note=${stats.note} sentence=${stats.sentence} ` +
    `alreadyApplied=${stats.unchanged} unmatched=${unmatched.length}`,
)
if (parseFailures || writeFailures || unmatched.length) process.exit(1)
