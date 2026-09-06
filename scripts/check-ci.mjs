#!/usr/bin/env node
/**
 * check-ci.mjs — run, locally, exactly what CI's `test` job runs.
 *
 * `npm test` green is not CI green (#655): three corpus gates —
 * `verify:review`, `check:inflect:cases`, `check:prompts` — run only in
 * `.github/workflows/ci.yml`, so the documented pre-push ritual (test, lint,
 * build) can pass on a change CI rejects. This is the one command that gives
 * the same verdict, in the same order, stopping at the first failure the way
 * the job does.
 *
 * Usage:
 *   node scripts/check-ci.mjs            # the whole `test` job (minutes)
 *   node scripts/check-ci.mjs --corpus   # the three corpus gates only (~5s)
 *   node scripts/check-ci.mjs --list     # print the steps, run nothing
 *
 * `STEPS` below must stay in step with the workflow: `check-ci.test.mjs` reads
 * ci.yml and fails if the two lists diverge, so a step added to CI without a
 * line here is a red test rather than a silent gap.
 */
import { spawnSync } from 'child_process'
import { readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The workflow guard `hashFiles('review/proposals/*.jsonl') != ''`. */
function hasReviewProposals() {
  try {
    return readdirSync(join(repo, 'review/proposals')).some((f) => f.endsWith('.jsonl'))
  } catch {
    return false
  }
}

/**
 * Every `npm` step of the CI `test` job, in order.
 *
 * `corpus: true` marks the gates that exist nowhere else — they read the vocab
 * YAML, they fail the build, and they are the ones a corpus change is most
 * likely to trip. Everything in this list is a gate; the worklist scripts
 * (`check:stress`, `check:morph`, `audit:*`, `coverage:facts`,
 * `promote:glossary`) report findings for a human to work down and are
 * deliberately absent.
 */
export const STEPS = [
  { script: 'lint', corpus: false, why: 'eslint correctness rules' },
  {
    script: 'verify:review',
    corpus: true,
    why: 'replaying review/proposals reproduces the committed vocab',
    skipWhen: () => !hasReviewProposals(),
    skipNote: 'no review/proposals/*.jsonl',
  },
  {
    script: 'check:inflect:cases',
    corpus: true,
    why: 'each inflect: annotation agrees with the case its preposition governs',
  },
  {
    script: 'check:prompts',
    corpus: true,
    why: 'no growth in English prompts that pick out more than one Russian sentence',
  },
  { script: 'test:coverage', corpus: false, why: 'the unit suite + the per-layer coverage ratchet' },
  { script: 'build', corpus: false, why: 'the production build' },
]

function runStep(step) {
  const started = Date.now()
  console.log(`\n\x1b[1m→ npm run ${step.script}\x1b[0m — ${step.why}`)
  const res = spawnSync('npm', ['run', step.script], {
    cwd: repo,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  return { ok: res.status === 0, secs }
}

export function main(argv = process.argv.slice(2)) {
  const corpusOnly = argv.includes('--corpus')
  const steps = corpusOnly ? STEPS.filter((s) => s.corpus) : STEPS

  if (argv.includes('--list')) {
    for (const s of steps) console.log(`npm run ${s.script}  — ${s.why}`)
    return
  }

  const label = corpusOnly ? "the CI test job's corpus gates" : "CI's `test` job"
  console.log(`Running ${label}: ${steps.map((s) => s.script).join(', ')}`)

  const done = []
  for (const step of steps) {
    if (step.skipWhen?.()) {
      console.log(`\n\x1b[1m→ npm run ${step.script}\x1b[0m — skipped (${step.skipNote})`)
      done.push(`  - ${step.script}: skipped (${step.skipNote})`)
      continue
    }
    const { ok, secs } = runStep(step)
    done.push(`  ${ok ? '✓' : '✗'} ${step.script} (${secs}s)`)
    if (!ok) {
      // CI stops at the first failing step; so do we, or the verdict differs.
      console.error(`\n${done.join('\n')}`)
      console.error(`\n✗ \`npm run ${step.script}\` failed — CI would fail here too.`)
      process.exitCode = 1
      return
    }
  }
  console.log(`\n${done.join('\n')}`)
  console.log(`\n✓ ${corpusOnly ? 'corpus gates pass' : "CI's test job would pass"}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
