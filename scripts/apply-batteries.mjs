// Apply phrase-battery assignments to the vocab YAML files.
//
// Reads scripts/battery-assignments.json — a map of
//   { "<file>.yml": { "<word-key>": ["batteryId", ...], ... }, ... }
// — and writes a `batteries: [a, b, c]` line into each named word's block in
// public/vocab/<file>.yml. Idempotent: re-running replaces an existing
// `batteries:` line rather than duplicating it. Word blocks and all other
// fields are preserved byte-for-byte (line-based edit, no YAML re-serialisation,
// so stress marks and comments are untouched).
//
// Battery ids are validated against public/vocab/phrase-batteries.yml for the
// file's part of speech; unknown ids abort with an error.
//
//   node scripts/apply-batteries.mjs            # apply
//   node scripts/apply-batteries.mjs --check     # validate only, no writes
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB = path.join(ROOT, 'public', 'vocab')
const ASSIGN = path.join(ROOT, 'scripts', 'battery-assignments.json')
const check = process.argv.includes('--check')

const FILE_POS = {
  'nouns.yml': 'nouns',
  'calendar.yml': 'nouns',
  'adjectives.yml': 'adjectives',
  'verbs.yml': 'verbs',
  'pronouns.yml': 'pronouns',
}

const batteries = yaml.load(fs.readFileSync(path.join(VOCAB, 'phrase-batteries.yml'), 'utf8'))
const validIds = (posKey) => new Set((batteries[posKey]?.batteries ?? []).map((b) => b.id))

const assignments = JSON.parse(fs.readFileSync(ASSIGN, 'utf8'))

let totalMissing = 0
let totalEdited = 0

for (const [file, map] of Object.entries(assignments)) {
  const posKey = FILE_POS[file]
  if (!posKey) throw new Error(`No POS mapping for ${file}`)
  const ids = validIds(posKey)
  // Validate every assigned id exists.
  for (const [key, list] of Object.entries(map)) {
    for (const id of list) {
      if (!ids.has(id)) throw new Error(`Unknown battery "${id}" for ${key} in ${file}`)
    }
  }

  const fp = path.join(VOCAB, file)
  const lines = fs.readFileSync(fp, 'utf8').split('\n')
  const keyRe = /^ {2}"(.+?)":\s*$/
  const out = []
  let edited = 0
  let missingInFile = new Set(Object.keys(map))

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    const m = line.match(keyRe)
    if (!m || !(m[1] in map)) continue

    missingInFile.delete(m[1])
    // Insert `batteries:` as the first field, right after the key. For
    // idempotency, skip a `batteries:` line left by a previous run (it would
    // be sitting immediately after the key, where we always place it).
    if (/^ {4}batteries:/.test(lines[i + 1] ?? '')) i++
    out.push(`    batteries: [${map[m[1]].join(', ')}]`)
    edited++
  }

  if (missingInFile.size) {
    totalMissing += missingInFile.size
    console.warn(`! ${file}: ${missingInFile.size} assigned keys not found, e.g. ${[...missingInFile].slice(0, 3).join(' | ')}`)
  }
  totalEdited += edited
  if (!check) fs.writeFileSync(fp, out.join('\n'))
  console.log(`${check ? 'check' : 'apply'} ${file}: ${edited} words tagged`)
}

console.log(`\nDone. ${totalEdited} words tagged, ${totalMissing} assigned keys unmatched.`)
if (check) console.log('(--check: no files written)')
