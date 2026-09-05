#!/usr/bin/env node
/**
 * audit-translations.mjs — rank the example corpus for a translation review, and
 * cut the result into self-contained work packets.
 *
 * The scoring lives in `src/lib/translationAudit.js` (pure, unit-tested); this
 * script is the I/O around it: load the YAML, audit, print a report, and — with
 * `--shard` — write one JSON packet per reviewer covering a slice of the corpus.
 *
 * Packets are cut **by owner word, never mid-word**. A reviewer judging whether
 * «биле́т» should be rendered "exam question" in one sentence needs to see the
 * headword's gloss and its other examples in the same breath; splitting a word
 * across two packets loses exactly the context that makes the call decidable.
 *
 * Modes:
 *   --report              tier counts, signal breakdown, worst offenders
 *   --shard               write work packets to <outdir>
 *   --sample N            print N phrases from a tier (with --tier)
 *
 * Options:
 *   --tier high|medium|clean   restrict to one tier (default: high + medium)
 *   --outdir <path>            packet destination (default: review/packets)
 *   --per-packet N             target phrases per packet (default 150)
 *   --clean-sample N           extra clean-tier phrases to fold in (default 200)
 *   --seed N                   RNG seed for the clean sample (default 20260808)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load as yamlLoad } from 'js-yaml'
import { buildWords, shapePhrases, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { auditPhrases, tierCounts, aspectCollisions, duplicateEnglish, auditAlternates, normaliseEnglish } from '../src/lib/translationAudit.js'
import { tmpdir } from 'os'
import { replayBase, exportVocabAt } from './replay-base.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vocabDir = join(__dirname, '..', 'public', 'vocab')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

export function loadCorpus() {
  const files = readdirSync(vocabDir).filter((f) => f.endsWith('.yml')).sort()
  const docs = files
    .map((f) => ({
      pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')],
      file: f,
      doc: yamlLoad(readFileSync(join(vocabDir, f), 'utf8')),
    }))
    .filter((r) => r.pos)
  const words = buildWords(docs)
  const phrases = shapePhrases(words)
  return { docs, words, phrases }
}

/** Which vocab file each word key came from, so a packet can point at source. */
function fileByKey(docs) {
  const map = new Map()
  for (const { file, doc } of docs) {
    for (const key of Object.keys(doc?.words ?? {})) map.set(key, file)
  }
  return map
}

/** Deterministic PRNG (mulberry32) so a re-run picks the same clean sample. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const { docs, words, phrases } = loadCorpus()
const rows = auditPhrases(phrases, words)
const byKey = fileByKey(docs)
const wordByKey = new Map(words.map((w) => [w.key, w]))

if (flag('report') || args.length === 0) report()
if (flag('sample')) sample()
if (flag('collisions')) collisions()
if (flag('alternates')) alternates()
if (flag('duplicates')) duplicates()

/**
 * Every English wording a proposal *replaced* on the grounds that it was not
 * English — read off the corpus as it stood before the review, since a proposal
 * records what it wrote, not what it overwrote.
 *
 * An alternate matching one of these re-accepts, as a correct answer, the exact
 * string the review argued was not English. The applier refuses that at write
 * time now; nothing has ever checked the rows committed before the rule
 * existed. Returns an empty set outside a git checkout.
 */
function rejectedEnglish() {
  const repo = join(__dirname, '..')
  const out = new Set()
  if (!existsSync(join(repo, 'review', 'replay-base.txt'))) return out

  // A sentence can be retranslated more than once — the fidelity pass, then
  // the copyedit — so what a stage rejected is whatever the *previous* stage
  // left, not whatever the corpus started with. Only the first rewrite of a
  // sentence rejects the base tree's wording. Getting this wrong in either
  // direction is silent: too eager and it flags an alternate the review
  // deliberately restored (пропада́ть), too lax and it misses one the copyedit
  // has just ruled out (аппара́т).
  const history = new Map()
  for (const dir of ['proposals', 'copyedit']) {
    const path = join(repo, 'review', dir)
    if (!existsSync(path)) continue
    for (const f of readdirSync(path).filter((n) => n.endsWith('.jsonl')).sort()) {
      for (const line of readFileSync(join(path, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        const row = JSON.parse(line)
        if (row.verdict !== 'retranslate' || !row.en) continue
        const id = `${row.key}\u0000${row.ru}`
        if (!history.has(id)) history.set(id, [])
        history.get(id).push(row)
      }
    }
  }

  // Sentences whose *first* rewrite called the English unnatural: only those
  // need the base tree read for what they replaced.
  const fromBase = new Set()
  for (const [id, stages] of history) {
    stages.forEach((row, i) => {
      if (row.defect !== 'unnatural-english') return
      if (i === 0) fromBase.add(id)
      else out.add(normaliseEnglish(stages[i - 1].en))
    })
  }
  if (!fromBase.size) return out

  const work = mkdtempSync(join(tmpdir(), 'alt-audit-'))
  try {
    const dir = exportVocabAt(repo, replayBase(repo, []), work)
    const docs = readdirSync(dir)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => ({ pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')], file: f, doc: yamlLoad(readFileSync(join(dir, f), 'utf8')) }))
      .filter((r) => r.pos)
    for (const p of shapePhrases(buildWords(docs))) {
      if (fromBase.has(`${p.source}\u0000${p.ru}`)) out.add(normaliseEnglish(p.en))
    }
  } catch {
    // Not a git checkout, or the base is gone. The other signals stand alone.
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return out
}

/**
 * The accepted alternate renderings, worst first.
 *
 * `--unread` narrows it to alternates no committed proposal wrote — the ones
 * that predate the review and were therefore never shown to any reviewer,
 * which is the gap #599 actually names. The rest each arrived with a note.
 */
function alternates() {
  const repo = join(__dirname, '..')
  const proposed = new Set()
  for (const dir of ['proposals', 'copyedit']) {
    const path = join(repo, 'review', dir)
    if (!existsSync(path)) continue
    for (const f of readdirSync(path).filter((n) => n.endsWith('.jsonl'))) {
      for (const line of readFileSync(join(path, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        const row = JSON.parse(line)
        for (const alt of row.en_alt ?? []) proposed.add(`${row.key}\u0000${normaliseEnglish(alt)}`)
      }
    }
  }

  const withAlt = phrases.filter((p) => p.enAlt?.length)
  const total = withAlt.reduce((s, p) => s + p.enAlt.length, 0)
  const unreadOnly = flag('unread')
  const scored = auditAlternates(phrases, { words, rejected: rejectedEnglish() })
  const unread = (r) => !proposed.has(`${r.key}\u0000${normaliseEnglish(r.alt)}`)
  const neverRead = withAlt.flatMap((p) => p.enAlt.map((alt) => ({
    key: p.source, ru: p.ru, en: p.en, alt, overlap: 1, signals: [],
  }))).filter(unread)

  // `--unread` lists every alternate no proposal wrote, signal or not. Being
  // unread is itself the reason to read it: the signals rank the 3,200 the
  // review authored, where a per-row note already exists to fall back on.
  let found = scored
  if (unreadOnly) {
    const byRow = new Map(scored.map((r) => [`${r.key}\u0000${r.alt}`, r]))
    found = neverRead.map((r) => byRow.get(`${r.key}\u0000${r.alt}`) ?? r)
      .sort((a, b) => b.signals.length - a.signals.length || a.key.localeCompare(b.key))
  }

  console.log(`\n${total} accepted alternate(s) across ${withAlt.length} phrases; ${neverRead.length} never shown to a reviewer`)
  const bySignal = {}
  for (const r of found) for (const sig of r.signals) bySignal[sig] = (bySignal[sig] ?? 0) + 1
  console.log(unreadOnly
    ? `listing all ${found.length} unread; ${found.filter((r) => r.signals.length).length} of them trip a signal: ${JSON.stringify(bySignal)}`
    : `${found.length} tripped a signal: ${JSON.stringify(bySignal)}`)
  for (const r of found.slice(0, Number(opt('show', 25)) || 25)) {
    console.log(`\n  [${r.signals.join(' ') || '—'}] overlap ${r.overlap}  ${r.key}`)
    console.log(`    ru      ${r.ru}`)
    console.log(`    en      ${r.en}`)
    console.log(`    accepts ${r.alt}`)
    for (const ru of r.alsoTranslates ?? []) console.log(`    also    ${ru}`)
  }
  console.log()
}

/**
 * Distinct Russian sentences that share one English translation — any drill
 * prompting from that English has two right answers.
 */
function duplicates() {
  const found = duplicateEnglish(phrases)
  console.log(`\nEnglish translations shared by 2+ distinct Russian sentences: ${found.length}`)
  for (const d of found) {
    console.log(`\n  "${d.en}"`)
    for (const p of d.phrases) console.log(`    ${p.ru}   [${p.source}]`)
  }
}
if (flag('shard')) shard()

/**
 * Aspect/motion pairs whose two members are rendered by the same English. The
 * contrast drill shows that English and asks which verb it is, so a collision
 * is a question with two right answers (#576).
 */
function collisions() {
  const found = aspectCollisions(words, phrases)
  const identical = found.filter((c) => c.severity === 'identical')
  console.log(`\naspect-pair collisions: ${identical.length} identical English, ${found.length - identical.length} matching verb frame only`)
  const show = flag('all') ? found : identical
  for (const c of show) {
    console.log(`\n  ${c.pair}  — both read "${c.rendering}"`)
    console.log(`    ${c.a.key}\n      ${c.a.ru}\n      ${c.a.en}`)
    console.log(`    ${c.b.key}\n      ${c.b.ru}\n      ${c.b.en}`)
  }
}

function report() {
  const counts = tierCounts(rows)
  const mean = rows.reduce((s, r) => s + r.literalness, 0) / rows.length
  console.log(`phrases: ${rows.length}   words: ${words.length}`)
  console.log(`mean literalness: ${mean.toFixed(3)}\n`)
  console.log('tiers:')
  for (const t of ['high', 'medium', 'clean']) {
    const pct = ((counts[t] / rows.length) * 100).toFixed(1)
    console.log(`  ${t.padEnd(7)} ${String(counts[t]).padStart(6)}  ${pct.padStart(5)}%`)
  }
  console.log('\nsignals (phrases tripping each):')
  const sig = [
    ['ungloss-able token', (r) => r.unglossed.length > 0],
    ['literalness <= 0.5', (r) => r.content >= 3 && r.literalness <= 0.5],
    ['>=3 gloss misses', (r) => r.glossMisses.length >= 3],
    ['>=2 gloss misses', (r) => r.glossMisses.length >= 2],
    ['>=2 added English', (r) => r.addedEnglish.length >= 2],
    ['clause marker in RU', (r) => r.commas > 0 || r.dash || r.colon],
    ['length ratio > 1.8', (r) => r.lengthRatio > 1.8],
  ]
  for (const [label, test] of sig) {
    console.log(`  ${label.padEnd(22)} ${String(rows.filter(test).length).padStart(6)}`)
  }
  console.log('\nby source file:')
  const perFile = new Map()
  for (const r of rows) {
    const f = byKey.get(r.source) ?? '?'
    if (!perFile.has(f)) perFile.set(f, { high: 0, medium: 0, clean: 0 })
    perFile.get(f)[r.tier] += 1
  }
  for (const [f, c] of [...perFile].sort((a, b) => b[1].high - a[1].high)) {
    console.log(`  ${f.padEnd(18)} high ${String(c.high).padStart(5)}  med ${String(c.medium).padStart(5)}  clean ${String(c.clean).padStart(5)}`)
  }
}

function sample() {
  const tier = opt('tier', 'high')
  const n = Number(opt('sample', 20)) || 20
  console.log(`\n--- ${n} phrases, tier=${tier} ---`)
  for (const r of rows.filter((x) => x.tier === tier).slice(0, n)) {
    console.log(`\n[${r.priority.toFixed(1)} lit=${r.literalness.toFixed(2)}] ${r.ru}\n    ${r.en}`)
    if (r.glossMisses.length) console.log(`    unaligned RU: ${r.glossMisses.map((m) => `${m.ru}→${m.gloss.split('(')[0].trim()}`).join(', ')}`)
    if (r.unglossed.length) console.log(`    NO GLOSS: ${r.unglossed.join(', ')}`)
    if (r.addedEnglish.length) console.log(`    added EN: ${r.addedEnglish.join(', ')}`)
  }
}

function shard() {
  const outdir = opt('outdir', join(__dirname, '..', 'review', 'packets'))
  const perPacket = Number(opt('per-packet', 150)) || 150
  const cleanSample = Number(opt('clean-sample', 200)) || 200
  const seed = Number(opt('seed', 20260808)) || 20260808

  // Fold a deterministic clean-tier sample into the queue, so the review also
  // measures how much the heuristics miss rather than only confirming them.
  const clean = rows.filter((r) => r.tier === 'clean')
  const rand = rng(seed)
  const picked = new Set()
  while (picked.size < Math.min(cleanSample, clean.length)) {
    picked.add(Math.floor(rand() * clean.length))
  }
  // An aspect collision is a property of a *pair* of sentences, so it can't be
  // derived from the phrase a reviewer is looking at. Index it by sentence and
  // carry it into the packet, or the reviewer has no way to see it.
  const collisionsByRu = new Map()
  for (const c of aspectCollisions(words, phrases)) {
    for (const [side, other] of [[c.a, c.b], [c.b, c.a]]) {
      if (!collisionsByRu.has(side.ru)) collisionsByRu.set(side.ru, [])
      collisionsByRu.get(side.ru).push({
        severity: c.severity,
        rendering: c.rendering,
        partnerKey: other.key,
        partnerRu: other.ru,
        partnerEn: other.en,
      })
    }
  }

  const inScope = new Set()
  for (const r of rows) if (r.tier !== 'clean') inScope.add(r.source)
  for (const i of picked) inScope.add(clean[i].source)
  // A colliding sentence needs reviewing whatever its own signals say — the
  // defect is in the pair, and neither half looks wrong on its own.
  for (const r of rows) if (collisionsByRu.has(r.ru)) inScope.add(r.source)

  // Group every phrase of an in-scope word — including its clean ones, which
  // are the baseline a reviewer judges the flagged siblings against.
  const groups = new Map()
  for (const r of rows) {
    if (!inScope.has(r.source)) continue
    if (!groups.has(r.source)) groups.set(r.source, [])
    groups.get(r.source).push(r)
  }

  // Order words by file then headword so a packet is a contiguous, reviewable
  // slice of one vocab file rather than a scatter across the corpus.
  const ordered = [...groups.keys()].sort((a, b) => {
    const fa = byKey.get(a) ?? ''
    const fb = byKey.get(b) ?? ''
    return fa.localeCompare(fb) || a.localeCompare(b, 'ru')
  })

  mkdirSync(outdir, { recursive: true })
  const packets = []
  let current = []
  let count = 0
  const flush = () => {
    if (!current.length) return
    packets.push(current)
    current = []
    count = 0
  }
  for (const key of ordered) {
    const group = groups.get(key)
    // Never split a word across packets; start a new one if this would overflow.
    if (count && count + group.length > perPacket) flush()
    const word = wordByKey.get(key)
    current.push({
      key,
      file: byKey.get(key) ?? '',
      pos: word?.pos ?? '',
      headword: word?.headword ?? word?.ru ?? '',
      gloss: word?.meaning ?? word?.en ?? '',
      cefr: word?.cefr ?? '',
      phrases: group.map((r) => ({
        ru: r.ru,
        en: r.en,
        // What this sentence already accepts. Omitted from the first sweep,
        // so 3,351 accepted answers were never read by anyone (#599) — and a
        // reviewer proposing an `add-alt` could not see it was already there.
        ...(r.enAlt.length ? { en_alt: r.enAlt } : {}),
        tier: r.tier,
        priority: Number(r.priority.toFixed(2)),
        literalness: Number(r.literalness.toFixed(2)),
        signals: {
          unalignedRussian: r.glossMisses.map((m) => ({ token: m.ru, gloss: m.gloss })),
          unglossed: r.unglossed,
          addedEnglish: r.addedEnglish,
          clauseMarkers: r.commas + (r.dash ? 1 : 0) + (r.colon ? 1 : 0),
          lengthRatio: Number(r.lengthRatio.toFixed(2)),
        },
        ...(collisionsByRu.has(r.ru) ? { aspectCollisions: collisionsByRu.get(r.ru) } : {}),
      })),
    })
    count += group.length
  }
  flush()

  packets.forEach((entries, i) => {
    const id = String(i + 1).padStart(3, '0')
    const phraseCount = entries.reduce((s, e) => s + e.phrases.length, 0)
    const files = [...new Set(entries.map((e) => e.file))]
    writeFileSync(
      join(outdir, `packet-${id}.json`),
      `${JSON.stringify({ packet: id, files, words: entries.length, phrases: phraseCount, entries }, null, 2)}\n`,
    )
  })
  const total = packets.reduce((s, p) => s + p.reduce((t, e) => t + e.phrases.length, 0), 0)
  console.log(`wrote ${packets.length} packets (${total} phrases, ${ordered.length} words) → ${outdir}`)
}
