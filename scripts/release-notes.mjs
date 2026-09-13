// What changed, in the words the commits were written in.
//
// The Data screen tells a learner that a newer version is deployed; this is
// what says what is *in* it. There is no changelog file and no tags in this
// repo — the commit subjects are the changelog, written one per merged PR and
// in the imperative ("Say what slipped, and what would win it back"), which is
// already the register release notes want. Deriving them at build time keeps
// the two from drifting: a note exists because a commit does.
//
// The build writes them into `version.json` alongside the commit and the
// release date, each with the date it landed. That date is what lets a client
// slice the list at its own release timestamp and show only what is new *to
// it* — the deployment publishes a window of recent changes and every install
// takes the part it hasn't got. See src/lib/appVersion.js.

import { execSync } from 'node:child_process'

/** How many commits to publish. Twenty is a few weeks of this repo's pace. */
export const DEFAULT_LIMIT = 20

/**
 * Drop the trailing PR/issue references a squash merge appends.
 *
 * `Build the form index once and warm it before the drill (#697) (#706)` is two
 * of them. They are useful in a git log and noise on a screen that is telling
 * someone what is new in their Russian practice app.
 *
 * @param {string} subject
 * @returns {string}
 */
export function cleanSubject(subject) {
  return subject.replace(/(\s*\(#\d+\))+\s*$/, '').trim()
}

/**
 * Whether a commit subject is worth showing a learner.
 *
 * Dependabot's `Bump …` subjects are the one category that is reliably not a
 * change to the app as anyone using it experiences it. Everything else is kept:
 * a heuristic that guesses at "is this a feature?" would quietly drop real work
 * the moment someone phrased a subject unusually, and a missing note is worse
 * than a dull one.
 *
 * @param {string} subject
 * @returns {boolean}
 */
export function noteworthy(subject) {
  if (!subject) return false
  return !/^Bump /.test(subject)
}

/**
 * Parse `git log --format=%cI\t%s` output into notes, newest first.
 *
 * @param {string} stdout
 * @returns {{ at: string, text: string }[]}
 */
export function parseLog(stdout) {
  const notes = []
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const at = line.slice(0, tab).trim()
    const subject = line.slice(tab + 1).trim()
    if (!at || !noteworthy(subject)) continue
    const text = cleanSubject(subject)
    if (text) notes.push({ at, text })
  }
  return notes
}

/**
 * Recent changes from the git log, newest first.
 *
 * Returns an empty list rather than throwing when there is no git to ask (a
 * tarball, a Docker build without the history): the Versions card degrades to
 * what it said before, which is a version with no notes rather than a failure.
 *
 * @param {{ limit?: number, cwd?: string }} [options]
 * @returns {{ at: string, text: string }[]}
 */
export function releaseNotes({ limit = DEFAULT_LIMIT, cwd } = {}) {
  try {
    // A few more than `limit`, because the filter above removes some.
    const raw = execSync(`git log --no-merges -n ${limit * 2} --format=%cI%x09%s`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseLog(raw).slice(0, limit)
  } catch {
    return []
  }
}
