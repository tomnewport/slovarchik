// Even out the first-person gender split of the phrase corpus (issue #525).
//
//   node scripts/rebalance-gender.mjs           # dry run: report, write nothing
//   node scripts/rebalance-gender.mjs --apply   # rewrite the vocab YAML
//
// Russian marks the speaker's gender on the past-tense verb (я сде́лал vs я
// сде́лала). The corpus was seeded mostly masculine, so this flips a
// deterministic subset of first-person masculine phrases to feminine until the
// two are even. Every flip reuses the verb's own stored, correctly-stressed
// `past_f` form (genderBalance.feminizeFirstPerson) — never a letter-mangling
// rule — and only touches phrases with a single gendered token, so nothing can
// fall out of agreement. When the flipped verb is itself an `inflect:`
// annotation's target, the annotation's `person: past_m` is retargeted to
// `past_f` so the in-context drill keeps grading the shown form.
//
// Edits are surgical single-line replacements (ru values are unquoted, one line
// each) so the hand-curated files keep their formatting; the result is
// re-parsed and re-audited before anything is written.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { buildPastIndex, feminizeFirstPerson, genderedTokens } from '../src/lib/genderBalance.js'

const apply = process.argv.includes('--apply')
const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/vocab')
const files = readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))
const docs = files
  .map((f) => ({ file: f, pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')] }))
  .filter((r) => r.pos)
  .map((r) => ({ ...r, doc: yaml.load(readFileSync(resolve(vocabDir, r.file), 'utf8')) }))

const words = buildWords(docs.map((r) => ({ pos: r.pos, doc: r.doc })))
const pastIndex = buildPastIndex(words)

// Collect every safely switchable first-person masculine phrase, deduped by its
// (unique) Russian text. `index` is the token position the feminine form lands
// on — used to retarget a past_m annotation on that same token.
const candidates = new Map() // ru -> { femRu, index }
let masculine = 0
let feminine = 0
for (const w of words) {
  if (w.learnable === false) continue
  for (const ex of w.usage ?? []) {
    const g = genderedTokens(ex?.ru, pastIndex)
    const isFP = /(^|[\s"«„(–—-])[яЯ](?=[\s,.!?…:;»")]|$)/u.test(String(ex?.ru ?? ''))
    if (!isFP) continue
    const hasM = g.some((t) => t.gender === 'm')
    const hasF = g.some((t) => t.gender === 'f')
    if (hasM && !hasF) masculine++
    else if (hasF && !hasM) feminine++
    const fem = feminizeFirstPerson(ex?.ru, pastIndex)
    if (!fem) continue
    const prev = candidates.get(ex.ru)
    if (prev && prev.femRu !== fem.ru) {
      candidates.delete(ex.ru) // inconsistent duplicate — leave both alone
      continue
    }
    candidates.set(ex.ru, { femRu: fem.ru, index: fem.index })
  }
}

// Flip enough to make masculine ≈ feminine: each flip moves one phrase across.
// Clamped to ≥0 so that, once the corpus is already even, the script is a no-op
// rather than flipping (almost) everything via a negative slice.
const target = Math.max(0, Math.min(candidates.size, Math.round((masculine - feminine) / 2)))

/** Deterministic 32-bit hash so the flipped subset is stable and spread out. */
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const chosen = [...candidates.keys()].sort((a, b) => hash(a) - hash(b)).slice(0, target)
const editMap = new Map(chosen.map((ru) => [ru, candidates.get(ru)]))

console.log(`first-person masculine=${masculine} feminine=${feminine} switchable=${candidates.size}`)
console.log(`flipping ${editMap.size} → masculine≈${masculine - editMap.size} feminine≈${feminine + editMap.size}`)

const leadSpaces = (line) => line.match(/^ */)[0].length

let flipped = 0
let annotationsRetargeted = 0
const updated = new Map()
for (const r of docs) {
  const text = readFileSync(resolve(vocabDir, r.file), 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*-\s*ru:\s*)(\S.*?)\s*$/)
    if (!m) continue
    const sentence = m[2]
    if (sentence.startsWith('"') || sentence.startsWith("'")) continue // quoted — skip
    const edit = editMap.get(sentence)
    if (!edit) continue
    lines[i] = m[1] + edit.femRu
    flipped++
    // Retarget a past_m annotation that points at the flipped verb token.
    const ruIndent = leadSpaces(lines[i])
    for (let j = i + 1; j < lines.length && leadSpaces(lines[j]) > ruIndent; j++) {
      const inf = lines[j].match(/inflect:\s*\{[^}]*\}/)
      if (!inf) continue
      const tok = lines[j].match(/token:\s*(\d+)/)
      if (tok && Number(tok[1]) - 1 === edit.index && /person:\s*past_m\b/.test(lines[j])) {
        lines[j] = lines[j].replace(/person:\s*past_m\b/, 'person: past_f')
        annotationsRetargeted++
      }
      break
    }
  }
  const next = lines.join('\n')
  if (next !== text) {
    yaml.load(next) // fail loudly if an edit broke the YAML
    updated.set(r.file, next)
  }
}

console.log(`ru lines rewritten: ${flipped}; past_m annotations retargeted: ${annotationsRetargeted}`)
if (flipped < editMap.size) {
  console.error(`WARNING: ${editMap.size - flipped} chosen phrase(s) were not found in the text`)
}
if (apply) {
  for (const [file, next] of updated) writeFileSync(resolve(vocabDir, file), next)
  console.log(`wrote ${updated.size} files`)
} else {
  console.log('(dry run — pass --apply to write)')
}
