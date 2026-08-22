#!/usr/bin/env node
/**
 * gloss-packets.mjs — turn the translation review's `gloss-mismatch` flags into
 * work packets for a gloss-widening pass.
 *
 * The sentence review kept finding the same shape: the English of a sentence is
 * right, and the *headword gloss* is too narrow for it. «кран» is glossed "tap"
 * but one of its own examples is a construction crane; «листо́к» is glossed
 * "leaf" but every one of its sentences is a sheet of paper. Those were left as
 * `flag` on purpose — the fix belongs in the word's `en_gb`, where it changes
 * every drill the word appears in, and that should be deliberate rather than a
 * side effect of editing a sentence.
 *
 * A gloss is widened by adding to `en_gb.alt`, never by editing the key: the
 * key is the word's identity and the progress store is keyed on it. See
 * public/vocab/CONTRIBUTING.md.
 *
 * Each packet carries, per flagged word: its key, part of speech, current
 * `standard` and `alt` glosses, every usage sentence it owns with its English,
 * and the reviewers' notes explaining the flag. All of that is needed — deciding
 * whether a sense is genuinely missing means reading every sentence the word is
 * responsible for, not just the flagged one.
 *
 * Usage:
 *   node scripts/gloss-packets.mjs [--outdir review/gloss] [--per-packet 40]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repo = join(__dirname, '..')
const vocabDir = join(repo, 'public', 'vocab')
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const outdir = opt('outdir', join(repo, 'review', 'gloss'))
const perPacket = Number(opt('per-packet', 40)) || 40

// Collect every gloss-mismatch finding, whatever verdict carried it — reviewers
// recorded some as `keep` with the defect set, since the sentence needed no edit.
const findings = new Map() // key → [{ru, en, note}]
const proposalsDir = join(repo, 'review', 'proposals')
for (const file of readdirSync(proposalsDir).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of readFileSync(join(proposalsDir, file), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    if (row.defect !== 'gloss-mismatch') continue
    if (!findings.has(row.key)) findings.set(row.key, [])
    findings.get(row.key).push({ ru: row.ru, note: row.note ?? '', verdict: row.verdict })
  }
}

const VOCAB = ['adjectives', 'adverbs', 'calendar', 'conjunctions', 'interjections', 'nouns', 'numerals', 'prepositions', 'pronouns', 'verbs']
const entries = []
for (const name of VOCAB) {
  const doc = yaml.load(readFileSync(join(vocabDir, `${name}.yml`), 'utf8'))
  for (const [key, word] of Object.entries(doc?.words ?? {})) {
    const notes = findings.get(key)
    if (!notes) continue
    entries.push({
      key,
      file: `${name}.yml`,
      cefr: word.cefr_level ?? '',
      aspect: word.aspect ?? undefined,
      gloss: {
        standard: word.en_gb?.standard ?? '',
        alt: word.en_gb?.alt ?? [],
      },
      // Every sentence the word owns — the flagged one is only the trigger.
      usage: (word.usage ?? []).map((u) => ({ ru: u.ru, en: u.en_gb })),
      flags: notes,
    })
  }
}

entries.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key, 'ru'))
mkdirSync(outdir, { recursive: true })
const packets = []
for (let i = 0; i < entries.length; i += perPacket) packets.push(entries.slice(i, i + perPacket))
packets.forEach((words, i) => {
  const id = String(i + 1).padStart(2, '0')
  writeFileSync(
    join(outdir, `gloss-${id}.json`),
    `${JSON.stringify({ packet: id, words: words.length, entries: words }, null, 2)}\n`,
  )
})
const missing = [...findings.keys()].filter((k) => !entries.some((e) => e.key === k))
console.log(`${entries.length} flagged words → ${packets.length} packet(s) in ${outdir}`)
if (missing.length) console.log(`  (${missing.length} flagged key(s) not found in the vocab: ${missing.slice(0, 5).join(', ')})`)
