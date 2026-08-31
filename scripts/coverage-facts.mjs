// scripts/coverage-facts.mjs — where word facts are missing, and where writing
// one would pay off most (#590).
//
// Report-only, run on demand. Deliberately **not** a CI gate: facts are
// optional by design, and a threshold would turn an enrichment into an
// obligation on every new word. The one part that *is* enforced is the
// correctness of what has been authored — `wordFacts.factIssues`, asserted in
// vocabBuild.test.js — and this script leads with it, because those are CI
// failures waiting to happen rather than optional work.
//
// Usage:
//   node scripts/coverage-facts.mjs             # coverage + the top of each list
//   node scripts/coverage-facts.mjs --all       # every candidate
//   node scripts/coverage-facts.mjs --skip=25   # resume the sound-alike list
//   node scripts/coverage-facts.mjs --level=A1  # one level's worth of work
//   node scripts/coverage-facts.mjs --json      # machine-readable
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { loadFixtureWords } from '../src/test/fixtures.js'
import { factIssues } from '../src/lib/wordFacts.js'
import {
  factCoverage,
  breakdownCandidates,
  derivationCandidates,
  confusableCandidates,
  diminutiveCandidates,
  staleReviewed,
} from '../src/lib/factCoverage.js'

// Pairs looked at and set aside, so a shortlist can be worked *down* (#613).
// One judgement per line, JSONL, one ledger per list — a pair rejected as a
// sound-alike may still be a real diminutive, so the two verdicts stay apart.
function loadReviewed(name) {
  try {
    return readFileSync(fileURLToPath(new URL(`../review/${name}`, import.meta.url)), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const words = loadFixtureWords()
const args = process.argv.slice(2)
const all = args.includes('--all')
const LIMIT = all ? Infinity : 25
// --skip=N picks up where the last session stopped, without a ledger entry per
// rejection: the ledger records judgements, this records position.
const SKIP = Number(args.find((a) => a.startsWith('--skip='))?.slice(7) ?? 0) || 0
// --level=A1 (or --level=A1,A2) narrows the three worklists to one level's
// worth of authoring (#627). The coverage table always shows every level: the
// point of narrowing the work is to watch the rest of the table hold still.
const LEVELS = (args.find((a) => a.startsWith('--level='))?.slice(8) ?? '')
  .split(',')
  .map((l) => l.trim().toUpperCase())
  .filter(Boolean)
const at = LEVELS.length ? ` at ${LEVELS.join(', ')}` : ''

const coverage = factCoverage(words)
const issues = factIssues(words)
const breakdown = breakdownCandidates(words, { levels: LEVELS })
const derivation = derivationCandidates(words, { levels: LEVELS })
const reviewed = loadReviewed('confusables-reviewed.jsonl')
const stale = staleReviewed(words, reviewed)
const confusable = confusableCandidates(words, { reviewed, levels: LEVELS })
const dimReviewed = loadReviewed('diminutives-reviewed.jsonl')
const dimStale = staleReviewed(words, dimReviewed)
const diminutive = diminutiveCandidates(words, { reviewed: dimReviewed, levels: LEVELS })

if (args.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        levels: LEVELS,
        coverage,
        issues,
        breakdown,
        derivation,
        confusable,
        reviewed,
        stale,
        diminutive,
        dimReviewed,
        dimStale,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')
const pad = (s, n) => String(s).padEnd(n)

console.log('\n=== Fact coverage ===\n')
const { total } = coverage
console.log(
  `${total.withFacts} of ${total.words} learnable words carry facts (${pct(total.withFacts, total.words)}) — ` +
    `${total.facts} facts, ${total.confusables} confusable links.`,
)
// The number the authoring is actually for: a word with neither an authored
// fact nor a derived relation shows the learner a blank panel (#627).
console.log(
  `${total.empty} show nothing at all — no fact, no derived relation ` +
    `(${pct(total.empty, total.words)}).\n`,
)

// `derived` is not a gap: an aspect pair fills the panel with nothing authored.
const table = (rows, label, width) => {
  console.log(
    `${pad(label, width)}${pad('words', 8)}${pad('facts', 8)}${pad('derived', 9)}${pad('empty', 8)}empty share`,
  )
  for (const row of rows) {
    console.log(
      `${pad(row[label] ?? '?', width)}${pad(row.words, 8)}${pad(row.withFacts, 8)}` +
        `${pad(row.derived, 9)}${pad(row.empty, 8)}${pct(row.empty, row.words)}`,
    )
  }
}
table(coverage.byCefr, 'cefr', 8)
console.log()
table(coverage.byPos, 'pos', 16)

// ── Compulsory first: these fail the corpus guard, not merely "could be nicer".
if (issues.length) {
  console.log(`\n=== Problems with facts already authored (${issues.length}) — these fail CI ===\n`)
  for (const i of issues.slice(0, LIMIT)) console.log(`  ${i.key}  ${i.field}: ${i.message}`)
  if (issues.length > LIMIT) console.log(`  … and ${issues.length - LIMIT} more (--all)`)
} else {
  console.log('\nNo problems with the facts already authored.')
}

// ── Breakdowns, richest root family first: one fact repaid across a dozen words.
console.log(
  `\n=== Worth a breakdown (${breakdown.length}${at}) — prefixed words whose stem is itself a word ===\n`,
)
let lastRoot = null
let shown = 0
for (const c of breakdown) {
  if (shown >= LIMIT) break
  if (c.root.key !== lastRoot) {
    lastRoot = c.root.key
    console.log(`  ${c.root.ru} — ${c.family} word${c.family === 1 ? '' : 's'} in the family`)
    shown++
  }
  console.log(`      ${pad(c.ru, 18)}${pad(c.cefr ?? '?', 4)}${c.prefix}- + ${c.root.ru}`)
  shown++
}
if (breakdown.length > shown) console.log(`  … ${breakdown.length - shown} more candidates (--all)`)

const sourced = derivation.filter((c) => c.from).length
console.log(`\n=== Worth a root fact (${derivation.length}${at}) — productive suffixes ===\n`)
console.log(
  `  ${sourced} of ${derivation.length} have a source that reconstructs; the rest say so ` +
    `rather than naming the nearest string (#614).\n`,
)
for (const c of derivation.slice(0, LIMIT)) {
  const from = c.from ? `from ${c.from.ru}${c.from.via === 'mutation' ? ' (mutation)' : ''}` : ''
  console.log(`  ${pad(c.ru, 18)}${pad(c.cefr ?? '?', 4)}-${pad(c.suffix, 7)}${from}`)
}
if (derivation.length > LIMIT) console.log(`  … and ${derivation.length - LIMIT} more (--all)`)

// ── Sound-alikes: the shortlist for confusable_with, closest first.
console.log(
  `\n=== Sound-alike shortlist (${confusable.length}${at}) — candidates for confusable_with ===\n`,
)
if (reviewed.length) {
  console.log(`  ${reviewed.length} pair(s) previously set aside in review/confusables-reviewed.jsonl.`)
}
if (stale.length) {
  console.log(`  ${stale.length} ledger entr(ies) name a word the corpus no longer has:`)
  for (const r of stale) console.log(`      ${r.missing.join(', ')}`)
}
if (SKIP) console.log(`  starting at ${SKIP + 1} (--skip=${SKIP}).`)
if (at) console.log(`  a pair is listed when either word is${at}.`)
if (reviewed.length || stale.length || SKIP || at) console.log()
for (const p of confusable.slice(SKIP, SKIP + LIMIT)) {
  console.log(`  ${pad(p.a.ru, 16)}${pad(p.b.ru, 16)}${pad(p.ratio, 8)}${p.a.en} | ${p.b.en}`)
}
const left = confusable.length - SKIP - LIMIT
if (left > 0) console.log(`  … and ${left} more (--all, or --skip=${SKIP + LIMIT})`)
// ── Diminutives: nouns shaped like one whose base is itself an entry (#633).
console.log(
  `\n=== Diminutive shortlist (${diminutive.length}${at}) — a root fact and a see: link both ways ===\n`,
)
if (dimReviewed.length) {
  console.log(`  ${dimReviewed.length} pair(s) previously set aside in review/diminutives-reviewed.jsonl.`)
}
if (dimStale.length) {
  console.log(`  ${dimStale.length} ledger entr(ies) name a word the corpus no longer has:`)
  for (const r of dimStale) console.log(`      ${r.missing.join(', ')}`)
}
if (at) console.log(`  a pair is listed when either word is${at}.`)
if (dimReviewed.length || dimStale.length || at) console.log()
for (const c of diminutive.slice(0, LIMIT)) {
  // The kind is the first thing a reviewer needs: a female counterpart and a
  // word whose animacy shifted are real relations, but not this fact.
  const via = c.via === 'velar' ? ' (velar)' : ''
  console.log(
    `  ${pad(c.kind, 11)}${pad(`${c.ru} \u2190 ${c.base.ru}`, 26)}${pad(c.cefr ?? '?', 4)}` +
      `-${pad(c.suffix + via, 13)}${c.en} \u2190 ${c.base.en}`,
  )
}
if (diminutive.length > LIMIT) console.log(`  … and ${diminutive.length - LIMIT} more (--all)`)

console.log('\nReview by hand before authoring: a shortlist is a suggestion, not a verdict.')
console.log('Rejected one? Add it to the matching review/*-reviewed.jsonl with a reason.\n')
