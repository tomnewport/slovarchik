// scripts/coverage-gloss.js — report phrase-bank words that resolve to no gloss.
//
// Usage:
//   node scripts/coverage-gloss.js            # summary + busiest unglossed forms
//   node scripts/coverage-gloss.js --all      # every unglossed form
//   node scripts/coverage-gloss.js --json      # machine-readable, with examples
import { loadFixtureWords } from '../src/test/fixtures.js'
import { shapePhrases } from '../src/lib/vocabBuild.js'
import { unglossedExampleForms } from '../src/lib/glossCoverage.js'

const words = loadFixtureWords()
const phrases = shapePhrases(words)
const enByRu = new Map(phrases.map((p) => [p.ru, p.en]))
const missing = unglossedExampleForms(words)

const args = process.argv.slice(2)
if (args.includes('--json')) {
  const rows = missing.map((m) => ({
    form: m.form,
    sample: m.sample,
    count: m.count,
    example: m.phrases[0],
    exampleEn: enByRu.get(m.phrases[0]) ?? '',
  }))
  console.log(JSON.stringify(rows, null, 2))
} else {
  const limit = args.includes('--all') ? missing.length : 60
  console.log(`phrases: ${phrases.length}`)
  console.log(`distinct unglossed forms: ${missing.length}`)
  console.log('')
  for (const m of missing.slice(0, limit)) {
    const ex = m.phrases[0]
    console.log(`${String(m.count).padStart(4)}  ${m.sample.padEnd(20)} e.g. ${ex} — ${enByRu.get(ex) ?? ''}`)
  }
  if (missing.length > limit) console.log(`\n…and ${missing.length - limit} more (run with --all)`)
}
