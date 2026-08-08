// Generate full case × gender/number declension tables for every adjective in
// public/vocab/adjectives.yml and splice a `declension:` block into each entry.
//
// Russian qualitative/relative adjectives decline regularly. Given the
// dictionary form we derive the stem, the stress class (stem-fixed vs
// ending-fixed) and the spelling class (hard / velar / sibilant / soft); the
// 24 forms then follow by rule. The script REFUSES to write unless:
//   1. six hand-verified golden paradigms match exactly,
//   2. every derived nominative (m/f/n/pl) matches the existing curated form
//      for all ~108 adjectives — the strongest guard against misclassification,
//   3. the spliced file still parses and every entry gains 24 declension keys.
//
// Run: node scripts/gen-adjective-declension.mjs   (idempotent)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import {
  ADJ_CASES,
  ADJ_COLS,
  declineAdjective,
  goldenAdjectiveMismatches,
} from '../src/lib/adjectiveDeclension.js'

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/vocab/adjectives.yml',
)

const CASES = ADJ_CASES
const COLS = ADJ_COLS
const strip = (s) => s.normalize('NFC').replaceAll('\u0301', '')

// The ending tables and the golden paradigms moved to src/lib/adjectiveDeclension.js
// when participles started deriving their agreement grid at runtime (#564); this
// script keeps the file I/O, the whole-file nominative check and the refusal.
function check() {
  return goldenAdjectiveMismatches().map(
    (m) => `golden ${m.lemma}.${m.slot}: got "${m.actual}" expected "${m.expected}"`,
  )
}

function run() {
  const raw = fs.readFileSync(FILE, 'utf8')
  const doc = yaml.load(raw)
  const words = doc.words

  const errors = check()

  // 2. Every derived nominative must match the curated existing form.
  const derived = {}
  for (const [key, w] of Object.entries(words)) {
    // Short-form-only lexemes (рад, до́лжен) carry a `short:` block but no
    // `forms:` / long-form declension — leave them untouched (no grid spliced).
    if (!w.forms) continue
    const mNom = w.forms?.m ?? w.accented
    const table = declineAdjective(mNom, w.forms)
    derived[key] = table
    for (const col of COLS) {
      const want = w.forms?.[col]
      if (want && strip(table[`${col}_nom`]) !== strip(want)) {
        errors.push(`nom mismatch ${key}.${col}: derived "${table[`${col}_nom`]}" vs data "${want}"`)
      } else if (want && table[`${col}_nom`] !== w.forms[col]) {
        errors.push(`stress mismatch ${key}.${col}: derived "${table[`${col}_nom`]}" vs data "${w.forms[col]}"`)
      }
    }
  }

  if (errors.length) {
    console.error(`VALIDATION FAILED (${errors.length}):`)
    for (const e of errors.slice(0, 40)) console.error('  - ' + e)
    process.exit(1)
  }
  console.log(`Validated ${Object.keys(words).length} adjectives (golden + all nominatives).`)

  // 3. Give each adjective entry a fresh declension block immediately after its
  // `forms:` block (the canonical order forms → declension → usage), and strip
  // any pre-existing `declension:` block wherever it sits in the entry — it need
  // not follow `forms:` directly (`usage:` sometimes intervenes). Working per
  // entry keeps re-runs idempotent regardless of the original field order.
  const emitDeclension = (key) => {
    const rows = ['    declension:']
    for (const col of COLS) {
      for (const c of CASES) rows.push(`      ${col}_${c}: ${derived[key][`${col}_${c}`]}`)
    }
    return rows
  }
  const lines = raw.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const header = line.match(/^ {2}"([^"]+)":\s*$/)
    if (!header || !derived[header[1]]) {
      out.push(line)
      continue
    }
    const key = header[1]
    out.push(line)
    // Walk the entry body (lines indented ≥4 spaces, or blank); a line with ≤3
    // leading spaces starts the next entry / top-level key and ends this one.
    let j = i + 1
    let replaced = false
    let afterForms = -1
    while (j < lines.length && !/^ {0,3}\S/.test(lines[j])) {
      if (/^ {4}declension:\s*$/.test(lines[j])) {
        // Replace the existing block in place — keeps its position, so a re-run
        // over already-correct data is a no-op.
        j++
        while (j < lines.length && /^ {6}\S/.test(lines[j])) j++
        out.push(...emitDeclension(key))
        replaced = true
        continue
      }
      out.push(lines[j])
      if (/^ {4}forms:\s*$/.test(lines[j])) {
        j++
        while (j < lines.length && /^ {6}\S/.test(lines[j])) out.push(lines[j++])
        afterForms = out.length // where to insert if the entry has no block yet
        continue
      }
      j++
    }
    // New entry with no declension block: add one right after `forms:`.
    if (!replaced && afterForms >= 0) out.splice(afterForms, 0, ...emitDeclension(key))
    i = j - 1
  }

  const next = out.join('\n')
  // 4. Re-parse and assert each entry has 24 declension keys.
  const reparsed = yaml.load(next)
  for (const [key, w] of Object.entries(reparsed.words)) {
    // Short-form-only lexemes (no `forms:`) carry no long-form declension.
    if (!w.forms) continue
    const d = w.declension ?? {}
    if (Object.keys(d).length !== 24) {
      console.error(`POST-SPLICE: ${key} has ${Object.keys(d).length} declension keys, expected 24`)
      process.exit(1)
    }
  }

  fs.writeFileSync(FILE, next)
  console.log(`Wrote declension blocks for ${Object.keys(reparsed.words).length} adjectives.`)
}

run()
