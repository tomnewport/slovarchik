#!/usr/bin/env node
/**
 * apply-quarantined-russian.mjs — land the Russian rewrites the translation
 * review deferred, fixing their `inflect:` annotations as it goes.
 *
 * `apply-translation-review.mjs` refuses to reword a Russian sentence that
 * carries an `inflect:` block, because `token:` is a 1-based index into the
 * sentence's whitespace tokens: insert a word and the annotation silently
 * points at its neighbour, and `phrasesData.test.js` cannot catch it because
 * the interesting forms are syncretic. Those proposals go to a quarantine file
 * instead. This script drains it.
 *
 * The safe cases are the ones where the annotation's *target word* survives the
 * edit — it may have moved, or gained a stress mark, but it is still the same
 * word in the same grammatical slot. Then the repair is purely arithmetic:
 * re-find the word and rewrite `token:`. That covers most of the queue,
 * including every stress correction and every «бы» insertion.
 *
 * The rest genuinely change what the annotated token *is* — «на свои́х о́пытах»
 * → «на своём о́пыте» moves plural to singular, so `number:` is wrong too — and
 * no arithmetic can decide those. For those, a human writes the replacement
 * annotation into `review/quarantine-resolutions.jsonl`, matched on (key, ru):
 *
 *   {"key":"опыт=experience","ru":"<the original sentence>",
 *    "inflect":"token: 5, case: pre, number: sg, rule: noun-pre-sg",
 *    "why":"<why this is the right slot>"}
 *
 * The resolution replaces the whole `inflect:` object, so it can change the
 * rule as well as the index — «я бы бро́силась» → «я бро́шусь» is a conditional
 * becoming a future, not a token that moved. Keeping the decision in a file
 * rather than hand-editing the YAML is what lets `verify:review` replay the
 * whole review from its proposals and land on the committed corpus.
 *
 * Usage:
 *   node scripts/apply-quarantined-russian.mjs            # report only
 *   node scripts/apply-quarantined-russian.mjs --apply
 *
 * Always follow an --apply with:
 *   npm run check:inflect && node scripts/triage-inflect.mjs --verify && npm test
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as yaml from 'js-yaml'
import { parseUsageItems, norm, core, tokenize } from './annotate-inflect.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vocabDir = join(__dirname, '..', 'public', 'vocab')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const quarantinePath = join(__dirname, '..', 'review', 'quarantine-russian.jsonl')

if (!existsSync(quarantinePath)) {
  console.log('nothing quarantined')
  process.exit(0)
}
const rows = readFileSync(quarantinePath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

// Hand-decided annotations for the rewrites arithmetic cannot repair.
const resolutionsPath = join(__dirname, '..', 'review', 'quarantine-resolutions.jsonl')
const resolutions = new Map()
if (existsSync(resolutionsPath)) {
  for (const line of readFileSync(resolutionsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    resolutions.set(`${r.key}\u0000${String(r.ru).trim()}`, r)
  }
}
const resolutionsUsed = new Set()

// A drained quarantine is the finished state, not a failure: the resolutions
// stay as the record of how it was drained, and `verify:review` exercises them
// by regenerating the queue from the proposals before running this stage.
if (!rows.length) {
  console.log('nothing quarantined')
  process.exit(0)
}

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const fileByKey = new Map()
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const key of Object.keys(doc?.words ?? {})) fileByKey.set(key, `${name}.yml`)
}

/**
 * Where the annotated word ends up in the rewritten sentence.
 *
 * Compared stress-blind (`norm`), so a pure stress correction — парни́ → па́рни,
 * which is the single commonest fix in the queue — still counts as the same
 * word. Returns the new 1-based index, or null when the word is gone or has
 * become ambiguous (two candidates: nothing can choose between them).
 */
function relocate(oldTokens, newTokens, index, span) {
  const wanted = oldTokens.slice(index - 1, index - 1 + span).map((t) => norm(core(t)))
  if (!wanted.length || wanted.some((w) => !w)) return null
  const hits = []
  for (let i = 0; i + span <= newTokens.length; i += 1) {
    const got = newTokens.slice(i, i + span).map((t) => norm(core(t)))
    if (got.every((g, j) => g === wanted[j])) hits.push(i + 1)
  }
  return hits.length === 1 ? hits[0] : null
}

const applied = []
const blocked = []
const byFile = new Map()
for (const row of rows) {
  const file = fileByKey.get(row.key)
  if (!file) { blocked.push([row, 'no such word key']); continue }
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(row)
}

for (const [file, items] of byFile) {
  const path = join(vocabDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const usage = parseUsageItems(lines)
  const index = new Map()
  for (const it of usage) index.set(`${it.key}\u0000${String(it.ru).trim()}`, it)

  const edits = new Map() // lineNo → text
  for (const row of items) {
    const item = index.get(`${row.key}\u0000${String(row.ru).trim()}`)
    if (!item) { blocked.push([row, 'usage item not found (already applied?)']); continue }

    const span = lines.slice(item.ruLine, item.lastLine + 1)
    const inflectAt = span.findIndex((l) => /^ {8}inflect:/.test(l))
    const oldTokens = tokenize(row.ru)
    const newTokens = tokenize(row.ru_new)

    if (inflectAt === -1) {
      edits.set(item.ruLine, `      - ru: ${row.ru_new}`)
      applied.push([row, 'no inflect annotation to repair'])
      continue
    }

    const line = span[inflectAt]
    const tokenMatch = line.match(/token:\s*(\d+)/)
    const spanMatch = line.match(/span:\s*(\d+)/)
    if (!tokenMatch) { blocked.push([row, 'inflect line has no token:']); continue }
    const oldIndex = Number(tokenMatch[1])
    const tokenSpan = spanMatch ? Number(spanMatch[1]) : 1

    // Decide the whole row *before* queuing any of its edits. Queuing the
    // Russian first and validating the annotation afterwards writes a rewritten
    // sentence with a stale `inflect:` when the annotation turns out to be
    // unusable — and worse, the row stays in the quarantine while the old
    // Russian it is keyed on no longer exists, so no later run can match it.
    const resolved = resolutions.get(`${row.key}\u0000${String(row.ru).trim()}`)
    let inflectLine = null
    let why
    if (resolved) {
      // A hand resolution replaces the annotation outright: the token may have
      // moved *and* changed grammatical slot, so nothing of the old one stands.
      const wanted = Number(String(resolved.inflect).match(/token:\s*(\d+)/)?.[1])
      if (!wanted || wanted > newTokens.length) {
        blocked.push([row, `resolution names token ${wanted || '(none)'}, but the rewrite has ${newTokens.length} token(s)`])
        continue
      }
      inflectLine = `        inflect: { ${String(resolved.inflect).trim()} }`
      why = `resolved by hand → ${resolved.inflect} (was token ${oldIndex})`
    } else {
      const newIndex = relocate(oldTokens, newTokens, oldIndex, tokenSpan)
      if (newIndex === null) {
        const was = oldTokens.slice(oldIndex - 1, oldIndex - 1 + tokenSpan).join(' ')
        blocked.push([row, `annotated token «${was}» does not survive the edit — its slot needs deciding by hand`])
        continue
      }
      if (newIndex !== oldIndex) inflectLine = line.replace(/token:\s*\d+/, `token: ${newIndex}`)
      why = newIndex === oldIndex ? `token ${oldIndex} unchanged` : `token ${oldIndex} → ${newIndex}`
    }

    // Committed: every edit for this row is queued together or not at all.
    edits.set(item.ruLine, `      - ru: ${row.ru_new}`)
    if (row.en) {
      const enAt = span.findIndex((l) => /^ {8}en_gb:/.test(l))
      if (enAt !== -1) edits.set(item.ruLine + enAt, `        en_gb: ${row.en}`)
    }
    if (inflectLine !== null) edits.set(item.ruLine + inflectAt, inflectLine)
    if (resolved) resolutionsUsed.add(`${row.key}\u0000${String(row.ru).trim()}`)
    applied.push([row, why])
  }

  if (!edits.size) continue
  const out = lines.map((l, i) => (edits.has(i) ? edits.get(i) : l))
  const text = out.join('\n')
  try {
    yaml.load(text)
  } catch (err) {
    console.error(`  ! ${file}: edits produce invalid YAML (${err.message}) — left untouched`)
    process.exit(1)
  }
  if (APPLY) writeFileSync(path, text)
  console.log(`  ${APPLY ? 'wrote' : 'would write'} ${file}: ${edits.size} line(s)`)
}

console.log(`\napplied  ${applied.length}`)
for (const [row, why] of applied) console.log(`  ✓ ${row.key}: ${why}`)
console.log(`\nblocked  ${blocked.length}`)
for (const [row, why] of blocked) {
  console.log(`  • ${row.key}: ${why}`)
  console.log(`      ${row.ru}`)
  console.log(`   →  ${row.ru_new}`)
}

// A resolution that matched nothing is a decision about a sentence that is not
// in the quarantine — a typo in its key or Russian, or a leftover from a row
// that has since changed. Either way the annotation it specifies is not being
// applied, so this must fail rather than print: the whole reason resolutions
// live in a file is that a decision made outside the pipeline is invisible.
const stale = [...resolutions.keys()].filter((k) => !resolutionsUsed.has(k))
if (stale.length) {
  console.error(`\nunused resolutions  ${stale.length} — each names a (key, ru) the quarantine does not contain`)
  for (const k of stale) console.error(`  ? ${k.split('\u0000').join('  |  ')}`)
  process.exit(1)
}

if (APPLY && applied.length) {
  const keep = rows.filter((r) => !applied.some(([a]) => a.key === r.key && a.ru === r.ru))
  writeFileSync(quarantinePath, keep.length ? `${keep.map((r) => JSON.stringify(r)).join('\n')}\n` : '')
  console.log(`\nquarantine now holds ${keep.length}`)
  console.log('now run: npm run check:inflect && node scripts/triage-inflect.mjs --verify && npm test')
}
