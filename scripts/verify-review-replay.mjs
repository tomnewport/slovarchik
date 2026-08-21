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
// The review branched from the merge base with main; that is the state the
// proposals were written against.
const base = baseArg >= 0 && args[baseArg + 1]
  ? args[baseArg + 1]
  : execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()

/**
 * Every line the review is responsible for.
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
 */
function reviewedLines(text) {
  return text
    .split('\n')
    .filter(
      (l) =>
        /^ {2}"[^"]+":\s*$/.test(l) || // word key — anchors everything below it
        /^ {4}en_gb:/.test(l) || // headword gloss block
        /^ {6}standard:/.test(l) ||
        /^ {6}alt:/.test(l) ||
        /^ {8}- /.test(l) || // headword alt items
        /^ {6}- ru:/.test(l) || // usage item
        /^ {8}en_gb:/.test(l) ||
        /^ {8}en_alt:/.test(l) ||
        /^ {8}inflect:/.test(l) ||
        /^ {10}- /.test(l), // usage alt items
    )
    .join('\n')
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

  // 7. compare
  const vocabDir = join(repo, 'public', 'vocab')
  for (const file of readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))) {
    const replayed = reviewedLines(readFileSync(join(work, 'public', 'vocab', file), 'utf8'))
    const committed = reviewedLines(readFileSync(join(vocabDir, file), 'utf8'))
    if (replayed !== committed) {
      const a = replayed.split('\n')
      const b = committed.split('\n')
      const at = a.findIndex((line, i) => line !== b[i])
      console.error(`  ✗ ${file} differs (first at line ${at + 1})`)
      console.error(`      replay:    ${a[at]}`)
      console.error(`      committed: ${b[at]}`)
      failed = true
    }
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
