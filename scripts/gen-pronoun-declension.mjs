// Generate full case × gender/number declension tables for the adjective-like
// pronouns in public/vocab/pronouns.yml and splice a `declension:` block into
// each entry.
//
// Unlike adjectives, the pronominal declension is irregular (мой/моего́, тот/того́,
// весь/всего́, чей/чьего́, сам/самого́ …), so the 24 forms can't be derived by a
// single rule. Instead they are hand-curated below, one compact table per
// pronoun, and the script REFUSES to write unless:
//   1. every curated nominative (m/f/n/pl) matches the existing `forms` block —
//      the strongest guard against a typo or a mis-keyed pronoun,
//   2. every curated pronoun actually appears in the file (and vice-versa: every
//      adjective-like pronoun in the file is covered here),
//   3. the spliced file still parses and each covered entry gains 24 keys.
//
// Run: node scripts/gen-pronoun-declension.mjs   (idempotent)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/vocab/pronouns.yml',
)

const ACUTE = '́' // combining acute accent
const strip = (s) => s.normalize('NFC').replaceAll(ACUTE, '')

const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']
const COLS = ['m', 'n', 'f', 'pl']

// Compact per-gender form lists. m / n / pl give [nom, gen, dat, ins, pre] —
// their accusative is the inanimate form (= nominative), matching the convention
// used for adjectives. f gives [nom, gen, dat, acc, ins, pre] (its accusative is
// a distinct form). Monosyllables carry no stress mark by convention.
function build(m, n, f, pl) {
  return {
    m_nom: m[0], m_gen: m[1], m_dat: m[2], m_acc: m[0], m_ins: m[3], m_pre: m[4],
    n_nom: n[0], n_gen: n[1], n_dat: n[2], n_acc: n[0], n_ins: n[3], n_pre: n[4],
    f_nom: f[0], f_gen: f[1], f_dat: f[2], f_acc: f[3], f_ins: f[4], f_pre: f[5],
    pl_nom: pl[0], pl_gen: pl[1], pl_dat: pl[2], pl_acc: pl[0], pl_ins: pl[3], pl_pre: pl[4],
  }
}

// Hand-curated tables, keyed by the YAML natural key.
const DATA = {
  // Possessives (soft, ending-stressed): мой/твой/свой share one paradigm.
  'мой=my': build(
    ['мой', 'моего́', 'моему́', 'мои́м', 'моём'],
    ['моё', 'моего́', 'моему́', 'мои́м', 'моём'],
    ['моя́', 'мое́й', 'мое́й', 'мою́', 'мое́й', 'мое́й'],
    ['мои́', 'мои́х', 'мои́м', 'мои́ми', 'мои́х'],
  ),
  'твой=your': build(
    ['твой', 'твоего́', 'твоему́', 'твои́м', 'твоём'],
    ['твоё', 'твоего́', 'твоему́', 'твои́м', 'твоём'],
    ['твоя́', 'твое́й', 'твое́й', 'твою́', 'твое́й', 'твое́й'],
    ['твои́', 'твои́х', 'твои́м', 'твои́ми', 'твои́х'],
  ),
  "свой=one's own": build(
    ['свой', 'своего́', 'своему́', 'свои́м', 'своём'],
    ['своё', 'своего́', 'своему́', 'свои́м', 'своём'],
    ['своя́', 'свое́й', 'свое́й', 'свою́', 'свое́й', 'свое́й'],
    ['свои́', 'свои́х', 'свои́м', 'свои́ми', 'свои́х'],
  ),
  // Possessives наш/ваш (stem-stressed).
  'наш=our': build(
    ['наш', 'на́шего', 'на́шему', 'на́шим', 'на́шем'],
    ['на́ше', 'на́шего', 'на́шему', 'на́шим', 'на́шем'],
    ['на́ша', 'на́шей', 'на́шей', 'на́шу', 'на́шей', 'на́шей'],
    ['на́ши', 'на́ших', 'на́шим', 'на́шими', 'на́ших'],
  ),
  'ваш=your': build(
    ['ваш', 'ва́шего', 'ва́шему', 'ва́шим', 'ва́шем'],
    ['ва́ше', 'ва́шего', 'ва́шему', 'ва́шим', 'ва́шем'],
    ['ва́ша', 'ва́шей', 'ва́шей', 'ва́шу', 'ва́шей', 'ва́шей'],
    ['ва́ши', 'ва́ших', 'ва́шим', 'ва́шими', 'ва́ших'],
  ),
  // Demonstratives.
  'этот=this': build(
    ['э́тот', 'э́того', 'э́тому', 'э́тим', 'э́том'],
    ['э́то', 'э́того', 'э́тому', 'э́тим', 'э́том'],
    ['э́та', 'э́той', 'э́той', 'э́ту', 'э́той', 'э́той'],
    ['э́ти', 'э́тих', 'э́тим', 'э́тими', 'э́тих'],
  ),
  'тот=that': build(
    ['тот', 'того́', 'тому́', 'тем', 'том'],
    ['то', 'того́', 'тому́', 'тем', 'том'],
    ['та', 'той', 'той', 'ту', 'той', 'той'],
    ['те', 'тех', 'тем', 'те́ми', 'тех'],
  ),
  'такой=such': build(
    ['тако́й', 'тако́го', 'тако́му', 'таки́м', 'тако́м'],
    ['тако́е', 'тако́го', 'тако́му', 'таки́м', 'тако́м'],
    ['така́я', 'тако́й', 'тако́й', 'таку́ю', 'тако́й', 'тако́й'],
    ['таки́е', 'таки́х', 'таки́м', 'таки́ми', 'таки́х'],
  ),
  // Determiners.
  'весь=all': build(
    ['весь', 'всего́', 'всему́', 'всем', 'всём'],
    ['всё', 'всего́', 'всему́', 'всем', 'всём'],
    ['вся', 'всей', 'всей', 'всю', 'всей', 'всей'],
    ['все', 'всех', 'всем', 'все́ми', 'всех'],
  ),
  'каждый=each': build(
    ['ка́ждый', 'ка́ждого', 'ка́ждому', 'ка́ждым', 'ка́ждом'],
    ['ка́ждое', 'ка́ждого', 'ка́ждому', 'ка́ждым', 'ка́ждом'],
    ['ка́ждая', 'ка́ждой', 'ка́ждой', 'ка́ждую', 'ка́ждой', 'ка́ждой'],
    ['ка́ждые', 'ка́ждых', 'ка́ждым', 'ка́ждыми', 'ка́ждых'],
  ),
  'любой=any': build(
    ['любо́й', 'любо́го', 'любо́му', 'любы́м', 'любо́м'],
    ['любо́е', 'любо́го', 'любо́му', 'любы́м', 'любо́м'],
    ['люба́я', 'любо́й', 'любо́й', 'любу́ю', 'любо́й', 'любо́й'],
    ['любы́е', 'любы́х', 'любы́м', 'любы́ми', 'любы́х'],
  ),
  'сам=oneself': build(
    ['сам', 'самого́', 'самому́', 'сами́м', 'само́м'],
    ['само́', 'самого́', 'самому́', 'сами́м', 'само́м'],
    ['сама́', 'само́й', 'само́й', 'саму́', 'само́й', 'само́й'],
    ['са́ми', 'сами́х', 'сами́м', 'сами́ми', 'сами́х'],
  ),
  // Interrogative / relative (adjective-like).
  'какой=which': build(
    ['како́й', 'како́го', 'како́му', 'каки́м', 'како́м'],
    ['како́е', 'како́го', 'како́му', 'каки́м', 'како́м'],
    ['кака́я', 'како́й', 'како́й', 'каку́ю', 'како́й', 'како́й'],
    ['каки́е', 'каки́х', 'каки́м', 'каки́ми', 'каки́х'],
  ),
  'который=which': build(
    ['кото́рый', 'кото́рого', 'кото́рому', 'кото́рым', 'кото́ром'],
    ['кото́рое', 'кото́рого', 'кото́рому', 'кото́рым', 'кото́ром'],
    ['кото́рая', 'кото́рой', 'кото́рой', 'кото́рую', 'кото́рой', 'кото́рой'],
    ['кото́рые', 'кото́рых', 'кото́рым', 'кото́рыми', 'кото́рых'],
  ),
  'чей=whose': build(
    ['чей', 'чьего́', 'чьему́', 'чьим', 'чьём'],
    ['чьё', 'чьего́', 'чьему́', 'чьим', 'чьём'],
    ['чья', 'чьей', 'чьей', 'чью', 'чьей', 'чьей'],
    ['чьи', 'чьих', 'чьим', 'чьи́ми', 'чьих'],
  ),
  // Negative (declines like какой with the ни- prefix).
  'никакой=no': build(
    ['никако́й', 'никако́го', 'никако́му', 'никаки́м', 'никако́м'],
    ['никако́е', 'никако́го', 'никако́му', 'никаки́м', 'никако́м'],
    ['никака́я', 'никако́й', 'никако́й', 'никаку́ю', 'никако́й', 'никако́й'],
    ['никаки́е', 'никаки́х', 'никаки́м', 'никаки́ми', 'никаки́х'],
  ),
}

function run() {
  const raw = fs.readFileSync(FILE, 'utf8')
  const doc = yaml.load(raw)
  const words = doc.words

  const errors = []

  // The adjective-like pronouns are exactly those carrying a `forms.m` field.
  const adjLike = Object.entries(words).filter(([, w]) => w.forms?.m)
  const fileKeys = new Set(adjLike.map(([k]) => k))
  const dataKeys = new Set(Object.keys(DATA))

  for (const k of fileKeys) {
    if (!dataKeys.has(k)) errors.push(`no curated declension for adjective-like pronoun "${k}"`)
  }
  for (const k of dataKeys) {
    if (!fileKeys.has(k)) errors.push(`curated "${k}" is not an adjective-like pronoun in the file`)
  }

  // Every curated nominative must match the existing curated `forms` (incl. stress).
  for (const [key, table] of Object.entries(DATA)) {
    const w = words[key]
    if (!w) continue
    for (const col of COLS) {
      const want = w.forms?.[col]
      const got = table[`${col}_nom`]
      if (want && strip(got) !== strip(want)) {
        errors.push(`nom mismatch ${key}.${col}: curated "${got}" vs data "${want}"`)
      } else if (want && got !== want) {
        errors.push(`stress mismatch ${key}.${col}: curated "${got}" vs data "${want}"`)
      }
    }
  }

  if (errors.length) {
    console.error(`VALIDATION FAILED (${errors.length}):`)
    for (const e of errors.slice(0, 40)) console.error('  - ' + e)
    process.exit(1)
  }
  console.log(`Validated ${Object.keys(DATA).length} pronoun paradigms (all nominatives).`)

  // Splice a declension block after each entry's `forms:` block.
  const lines = raw.split('\n')
  const out = []
  let currentKey = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const header = line.match(/^ {2}"([^"]+)":\s*$/)
    if (header) currentKey = header[1]
    out.push(line)
    if (/^ {4}forms:\s*$/.test(line) && currentKey && DATA[currentKey]) {
      // Skip past the existing forms block (6-space-indented children).
      let j = i + 1
      while (j < lines.length && /^ {6}\S/.test(lines[j])) {
        out.push(lines[j])
        j++
      }
      // Drop any pre-existing declension block so re-runs replace rather than
      // duplicate it (keeps the script idempotent).
      if (j < lines.length && /^ {4}declension:\s*$/.test(lines[j])) {
        j++
        while (j < lines.length && /^ {6}\S/.test(lines[j])) j++
      }
      out.push('    declension:')
      for (const col of COLS) {
        for (const c of CASES) {
          out.push(`      ${col}_${c}: ${DATA[currentKey][`${col}_${c}`]}`)
        }
      }
      i = j - 1
      currentKey = null
    }
  }

  const next = out.join('\n')
  // Re-parse and assert each covered entry has 24 declension keys.
  const reparsed = yaml.load(next)
  for (const key of Object.keys(DATA)) {
    const d = reparsed.words[key]?.declension ?? {}
    if (Object.keys(d).length !== 24) {
      console.error(`POST-SPLICE: ${key} has ${Object.keys(d).length} declension keys, expected 24`)
      process.exit(1)
    }
  }

  fs.writeFileSync(FILE, next)
  console.log(`Wrote declension blocks for ${Object.keys(DATA).length} pronouns.`)
}

run()
