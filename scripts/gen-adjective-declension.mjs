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

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/vocab/adjectives.yml',
)

const ACUTE = '́' // combining acute accent
const VOWELS = 'аеёиоуыэюя'
const strip = (s) => s.normalize('NFC').replaceAll(ACUTE, '')
const countVowels = (s) => [...strip(s)].filter((c) => VOWELS.includes(c)).length
// Convention (matches the curated data): a monosyllable carries no stress mark,
// since the single vowel is unambiguously stressed — e.g. злой, not зло́й.
const conventionalStress = (form) => (countVowels(form) <= 1 ? strip(form) : form)

// Cases in canonical order; columns are the gender/number agreement forms.
const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']
const COLS = ['m', 'n', 'f', 'pl']

// Mark the first vowel of an (unstressed) ending as stressed.
function stress(ending) {
  for (const ch of ending) {
    if (VOWELS.includes(ch)) return ending.replace(ch, ch + ACUTE)
  }
  return ending
}

// Possessive adjectives in -ий (бо́жий, ли́сий, тре́тий) take a soft-sign (ь)
// stem in every form but the masc-nominative: бо́жий → бо́жье/бо́жья/бо́жьи. They
// are spelled like sibilant/soft adjectives (бо́жий looks like хоро́ший), so they
// can't be told apart from the m-nominative alone — the signal is the curated
// non-masc nominative ending in -ье / -ья / -ьи.
function isPossessive(forms) {
  if (!forms) return false
  const ends = (v, suf) => v != null && strip(v).endsWith(suf)
  return ends(forms.f, 'ья') || ends(forms.n, 'ье') || ends(forms.pl, 'ьи')
}

// Spelling class from the stem's final consonant and the dictionary form.
function classify(stemBare, mNomBare) {
  const last = stemBare.slice(-1)
  if ('жшчщ'.includes(last)) return 'sibilant'
  if ('кгх'.includes(last)) return 'velar'
  if (mNomBare.endsWith('ий')) return 'soft' // -ний etc. (closed class)
  return 'hard'
}

// Ending tables (letters only). `end` = true selects the ending-stressed
// variant where it differs (m_nom and, for sibilants, о vs е).
function endings(cls, end) {
  const hard = {
    m_nom: end ? 'ой' : 'ый', m_gen: 'ого', m_dat: 'ому', m_ins: 'ым', m_pre: 'ом',
    n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'ым', n_pre: 'ом',
    f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
    pl_nom: 'ые', pl_gen: 'ых', pl_dat: 'ым', pl_ins: 'ыми', pl_pre: 'ых',
  }
  const velar = {
    m_nom: end ? 'ой' : 'ий', m_gen: 'ого', m_dat: 'ому', m_ins: 'им', m_pre: 'ом',
    n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'им', n_pre: 'ом',
    f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
    pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
  }
  // Sibilants: ы→и always; о→е only when the ending is unstressed.
  const sibilant = end
    ? {
        m_nom: 'ой', m_gen: 'ого', m_dat: 'ому', m_ins: 'им', m_pre: 'ом',
        n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'им', n_pre: 'ом',
        f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
        pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
      }
    : {
        m_nom: 'ий', m_gen: 'его', m_dat: 'ему', m_ins: 'им', m_pre: 'ем',
        n_nom: 'ее', n_gen: 'его', n_dat: 'ему', n_ins: 'им', n_pre: 'ем',
        f_nom: 'ая', f_gen: 'ей', f_dat: 'ей', f_acc: 'ую', f_ins: 'ей', f_pre: 'ей',
        pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
      }
  const soft = {
    m_nom: 'ий', m_gen: 'его', m_dat: 'ему', m_ins: 'им', m_pre: 'ем',
    n_nom: 'ее', n_gen: 'его', n_dat: 'ему', n_ins: 'им', n_pre: 'ем',
    f_nom: 'яя', f_gen: 'ей', f_dat: 'ей', f_acc: 'юю', f_ins: 'ей', f_pre: 'ей',
    pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
  }
  // Possessive -ий: soft-sign stem in every form but the masc-nominative.
  const possessive = {
    m_nom: 'ий', m_gen: 'ьего', m_dat: 'ьему', m_ins: 'ьим', m_pre: 'ьем',
    n_nom: 'ье', n_gen: 'ьего', n_dat: 'ьему', n_ins: 'ьим', n_pre: 'ьем',
    f_nom: 'ья', f_gen: 'ьей', f_dat: 'ьей', f_acc: 'ью', f_ins: 'ьей', f_pre: 'ьей',
    pl_nom: 'ьи', pl_gen: 'ьих', pl_dat: 'ьим', pl_ins: 'ьими', pl_pre: 'ьих',
  }
  const table = { hard, velar, sibilant, soft, possessive }[cls]
  // Accusative (inanimate) mirrors the nominative for m / n / pl; the feminine
  // accusative is its own form. Animate masc/pl accusative equals the genitive.
  table.m_acc = table.m_nom
  table.n_acc = table.n_nom
  table.pl_acc = table.pl_nom
  return table
}

// Build the 24-form declension for one adjective from its accented m-nominative.
// `forms` (optional) are the curated m/f/n/pl nominatives — passed so possessive
// -ий adjectives (indistinguishable from sibilants by the m-nominative) can be
// recognised from their -ья/-ье/-ьи agreement forms.
export function declineAdjective(mNomAccented, forms) {
  const mNomBare = strip(mNomAccented)
  const endStressed = mNomBare.endsWith('ой')
  // Stem = dictionary form minus its 2-letter nominative ending. Stem-stressed
  // adjectives keep the stress mark in the stem; ending-stressed ones carry no
  // stem stress (the accent lives on the ending), so strip it.
  const stem = endStressed
    ? mNomBare.slice(0, -2)
    : mNomAccented.normalize('NFC').replace(new RegExp(`(ый|ий)$`), '')
  const stemFinalBare = strip(stem).slice(-1)
  const cls = isPossessive(forms)
    ? 'possessive'
    : classify(strip(stem) + stemFinalBare.slice(-0), mNomBare)
  const table = endings(cls, endStressed)

  const out = {}
  for (const col of COLS) {
    for (const c of CASES) {
      const e = table[`${col}_${c}`]
      out[`${col}_${c}`] = conventionalStress(stem + (endStressed ? stress(e) : e))
    }
  }
  return out
}

// ---- Golden reference paradigms (hand-verified) -----------------------------
const GOLDEN = {
  'но́вый': { m_nom: 'но́вый', m_gen: 'но́вого', m_dat: 'но́вому', m_acc: 'но́вый', m_ins: 'но́вым', m_pre: 'но́вом', n_nom: 'но́вое', n_acc: 'но́вое', f_nom: 'но́вая', f_gen: 'но́вой', f_acc: 'но́вую', pl_nom: 'но́вые', pl_gen: 'но́вых', pl_ins: 'но́выми' },
  'молодо́й': { m_nom: 'молодо́й', m_gen: 'молодо́го', m_ins: 'молоды́м', n_nom: 'молодо́е', f_nom: 'молода́я', f_gen: 'молодо́й', f_acc: 'молоду́ю', pl_nom: 'молоды́е', pl_gen: 'молоды́х', pl_ins: 'молоды́ми' },
  'ру́сский': { m_nom: 'ру́сский', m_gen: 'ру́сского', m_ins: 'ру́сским', n_nom: 'ру́сское', f_nom: 'ру́сская', f_gen: 'ру́сской', f_acc: 'ру́сскую', pl_nom: 'ру́сские', pl_gen: 'ру́сских', pl_ins: 'ру́сскими' },
  'хоро́ший': { m_nom: 'хоро́ший', m_gen: 'хоро́шего', m_dat: 'хоро́шему', m_ins: 'хоро́шим', m_pre: 'хоро́шем', n_nom: 'хоро́шее', f_nom: 'хоро́шая', f_gen: 'хоро́шей', f_acc: 'хоро́шую', pl_nom: 'хоро́шие', pl_gen: 'хоро́ших', pl_ins: 'хоро́шими' },
  'большо́й': { m_nom: 'большо́й', m_gen: 'большо́го', m_ins: 'больши́м', n_nom: 'большо́е', f_nom: 'больша́я', f_gen: 'большо́й', f_acc: 'большу́ю', pl_nom: 'больши́е', pl_gen: 'больши́х', pl_ins: 'больши́ми' },
  'си́ний': { m_nom: 'си́ний', m_gen: 'си́него', m_dat: 'си́нему', m_ins: 'си́ним', m_pre: 'си́нем', n_nom: 'си́нее', f_nom: 'си́няя', f_gen: 'си́ней', f_acc: 'си́нюю', pl_nom: 'си́ние', pl_gen: 'си́них', pl_ins: 'си́ними' },
  // Possessive -ий (soft-sign stem in every form but the masc-nominative).
  'бо́жий': { m_nom: 'бо́жий', m_gen: 'бо́жьего', m_dat: 'бо́жьему', m_acc: 'бо́жий', m_ins: 'бо́жьим', m_pre: 'бо́жьем', n_nom: 'бо́жье', n_acc: 'бо́жье', f_nom: 'бо́жья', f_gen: 'бо́жьей', f_acc: 'бо́жью', pl_nom: 'бо́жьи', pl_gen: 'бо́жьих', pl_ins: 'бо́жьими' },
}

function check() {
  const errors = []
  // 1. Golden paradigms. Pass the curated nominatives so the possessive class
  // (indistinguishable from a sibilant by the m-nominative alone) is detected.
  for (const [lemma, expected] of Object.entries(GOLDEN)) {
    const forms = { m: expected.m_nom, f: expected.f_nom, n: expected.n_nom, pl: expected.pl_nom }
    const got = declineAdjective(lemma, forms)
    for (const [k, v] of Object.entries(expected)) {
      if (got[k] !== v) errors.push(`golden ${lemma}.${k}: got "${got[k]}" expected "${v}"`)
    }
  }
  return errors
}

function run() {
  const raw = fs.readFileSync(FILE, 'utf8')
  const doc = yaml.load(raw)
  const words = doc.words

  const errors = check()

  // 2. Every derived nominative must match the curated existing form.
  const derived = {}
  for (const [key, w] of Object.entries(words)) {
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
