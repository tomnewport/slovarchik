// Report the first-person gender distribution of the phrase corpus (issue #525).
//
//   node scripts/gender-audit.mjs          # summary + per-file breakdown
//   node scripts/gender-audit.mjs --list   # also list every masculine phrase
//
// Russian marks the speaker's gender on past-tense verbs and predicate
// adjectives; first-person examples ("I did …") should be evenly split, not
// default to masculine. This prints the current split and the pool the
// rebalance migration can safely flip. Framework-free; reads the vocab YAML the
// same way the unit tests do.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import {
  buildPastIndex,
  isFirstPersonSingular,
  firstPersonGender,
  feminizeFirstPerson,
} from '../src/lib/genderBalance.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/vocab')
const files = readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))
const docs = files
  .map((f) => ({ file: f, pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')] }))
  .filter((r) => r.pos)
  .map((r) => ({ ...r, doc: yaml.load(readFileSync(resolve(vocabDir, r.file), 'utf8')) }))

const words = buildWords(docs.map((r) => ({ pos: r.pos, doc: r.doc })))
const pastIndex = buildPastIndex(words)

// Attribute each phrase to the file its owner word came from.
const fileOfKey = new Map()
for (const r of docs) for (const k of Object.keys(r.doc?.words ?? {})) fileOfKey.set(k, r.file)

const list = process.argv.includes('--list')
const perFile = {}
const totals = { firstPerson: 0, masculine: 0, feminine: 0, mixed: 0, switchable: 0 }
const mascPhrases = []
for (const w of words) {
  if (w.learnable === false) continue
  const file = fileOfKey.get(w.key) ?? '?'
  for (const ex of w.usage ?? []) {
    if (!isFirstPersonSingular(ex?.ru)) continue
    const g = firstPersonGender(ex.ru, pastIndex)
    const bucket = (perFile[file] ??= { m: 0, f: 0, mixed: 0 })
    totals.firstPerson++
    if (g === 'm') { totals.masculine++; bucket.m++; mascPhrases.push({ file, ru: ex.ru, en: ex.en_gb }) }
    else if (g === 'f') { totals.feminine++; bucket.f++ }
    else if (g === 'mixed') { totals.mixed++; bucket.mixed++ }
    if (feminizeFirstPerson(ex.ru, pastIndex)) totals.switchable++
  }
}

const pct = (n) => ((100 * n) / Math.max(1, totals.masculine + totals.feminine)).toFixed(1)
console.log('First-person (я …) phrases:', totals.firstPerson)
console.log(`  masculine: ${totals.masculine} (${pct(totals.masculine)}%)`)
console.log(`  feminine:  ${totals.feminine} (${pct(totals.feminine)}%)`)
console.log(`  mixed:     ${totals.mixed}`)
console.log(`  safely switchable masculine → feminine: ${totals.switchable}`)
console.log('\nPer file (masculine / feminine):')
for (const [file, b] of Object.entries(perFile).sort((a, c) => c[1].m - a[1].m)) {
  console.log(`  ${file.padEnd(18)} m=${b.m}  f=${b.f}${b.mixed ? `  mixed=${b.mixed}` : ''}`)
}
if (list) {
  console.log('\nMasculine first-person phrases:')
  for (const p of mascPhrases) console.log(`  [${p.file}] ${p.ru}  ||  ${p.en}`)
}
