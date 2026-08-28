// Probe: how far does an external dictionary agree with our paradigm cells?
//
// The corpus carries ~46,000 hand-authored inflected forms, and every check we
// have on them is internally self-referential — morphOracle.js says so in its
// own header ("if both the table and the drill read the same bad source value,
// CI stays green"), and stressAudit.js proof-reads a phrase token against the
// word's *own* stored cell. The only genuinely external ground truth in-repo is
// ~170 hand-curated entries across morphGolden.js and stressGolden.js.
//
// This script measures whether an external dictionary could close that gap, and
// it is deliberately a MEASUREMENT, not a check: it prints agreement rates and a
// sample of disagreements so a human can judge whether the residue is a real
// defect list or normalisation noise. Nothing here fails, and nothing here edits
// the corpus. See docs/dictionary-probe.md for the findings.
//
// Source: the OpenRussian dataset (github.com/Badestrand/russian-dictionary),
// CC BY-SA 4.0 — Wiktionary-derived plus community correction. It is a *second
// opinion*, not an oracle: where it disagrees, either side can be the wrong one.
//
//   node scripts/probe-dictionary.mjs --fetch     # download into .dictionary-cache/
//   node scripts/probe-dictionary.mjs             # measure against the cache
//   node scripts/probe-dictionary.mjs --samples 40
//   node scripts/probe-dictionary.mjs --json out.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB = path.join(ROOT, 'public/vocab')
const CACHE = path.join(ROOT, '.dictionary-cache')
const BASE = 'https://raw.githubusercontent.com/Badestrand/russian-dictionary/master'
const SETS = ['nouns', 'verbs', 'adjectives']

const ACUTE = '́'

// ─── normalisation ──────────────────────────────────────────────────────────

/**
 * OpenRussian marks stress with an ASCII apostrophe *after* the stressed vowel
 * (`челове'к`); we use a combining acute *on* it (`челове́к`). Rewrite theirs
 * into ours so the two are comparable at all. A `'` that does not follow a
 * vowel is not a stress mark and is dropped rather than guessed at.
 */
const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
export function toAcute(value) {
  let out = ''
  for (const ch of String(value ?? '')) {
    if (ch === "'" && out && VOWELS.includes(out.at(-1))) out += ACUTE
    else if (ch !== "'") out += ch
  }
  return out.normalize('NFC')
}

const strip = (s) => String(s ?? '').replace(/[́́´ˊ]/g, '')
/** Letters only: stress dropped, lower-cased, ё *kept* (morphOracle's convention). */
const letters = (s) => strip(s).toLowerCase().normalize('NFC')
/** Full form: stress kept, lower-cased. */
const stressed = (s) => String(s ?? '').toLowerCase().normalize('NFC')

/**
 * A one-vowel word carries its stress unambiguously and our corpus leaves it
 * unmarked (the rule stressAudit.js already applies). OpenRussian marks it
 * anyway (`бы́л`, `а́кт`), so comparing there measures a notation
 * difference, not a disagreement about the language.
 */
const vowelCount = (s) => [...strip(s)].filter((c) => VOWELS.includes(c)).length
export const monosyllabic = (s) => vowelCount(s) <= 1

/** A dictionary cell may offer variants ("маха'ю, машу'"); accept any of them. */
export function variants(cell) {
  return String(cell ?? '')
    .split(/[,;/]| или /)
    .map((s) => toAcute(s.trim()))
    .filter(Boolean)
}

// ─── loading ────────────────────────────────────────────────────────────────

async function fetchAll() {
  fs.mkdirSync(CACHE, { recursive: true })
  for (const name of [...SETS, 'others']) {
    const url = `${BASE}/${name}.csv`
    process.stdout.write(`fetching ${name}.csv … `)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(CACHE, `${name}.csv`), body)
    console.log(`${(body.length / 1e6).toFixed(1)} MB`)
  }
  console.log(`\ncached in ${path.relative(ROOT, CACHE)}/ (gitignored)`)
}

/** The files are tab-separated despite the .csv name, with no quoting. */
function readTsv(name) {
  const file = path.join(CACHE, `${name}.csv`)
  if (!fs.existsSync(file)) {
    console.error(`missing ${path.relative(ROOT, file)} — run with --fetch first`)
    process.exit(1)
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const head = lines[0].split('\t')
  return lines.slice(1).map((line) => {
    const cols = line.split('\t')
    return Object.fromEntries(head.map((h, i) => [h, cols[i] ?? '']))
  })
}

/** bare lemma → the dictionary rows sharing it (homographs collide). */
function indexBy(rows) {
  const map = new Map()
  for (const row of rows) {
    const key = letters(row.bare || row.accented)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}

function loadVocab(name) {
  const doc = yaml.load(fs.readFileSync(path.join(VOCAB, `${name}.yml`), 'utf8'))
  return Object.entries(doc.words || {})
}

// ─── slot maps: our cell key → their column ─────────────────────────────────

const NOUN_SLOTS = {
  sg_nom: 'sg_nom', sg_gen: 'sg_gen', sg_dat: 'sg_dat',
  sg_acc: 'sg_acc', sg_ins: 'sg_inst', sg_pre: 'sg_prep',
  pl_nom: 'pl_nom', pl_gen: 'pl_gen', pl_dat: 'pl_dat',
  pl_acc: 'pl_acc', pl_ins: 'pl_inst', pl_pre: 'pl_prep',
}

// Their `presfut_*` is one block; which tense it is follows from the aspect,
// so an imperfective's `present` and a perfective's `future` both map onto it.
const VERB_SLOTS = {
  '1sg': 'presfut_sg1', '2sg': 'presfut_sg2', '3sg': 'presfut_sg3',
  '1pl': 'presfut_pl1', '2pl': 'presfut_pl2', '3pl': 'presfut_pl3',
}
const VERB_FLAT = {
  past_m: 'past_m', past_f: 'past_f', past_n: 'past_n', past_pl: 'past_pl',
}

const ADJ_SLOTS = {}
for (const g of ['m', 'f', 'n', 'pl']) {
  for (const [ours, theirs] of Object.entries({
    nom: 'nom', gen: 'gen', dat: 'dat', acc: 'acc', ins: 'inst', pre: 'prep',
  })) {
    ADJ_SLOTS[`${g}_${ours}`] = `decl_${g}_${theirs}`
  }
}

/** Flatten one of our records into (slot → stored form) for the POS. */
function ourCells(pos, word) {
  const out = {}
  if (pos === 'nouns') {
    for (const slot of Object.keys(NOUN_SLOTS)) {
      if (word.declension?.[slot]) out[slot] = word.declension[slot]
    }
  } else if (pos === 'adjectives') {
    for (const slot of Object.keys(ADJ_SLOTS)) {
      if (word.declension?.[slot]) out[slot] = word.declension[slot]
    }
  } else {
    const block = word.conjugation?.present || word.conjugation?.future
    for (const slot of Object.keys(VERB_SLOTS)) {
      if (block?.[slot]) out[slot] = block[slot]
    }
    for (const slot of Object.keys(VERB_FLAT)) {
      if (word.conjugation?.[slot]) out[slot] = word.conjugation[slot]
    }
    if (word.conjugation?.imperative?.sg) out.imperative_sg = word.conjugation.imperative.sg
    if (word.conjugation?.imperative?.pl) out.imperative_pl = word.conjugation.imperative.pl
  }
  return out
}

const COLUMN = { ...NOUN_SLOTS, ...ADJ_SLOTS, ...VERB_SLOTS, ...VERB_FLAT, imperative_sg: 'imperative_sg', imperative_pl: 'imperative_pl' }

// ─── the probe ──────────────────────────────────────────────────────────────

function probe({ samples }) {
  const report = { generated: new Date().toISOString(), pos: {}, findings: [] }

  for (const pos of SETS) {
    const dict = indexBy(readTsv(pos))
    const words = loadVocab(pos)

    const stat = {
      words: words.length, matched: 0, unmatched: [],
      cells: 0, compared: 0, absent: 0,
      letterAgree: 0, letterDisagree: 0,
      stressAgree: 0, stressDisagree: 0,
      monosyllabic: 0, senseDoubt: 0, senseDoubtCells: 0,
      metaChecked: 0, metaDisagree: 0,
    }
    const letterMismatches = []
    const stressMismatches = []
    const senseDoubtMismatches = []
    const metaMismatches = []

    for (const [key, word] of words) {
      const head = letters(word.accented || word.headword || key.split('=')[0])
      const rows = dict.get(head)
      const cells = ourCells(pos, word)
      stat.cells += Object.keys(cells).length

      if (!rows) {
        stat.unmatched.push(key)
        continue
      }
      stat.matched++

      // Homographs: score against every candidate row and keep the best, so a
      // pair like за'мок/замо'к is not judged against the wrong sense.
      let best = null
      for (const row of rows) {
        const scored = compareRow(cells, row)
        scored.sense = senseOverlap(key, word, row)
        const better = !best
          || scored.letterAgree > best.letterAgree
          || (scored.letterAgree === best.letterAgree && scored.sense > best.sense)
        if (better) best = { ...scored, row }
      }
      // Even the best row can be the wrong *sense* — а́тлас "map book" against
      // our атла́с "satin" agrees on every letter and disagrees on every stress.
      // Those are not corpus bugs, so they are counted apart rather than mixed
      // into the headline rate.
      const doubted = best.sense === 0
      if (doubted) stat.senseDoubt++
      stat.monosyllabic += best.monosyllabic
      if (doubted) {
        stat.senseDoubtCells += best.letterDisagree + best.stressDisagree
        for (const m of [...best.letters, ...best.stress]) senseDoubtMismatches.push({ key, ...m })
      } else {
        stat.compared += best.compared
        stat.absent += best.absent
        stat.letterAgree += best.letterAgree
        stat.letterDisagree += best.letterDisagree
        stat.stressAgree += best.stressAgree
        stat.stressDisagree += best.stressDisagree
        for (const m of best.letters) letterMismatches.push({ key, ...m })
        for (const m of best.stress) stressMismatches.push({ key, ...m })
      }

      // Cheap second opinions on the non-paradigm fields.
      const meta = compareMeta(pos, word, best.row)
      stat.metaChecked += meta.checked
      stat.metaDisagree += meta.disagree.length
      for (const m of meta.disagree) metaMismatches.push({ key, ...m })
    }

    stat.samples = {
      letters: letterMismatches.slice(0, samples),
      stress: stressMismatches.slice(0, samples),
      meta: metaMismatches.slice(0, samples),
      senseDoubt: senseDoubtMismatches.slice(0, samples),
    }
    stat.unmatchedSample = stat.unmatched.slice(0, samples)
    stat.unmatchedCount = stat.unmatched.length
    delete stat.unmatched
    report.pos[pos] = stat
    report.findings.push(...letterMismatches.map((m) => ({ pos, kind: 'letters', ...m })))
    report.findings.push(...stressMismatches.map((m) => ({ pos, kind: 'stress', ...m })))
  }
  return report
}

/**
 * Do our gloss and theirs describe the same word? The corpus key carries the
 * English on its right-hand side (`атлас=satin`) and their row has
 * `translations_en`, so a shared content word is decent evidence the two
 * entries are the same sense — and no shared word at all is decent evidence
 * they are not.
 */
const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'of', 'or', 'and', 'be', 'is', 'in', 'on', 'for', 'with', 'sth', 'sb', 'one', 'something', 'someone'])
function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}
export function senseOverlap(key, word, row) {
  const ours = new Set([...words(key.split('=')[1]), ...words(word.en_gb?.standard)])
  if (!ours.size) return 1
  const theirs = words(row.translations_en)
  if (!theirs.length) return 1
  return theirs.filter((w) => ours.has(w)).length
}

/** Compare all our cells for one word against one dictionary row. */
export function compareRow(cells, row) {
  const out = {
    compared: 0, absent: 0, letterAgree: 0, letterDisagree: 0,
    stressAgree: 0, stressDisagree: 0, monosyllabic: 0, letters: [], stress: [],
  }
  for (const [slot, ours] of Object.entries(cells)) {
    const raw = row[COLUMN[slot]]
    const theirs = variants(raw)
    if (!theirs.length) { out.absent++; continue }
    out.compared++

    if (theirs.some((t) => letters(t) === letters(ours))) {
      out.letterAgree++
      // Stress is only a meaningful question once we agree on the letters.
      const exact = theirs.filter((t) => letters(t) === letters(ours))
      // A dictionary form with no mark at all can't adjudicate stress.
      const marked = exact.filter((t) => t.includes(ACUTE) || /ё/.test(t))
      if (!marked.length) continue
      // One vowel: they mark it, we don't. A notation gap, not a finding.
      if (monosyllabic(ours)) { out.monosyllabic++; continue }
      if (marked.some((t) => stressed(t) === stressed(ours))) out.stressAgree++
      else {
        out.stressDisagree++
        out.stress.push({ slot, ours, theirs: marked.join(' | ') })
      }
    } else {
      out.letterDisagree++
      out.letters.push({ slot, ours, theirs: theirs.join(' | ') })
    }
  }
  return out
}

/** gender / animacy / aspect / aspect-partner cross-checks. */
export function compareMeta(pos, word, row) {
  const disagree = []
  let checked = 0
  if (pos === 'nouns') {
    if (word.gender && row.gender) {
      checked++
      if (word.gender !== row.gender) {
        disagree.push({ field: 'gender', ours: word.gender, theirs: row.gender })
      }
    }
    if (word.animacy && row.animate !== '') {
      checked++
      const theirs = row.animate === '1' ? 'a' : 'i'
      if (word.animacy !== theirs) {
        disagree.push({ field: 'animacy', ours: word.animacy, theirs })
      }
    }
  }
  if (pos === 'verbs' && word.aspect && row.aspect) {
    checked++
    const theirs = row.aspect.startsWith('imp') ? 'impf' : 'pf'
    if (word.aspect !== theirs) {
      disagree.push({ field: 'aspect', ours: word.aspect, theirs })
    }
  }
  return { checked, disagree }
}

// ─── output ─────────────────────────────────────────────────────────────────

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : '—')

function print(report) {
  console.log('\nDictionary probe — corpus vs OpenRussian (CC BY-SA 4.0)\n')
  console.log('Headword coverage')
  console.log('  pos          words   matched   coverage')
  for (const [pos, s] of Object.entries(report.pos)) {
    console.log(`  ${pos.padEnd(11)} ${String(s.words).padStart(5)}   ${String(s.matched).padStart(7)}   ${pct(s.matched, s.words).padStart(8)}`)
  }

  console.log('\nCell agreement (sense-matched words only)')
  console.log('  pos           cells  compared   letters-agree       stress-agree')
  for (const [pos, s] of Object.entries(report.pos)) {
    console.log(
      `  ${pos.padEnd(11)} ${String(s.cells).padStart(6)}  ${String(s.compared).padStart(8)}   ` +
      `${pct(s.letterAgree, s.compared).padStart(7)} (${String(s.letterDisagree).padStart(3)} off)   ` +
      `${pct(s.stressAgree, s.stressAgree + s.stressDisagree).padStart(7)} (${String(s.stressDisagree).padStart(3)} off)`,
    )
  }

  console.log('\nExcluded from the rates above')
  console.log('  pos          monosyllabic   sense-doubt words   their cells')
  for (const [pos, s] of Object.entries(report.pos)) {
    console.log(
      `  ${pos.padEnd(11)} ${String(s.monosyllabic).padStart(12)}   ${String(s.senseDoubt).padStart(17)}   ${String(s.senseDoubtCells).padStart(11)}`,
    )
  }

  console.log('\nMetadata cross-check')
  for (const [pos, s] of Object.entries(report.pos)) {
    if (!s.metaChecked) continue
    console.log(`  ${pos.padEnd(11)} ${s.metaChecked} checked, ${s.metaDisagree} disagree`)
  }

  for (const [pos, s] of Object.entries(report.pos)) {
    if (s.samples.stress.length) {
      console.log(`\n${pos} — stress disagreements (${s.stressDisagree} total, showing ${s.samples.stress.length}):`)
      for (const m of s.samples.stress) console.log(`  ${m.key}  ${m.slot}: ours ${m.ours}   theirs ${m.theirs}`)
    }
    if (s.samples.letters.length) {
      console.log(`\n${pos} — letter disagreements (${s.letterDisagree} total, showing ${s.samples.letters.length}):`)
      for (const m of s.samples.letters) console.log(`  ${m.key}  ${m.slot}: ours ${m.ours}   theirs ${m.theirs}`)
    }
    if (s.samples.meta.length) {
      console.log(`\n${pos} — metadata disagreements (${s.metaDisagree} total, showing ${s.samples.meta.length}):`)
      for (const m of s.samples.meta) console.log(`  ${m.key}  ${m.field}: ours ${m.ours}   theirs ${m.theirs}`)
    }
    if (s.samples.senseDoubt.length) {
      console.log(`\n${pos} — sense-doubt (${s.senseDoubtCells} cells over ${s.senseDoubt} words, showing ${s.samples.senseDoubt.length}):`)
      for (const m of s.samples.senseDoubt) console.log(`  ${m.key}  ${m.slot}: ours ${m.ours}   theirs ${m.theirs}`)
    }
    if (s.unmatchedCount) {
      console.log(`\n${pos} — unmatched headwords (${s.unmatchedCount} total, showing ${s.unmatchedSample.length}):`)
      console.log(`  ${s.unmatchedSample.join(', ')}`)
    }
  }
  console.log()
}

async function main(args) {
  const flag = (name, fallback) => {
    const i = args.indexOf(name)
    return i === -1 ? fallback : args[i + 1]
  }
  if (args.includes('--fetch')) {
    await fetchAll()
    return
  }
  const report = probe({ samples: Number(flag('--samples', 25)) })
  print(report)
  const out = flag('--json', null)
  if (out) {
    fs.writeFileSync(out, JSON.stringify(report, null, 2))
    console.log(`full findings → ${out} (${report.findings.length} rows)`)
  }
}

// Importable for the unit test; only measures when run as a command.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2))
}
