#!/usr/bin/env node
/**
 * verify-review-replay.mjs — prove the committed proposals reproduce the corpus.
 *
 * `review/proposals/` is the audit trail for the translation review: it is
 * supposed to be the record of every change and why. That claim is only worth
 * anything if replaying the whole set onto the state the review started from
 * lands exactly on the committed YAML. Until #581 it did not — two proposals
 * touching one sentence each opened their own `en_alt:` block, producing a
 * duplicate mapping key, and the applier reported the invalid file and exited
 * 0, so a partial application looked like a complete one.
 *
 * This checks the property end to end:
 *   1. export the vocab as of <base> into a temp dir
 *   2. apply every proposal to it
 *   3. diff against the working tree's vocab
 *
 * Usage:
 *   node scripts/verify-review-replay.mjs [--base <ref>]
 *
 * Exits non-zero if the applier fails or any file differs.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, readdirSync, mkdirSync, cpSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repo = join(__dirname, '..')
const args = process.argv.slice(2)
const baseArg = args.indexOf('--base')

/**
 * The commit the proposals were written against.
 *
 * Read from `review/replay-base.txt` rather than derived. It used to be
 * `git merge-base origin/main HEAD`, which is correct while the review sits on
 * a branch and wrong the moment it merges: on main the merge base is main
 * itself, so the replay re-applies every proposal to a tree that already has
 * them. The 32 `fix-russian` rows then cannot find their sentences — their
 * Russian has been rewritten — and the check fails on data that is perfectly
 * fine. Main went red on exactly that after #581 landed.
 */
function replayBase() {
  if (baseArg >= 0 && args[baseArg + 1]) return args[baseArg + 1]
  const path = join(repo, 'review', 'replay-base.txt')
  if (!existsSync(path)) {
    console.error('review/replay-base.txt is missing — it names the commit the proposals were written against')
    process.exit(1)
  }
  const sha = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  if (!sha) {
    console.error('review/replay-base.txt names no commit')
    process.exit(1)
  }
  return sha
}
const base = replayBase()

// A base that is not behind HEAD cannot be a starting point for the replay: the
// tree it names already contains the changes we are about to apply. Catching it
// here says so, instead of surfacing as unmatched proposals a reader would
// reasonably mistake for corrupt data.
try {
  execFileSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: repo, stdio: 'ignore' })
} catch {
  console.error(`replay base ${base.slice(0, 8)} is not an ancestor of HEAD — it must name the state the review started from`)
  process.exit(1)
}
if (execFileSync('git', ['rev-parse', base], { cwd: repo, encoding: 'utf8' }).trim()
  === execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()) {
  console.error(`replay base ${base.slice(0, 8)} is HEAD itself — nothing would be replayed`)
  process.exit(1)
}

/**
 * Every line the review is responsible for, grouped by the word that owns it.
 *
 * Grouped, rather than compared as one flat list, because the corpus keeps
 * growing. A word added after the base — «аво́сь» arrived with #603 — exists in
 * the committed tree and not in the replay, and against a flat list that reads
 * as the review failing to reproduce itself. It is not: a word the review never
 * saw is not the review's to reproduce. So only keys present in *both* trees are
 * compared, and a key the replay produces but the corpus has lost is reported.
 *
 * This started as usage `ru`/`en_gb`/`en_alt` only, which let two whole classes
 * of change pass unchecked. `inflect:` was filtered out even though the
 * quarantine stage exists precisely to relocate those annotations — so a
 * hand-edited `token:` could differ from what the resolutions replayed and the
 * check would still say "exactly". Headword glosses were filtered out too, so
 * none of the gloss pass's widenings were covered.
 *
 * What remains excluded is genuinely outside the review's remit: declension and
 * conjugation cells, `cefr_level`, `aspect`, and the rest of a word's data. A
 * hand correction to a wrong paradigm cell must not read as the review failing
 * to reproduce itself.
 *
 * The word-key lines are kept as anchors: without them a block that moved could
 * line up against a different word's and compare equal.
 *
 * The *field* a line sits under is tracked rather than inferred from its
 * indentation. Indentation alone is ambiguous — a nested list item under any
 * new field lands at the same depth as a usage `en_alt:` entry, and would be
 * read as review content. `facts:` (#585) was the first field to collide, and
 * it is exactly the kind of thing this check must ignore: a hand-authored word
 * fact is no more the review's to reproduce than a conjugation cell is.
 */
const REVIEWED_FIELDS = new Set(['en_gb', 'usage'])

function reviewedByKey(text) {
  const out = new Map()
  let key = null
  let field = null
  for (const line of text.split('\n')) {
    const k = line.match(/^ {2}"([^"]+)":\s*$/)
    if (k) {
      key = k[1]
      field = null
      out.set(key, [])
      continue
    }
    if (!key) continue
    const f = line.match(/^ {4}([\w-]+):/)
    if (f) field = f[1]
    if (!REVIEWED_FIELDS.has(field)) continue
    if (
      /^ {4}en_gb:/.test(line) || // headword gloss block
      /^ {6}standard:/.test(line) ||
      /^ {6}alt:/.test(line) ||
      /^ {8}- /.test(line) || // headword alt items
      /^ {6}- ru:/.test(line) || // usage item
      /^ {8}en_gb:/.test(line) ||
      /^ {8}en_alt:/.test(line) ||
      /^ {8}inflect:/.test(line) ||
      /^ {10}- /.test(line) // usage alt items
    ) {
      out.get(key).push(line)
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n')]))
}

const work = mkdtempSync(join(tmpdir(), 'review-replay-'))
let failed = false
try {
  // 1. vocab as of the base
  execFileSync('git', ['archive', base, 'public/vocab'], { cwd: repo, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] })
  const tar = execFileSync('git', ['archive', base, 'public/vocab'], { cwd: repo, maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', work], { input: tar })

  // 2. the applier needs its own tree shape: scripts + review beside the vocab
  mkdirSync(join(work, 'scripts'), { recursive: true })
  for (const f of ['apply-translation-review.mjs', 'annotate-inflect.mjs']) {
    cpSync(join(repo, 'scripts', f), join(work, 'scripts', f))
  }
  cpSync(join(repo, 'review', 'proposals'), join(work, 'review', 'proposals'), { recursive: true })
  cpSync(join(repo, 'node_modules', 'js-yaml'), join(work, 'node_modules', 'js-yaml'), { recursive: true })

  const proposals = readdirSync(join(work, 'review', 'proposals'))
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join('review', 'proposals', f))
  if (!proposals.length) {
    console.error('no proposals to replay')
    process.exit(1)
  }
  execFileSync('node', [join('scripts', 'apply-translation-review.mjs'), ...proposals, '--apply'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  // Stage two: the Russian rewrites the first pass quarantines, re-annotated.
  // That stage is deterministic from the quarantine file the first pass just
  // wrote, so the two together are the whole pipeline — replaying only the
  // proposals would leave 24 sentences unfixed and report a false difference.
  cpSync(join(repo, 'scripts', 'apply-quarantined-russian.mjs'), join(work, 'scripts', 'apply-quarantined-russian.mjs'))
  // The hand-decided annotations for rewrites that change the token's slot —
  // part of the pipeline's input, not of the tree it is replayed onto.
  const resolutions = join(repo, 'review', 'quarantine-resolutions.jsonl')
  if (existsSync(resolutions)) cpSync(resolutions, join(work, 'review', 'quarantine-resolutions.jsonl'))
  execFileSync('node', [join('scripts', 'apply-quarantined-russian.mjs'), '--apply'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  // Stage three: the copyedit. The first pass judged fidelity — is the English
  // faithful to the Russian — and that is the wrong question for asking whether
  // the English is *English*, so some of its fixes landed as calques. The
  // copyedit revisits those, and it has to run last because it overrides the
  // first pass's `en_gb` on the same sentences. Keeping it as its own set of
  // proposals rather than editing the originals keeps both decisions on the
  // record: what the fidelity pass concluded, and what the copyedit changed.
  const copyeditDir = join(repo, 'review', 'copyedit')
  if (existsSync(copyeditDir)) {
    cpSync(copyeditDir, join(work, 'review', 'copyedit'), { recursive: true })
    const copyedits = readdirSync(join(work, 'review', 'copyedit'))
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join('review', 'copyedit', f))
    if (copyedits.length) {
      execFileSync('node', [join('scripts', 'apply-translation-review.mjs'), ...copyedits, '--apply'], {
        cwd: work,
        stdio: ['ignore', 'ignore', 'inherit'],
      })
    }
  }

  // Stage four: accepted alternates that are not renderings of their sentence
  // at all. Pre-existing data, but the widened word bank made them reachable,
  // so they are removed here rather than left to be offered as answers.
  const removals = join(repo, 'review', 'alt-removals.jsonl')
  if (existsSync(removals)) {
    cpSync(join(repo, 'scripts', 'apply-alt-removals.mjs'), join(work, 'scripts', 'apply-alt-removals.mjs'))
    cpSync(removals, join(work, 'review', 'alt-removals.jsonl'))
    execFileSync('node', [join('scripts', 'apply-alt-removals.mjs'), '--apply'], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }

  // Stage five: the gloss widenings. These are word-level, not sentence-level —
  // they append to a headword's `en_gb.alt` — so they are independent of the
  // three sentence stages and can run last. Without this stage the 89 widenings
  // were reproduced by nothing, and `reviewedLines` now compares the headword
  // gloss block, so an unreplayed one is a difference rather than a blind spot.
  const glossDir = join(repo, 'review', 'gloss')
  if (existsSync(glossDir)) {
    cpSync(join(repo, 'scripts', 'apply-gloss-review.mjs'), join(work, 'scripts', 'apply-gloss-review.mjs'))
    cpSync(glossDir, join(work, 'review', 'gloss'), { recursive: true })
    const glosses = readdirSync(join(work, 'review', 'gloss'))
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join('review', 'gloss', f))
    if (glosses.length) {
      execFileSync('node', [join('scripts', 'apply-gloss-review.mjs'), ...glosses, '--apply'], {
        cwd: work,
        stdio: ['ignore', 'ignore', 'inherit'],
      })
    }
  }

  // Stage six: the gloss-only entries a Russian rewrite makes necessary. These
  // land in glossary.yml, which used to be skipped by the comparison entirely.
  const additions = join(repo, 'review', 'glossary-additions.jsonl')
  if (existsSync(additions)) {
    cpSync(join(repo, 'scripts', 'apply-glossary-additions.mjs'), join(work, 'scripts', 'apply-glossary-additions.mjs'))
    cpSync(additions, join(work, 'review', 'glossary-additions.jsonl'))
    execFileSync('node', [join('scripts', 'apply-glossary-additions.mjs'), '--apply'], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }

  // Stage seven: the prompt-disambiguation pass (#601). It rewrites headword
  // gloss *parentheticals* and a few usage sentences — both fields this check
  // compares — and no earlier stage can express either: apply-gloss-review only
  // appends to `alt:`, and a `fix-russian` on an annotated sentence is
  // quarantined rather than applied. It runs last because its `en_gb` rewrites
  // sit on top of whatever the copyedit concluded.
  const promptFixes = join(repo, 'review', 'prompt-fixes.jsonl')
  if (existsSync(promptFixes)) {
    cpSync(join(repo, 'scripts', 'apply-prompt-fixes.mjs'), join(work, 'scripts', 'apply-prompt-fixes.mjs'))
    cpSync(promptFixes, join(work, 'review', 'prompt-fixes.jsonl'))
    execFileSync('node', [join('scripts', 'apply-prompt-fixes.mjs'), '--apply'], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }

  // 8. compare, word by word
  const vocabDir = join(repo, 'public', 'vocab')
  let compared = 0
  let added = 0
  for (const file of readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))) {
    const replayed = reviewedByKey(readFileSync(join(work, 'public', 'vocab', file), 'utf8'))
    const committed = reviewedByKey(readFileSync(join(vocabDir, file), 'utf8'))
    for (const [key, text] of replayed) {
      if (!committed.has(key)) {
        console.error(`  ✗ ${file}: ${key} was replayed but is no longer in the corpus`)
        failed = true
        continue
      }
      compared += 1
      if (text === committed.get(key)) continue
      const a = text.split('\n')
      const b = committed.get(key).split('\n')
      // Scan the longer side: when one is a prefix of the other (a block added
      // on one side only) scanning `a` alone finds no differing index and the
      // report reads "(nothing)" against "(nothing)".
      const at = Array.from({ length: Math.max(a.length, b.length) }).findIndex(
        (_, i) => a[i] !== b[i],
      )
      console.error(`  ✗ ${file}: ${key} differs`)
      console.error(`      replay:    ${a[at] ?? '(nothing)'}`)
      console.error(`      committed: ${b[at] ?? '(nothing)'}`)
      failed = true
    }
    for (const key of committed.keys()) if (!replayed.has(key)) added += 1
  }
  if (!failed) {
    console.log(`  ${compared} word(s) compared; ${added} added since the base and outside the review's remit`)
  }
} catch (err) {
  console.error(`replay failed: ${err.message}`)
  failed = true
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed) {
  console.error('\nThe committed proposals do NOT reproduce the committed vocab.')
  process.exit(1)
}
console.log(`✓ replaying review/proposals onto ${base.slice(0, 8)} reproduces the committed vocab exactly`)
