// Even out the gender split of the phrase corpus, per person
// (issue #525 first person, #541 second person).
//
//   node scripts/rebalance-gender.mjs           # dry run: report, write nothing
//   node scripts/rebalance-gender.mjs --apply   # rewrite the vocab YAML
//   node scripts/rebalance-gender.mjs --person=ты   # one person only
//
// Russian marks the subject's gender on the past-tense verb (я сде́лал vs я
// сде́лала, ты уста́л vs ты уста́ла). The corpus was seeded mostly masculine, so
// this flips a deterministic subset of masculine phrases to feminine until the
// two are even — first for «я», then for «ты», where the subject is the learner
// themselves. Every flip reuses the verb's own stored, correctly-stressed
// `past_f` form (genderBalance.feminizeSubject) — never a letter-mangling rule
// — and only touches phrases with a single gendered token in the subject's own
// clause, so nothing can fall out of agreement. When the flipped verb is itself
// an `inflect:` annotation's target, the annotation's `person: past_m` is
// retargeted to `past_f` so the in-context drill keeps grading the shown form.
//
// The two passes run against the same files but never collide: a phrase with
// both «я» and «ты» in the flipped verb's clause is refused by feminizeSubject,
// and each pass re-reads the corpus as the previous one left it.
//
// Edits are surgical single-line replacements (ru values are unquoted, one line
// each) so the hand-curated files keep their formatting; the result is
// re-parsed and re-audited before anything is written.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import {
  buildPastIndex,
  feminizeSubject,
  genderedTokens,
  hasSubjectPronoun,
  FIRST_PERSON,
  SECOND_PERSON,
} from '../src/lib/genderBalance.js'

const apply = process.argv.includes('--apply')
const only = process.argv.find((a) => a.startsWith('--person='))?.split('=')[1]
const persons = [FIRST_PERSON, SECOND_PERSON].filter((p) => !only || p === only)
if (!persons.length) {
  console.error(`--person must be one of: ${FIRST_PERSON}, ${SECOND_PERSON}`)
  process.exit(1)
}

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/vocab')
const files = readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))

/** Deterministic 32-bit hash so the flipped subset is stable and spread out. */
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const leadSpaces = (line) => line.match(/^ */)[0].length

// Working copy of every vocab file's text. Each person's pass reads it, plans
// its flips against the corpus as the previous pass left it, and writes back
// here; nothing touches disk until every pass has succeeded.
const text = new Map(files.map((f) => [f, readFileSync(resolve(vocabDir, f), 'utf8')]))
const dirty = new Set()

for (const pronoun of persons) {
  const docs = files
    .map((f) => ({ file: f, pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')] }))
    .filter((r) => r.pos)
    .map((r) => ({ ...r, doc: yaml.load(text.get(r.file)) }))

  const words = buildWords(docs.map((r) => ({ pos: r.pos, doc: r.doc })))
  const pastIndex = buildPastIndex(words)

  // Collect every safely switchable masculine phrase, deduped by its (unique)
  // Russian text. `index` is the token position the feminine form lands on —
  // used to retarget a past_m annotation on that same token.
  const candidates = new Map() // ru -> { femRu, index }
  let masculine = 0
  let feminine = 0
  for (const w of words) {
    if (w.learnable === false) continue
    for (const ex of w.usage ?? []) {
      if (!hasSubjectPronoun(ex?.ru, pronoun)) continue
      const g = genderedTokens(ex?.ru, pastIndex)
      const hasM = g.some((t) => t.gender === 'm')
      const hasF = g.some((t) => t.gender === 'f')
      if (hasM && !hasF) masculine++
      else if (hasF && !hasM) feminine++
      const fem = feminizeSubject(ex?.ru, pastIndex, pronoun)
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
  // Clamped to ≥0 so that, once the corpus is already even, the pass is a no-op
  // rather than flipping (almost) everything via a negative slice.
  const target = Math.max(0, Math.min(candidates.size, Math.round((masculine - feminine) / 2)))
  const chosen = [...candidates.keys()].sort((a, b) => hash(a) - hash(b)).slice(0, target)
  const editMap = new Map(chosen.map((ru) => [ru, candidates.get(ru)]))

  console.log(`«${pronoun}»: masculine=${masculine} feminine=${feminine} switchable=${candidates.size}`)
  console.log(`  flipping ${editMap.size} → masculine≈${masculine - editMap.size} feminine≈${feminine + editMap.size}`)

  let flipped = 0
  let annotationsRetargeted = 0
  for (const r of docs) {
    const before = text.get(r.file)
    const lines = before.split('\n')
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
    if (next !== before) {
      yaml.load(next) // fail loudly if an edit broke the YAML
      text.set(r.file, next)
      dirty.add(r.file)
    }
  }

  console.log(`  ru lines rewritten: ${flipped}; past_m annotations retargeted: ${annotationsRetargeted}`)
  if (flipped < editMap.size) {
    console.error(`  WARNING: ${editMap.size - flipped} chosen phrase(s) were not found in the text`)
  }
}

if (apply) {
  for (const file of dirty) writeFileSync(resolve(vocabDir, file), text.get(file))
  console.log(`wrote ${dirty.size} files`)
} else {
  console.log('(dry run — pass --apply to write)')
}
