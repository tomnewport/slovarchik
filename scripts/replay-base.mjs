/**
 * replay-base.mjs — the commit the translation review's proposals were written
 * against.
 *
 * Read from `review/replay-base.txt` rather than derived. It used to be
 * `git merge-base origin/main HEAD`, which is correct while the review sits on
 * a branch and wrong the moment it merges: on main the merge base is main
 * itself, so a replay re-applies every proposal to a tree that already has
 * them. The 32 `fix-russian` rows then cannot find their sentences — their
 * Russian has been rewritten — and the check fails on data that is perfectly
 * fine. Main went red on exactly that after #581 landed.
 *
 * Shared by `verify-review-replay.mjs` (which replays the proposals onto that
 * tree) and `review-yield.mjs` (which re-derives the tiers the reviewers were
 * shown). Both must mean the same commit by "the state the review started
 * from", so there is one definition of it.
 */
import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * @param {string} repo  repository root
 * @param {string[]} args  argv slice; `--base <ref>` overrides the file
 * @returns {string} the ref naming the pre-review corpus
 */
export function replayBase(repo, args = []) {
  const i = args.indexOf('--base')
  if (i >= 0 && args[i + 1]) return args[i + 1]
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

/**
 * Fail early when the base cannot be a starting point: a tree that is not
 * behind HEAD already contains the changes we are about to replay onto it, and
 * that surfaces as unmatched proposals a reader would reasonably mistake for
 * corrupt data.
 */
export function assertUsableBase(repo, base) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: repo, stdio: 'ignore' })
  } catch {
    console.error(`replay base ${base.slice(0, 8)} is not an ancestor of HEAD — it must name the state the review started from`)
    process.exit(1)
  }
  const at = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' }).trim()
  if (at(base) === at('HEAD')) {
    console.error(`replay base ${base.slice(0, 8)} is HEAD itself — nothing would be replayed`)
    process.exit(1)
  }
}

/** Extract `public/vocab` as of `base` into `dest`, which must already exist. */
export function exportVocabAt(repo, base, dest) {
  const tar = execFileSync('git', ['archive', base, 'public/vocab'], { cwd: repo, maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', dest], { input: tar })
  return join(dest, 'public', 'vocab')
}
