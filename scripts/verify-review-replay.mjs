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
import { mkdtempSync, readFileSync, rmSync, readdirSync, mkdirSync, cpSync } from 'fs'
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

  // 3. compare
  const vocabDir = join(repo, 'public', 'vocab')
  for (const file of readdirSync(vocabDir).filter((f) => f.endsWith('.yml'))) {
    const replayed = readFileSync(join(work, 'public', 'vocab', file), 'utf8')
    const committed = readFileSync(join(vocabDir, file), 'utf8')
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
