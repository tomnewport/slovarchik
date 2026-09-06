import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load as yamlLoad } from 'js-yaml'

import { STEPS } from './check-ci.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')

/** The `npm` steps of the CI `test` job, in order, as script names. */
function ciTestJobScripts() {
  const wf = yamlLoad(read('.github/workflows/ci.yml'))
  return wf.jobs.test.steps
    .filter((s) => typeof s.run === 'string' && /^npm\s/.test(s.run.trim()))
    .map((s) => s.run.trim())
    .filter((run) => run !== 'npm ci') // installing deps is not a check
    .map((run) => (run === 'npm test' ? 'test' : run.replace(/^npm run\s+/, '')))
}

describe('check-ci mirrors the workflow', () => {
  // The whole point of #655: a check that runs only in ci.yml is a check
  // nobody runs before pushing. Adding a step to the job without a line in
  // STEPS re-opens that gap, so fail here instead.
  it('lists exactly the CI test job steps, in order', () => {
    expect(STEPS.map((s) => s.script)).toEqual(ciTestJobScripts())
  })

  it('mirrors each conditional step with a local guard', () => {
    const wf = yamlLoad(read('.github/workflows/ci.yml'))
    const conditional = new Set(
      wf.jobs.test.steps
        .filter((s) => typeof s.run === 'string' && s.if)
        .map((s) => s.run.trim().replace(/^npm run\s+/, '')),
    )
    for (const step of STEPS) {
      expect(Boolean(step.skipWhen), `${step.script} skipWhen`).toBe(conditional.has(step.script))
    }
  })

  it('marks the gates that run nowhere but CI as corpus gates', () => {
    expect(STEPS.filter((s) => s.corpus).map((s) => s.script)).toEqual([
      'verify:review',
      'check:inflect:cases',
      'check:prompts',
    ])
  })
})

describe('the docs name every check CI runs', () => {
  const commandsBlock = () => {
    const md = read('AGENTS.md')
    const block = md.match(/## Commands\n+```bash\n([\s\S]*?)```/)
    expect(block, 'AGENTS.md Commands block').toBeTruthy()
    return block[1]
  }

  it('lists every CI step in the AGENTS.md Commands block', () => {
    const commands = commandsBlock()
    for (const step of STEPS) {
      expect(commands, `npm run ${step.script}`).toContain(`npm run ${step.script}`)
    }
  })

  it('offers the aggregate that reproduces the CI verdict', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['check:ci']).toBeTruthy()
    expect(pkg.scripts['check:corpus']).toBeTruthy()
    expect(commandsBlock()).toContain('npm run check:ci')
  })
})
