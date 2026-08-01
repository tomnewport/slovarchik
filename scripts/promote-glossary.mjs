// scripts/promote-glossary.mjs — glossary → curriculum promotion helper (#326).
//
// The glossary (`public/vocab/glossary.yml`) holds ~2,300 gloss-only entries
// that only feed tap-hints. The busiest of them are already candidate
// curriculum content. This script is the *analysis + scaffolding* half of a
// promotion pipeline; the authoring itself stays by hand, on purpose (see the
// module header in src/lib/glossaryPromotion.js and docs/glossary-promotion.md).
//
// It never edits the vocab files. `--report` prints a ranked shortlist to
// stdout; `--scaffold` prints one skeleton entry to stdout for you to complete
// and paste in yourself.
//
// Usage:
//   node scripts/promote-glossary.mjs                     # ranked report (top 40)
//   node scripts/promote-glossary.mjs --limit 100         # longer report
//   node scripts/promote-glossary.mjs --json              # machine-readable report
//   node scripts/promote-glossary.mjs --scaffold "азии=Asia"          # stub, POS guessed
//   node scripts/promote-glossary.mjs --scaffold "азии=Asia" --pos noun --lemma азия
import { loadFixtureWords } from '../src/test/fixtures.js'
import { shapePhrases } from '../src/lib/vocabBuild.js'
import {
  promotionCandidates,
  scaffoldEntry,
  guessPos,
} from '../src/lib/glossaryPromotion.js'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name) => process.argv.includes(name)

const words = loadFixtureWords()

if (has('--scaffold')) {
  const key = arg('--scaffold')
  if (!key) {
    console.error('--scaffold needs a glossary key, e.g. --scaffold "азии=Asia"')
    process.exit(1)
  }
  const word = words.find((w) => w.pos === 'glossary' && w.key === key)
  if (!word) {
    console.error(`No glossary entry with key "${key}".`)
    console.error('Run the report (no args) to see keys, or check public/vocab/glossary.yml.')
    process.exit(1)
  }
  const pos = arg('--pos')
  const lemma = arg('--lemma')
  process.stdout.write(scaffoldEntry(word, { pos, lemma }))
  process.exit(0)
}

// Default: the ranked report.
const rows = promotionCandidates(words)
const limit = Number(arg('--limit') ?? 40)

if (has('--json')) {
  console.log(JSON.stringify(rows.slice(0, limit), null, 2))
  process.exit(0)
}

const phraseCount = shapePhrases(words).length
console.log(`Glossary promotion candidates — ranked by tap-hint frequency across`)
console.log(`${phraseCount} phrases. Busiest first: promoting these grows the drillable`)
console.log(`curriculum most per word authored. "hits" = phrase tokens this entry glosses.\n`)
console.log(`glossary entries that hint ≥1 phrase token: ${rows.length}\n`)
console.log(`hits  cefr  guess(conf)        key                         note`)
console.log(`────  ────  ─────────────────  ──────────────────────────  ─────────────────`)
for (const r of rows.slice(0, limit)) {
  const g = r.guess || guessPos(r.ru)
  const guessCol = `${g.pos}(${g.confidence === 'likely' ? 'y' : '?'})`.padEnd(17)
  const note = r.collision ? `⚠ dup? learnable "${r.collision}"` : ''
  console.log(
    `${String(r.count).padStart(4)}  ${(r.cefr || '··').padEnd(4)}  ${guessCol}  ${r.key.padEnd(26)}  ${note}`,
  )
}
if (rows.length > limit) console.log(`\n…and ${rows.length - limit} more (raise --limit).`)
console.log(`\nNext: node scripts/promote-glossary.mjs --scaffold "<key>"  — see docs/glossary-promotion.md`)
