// Run the `checkJs` probe over the logic layers and hold the error count to a
// ratchet (#666).
//
// The probe is `jsconfig.json`: a non-strict `tsc --checkJs` over src/lib,
// src/stores and src/composables — the same three layers coverage is measured
// over (#535), for the same reason. It is deliberately NOT a TypeScript
// migration; `strict` is off and `.vue` files are untouched.
//
// It began as a ratchet rather than a clean gate, because the JSDoc had already
// drifted and the count was 92 on the day the probe landed. A gate that fails
// from its first commit teaches everyone to bypass it, so this failed only when
// the count *grew*, and said so out loud when it dropped — a baseline nobody
// lowers is a baseline nobody believes. The baseline is empty now, which makes
// it an ordinary gate; the ratchet machinery stays because it is what will
// report the next regression by file and by name.
//
// The ceiling is per file, not one total. A single number lets a new error in
// one module hide behind a fix in another, which is the failure mode that makes
// people stop trusting a ratchet; per file, the run names what regressed.
//
// The errors themselves are the point, not the number: each one is a `@param`
// or `@returns` block that no longer describes its function, in a layer whose
// doc blocks are the contract callers read.

import { readFileSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = resolve(ROOT, 'scripts/typecheck-baseline.json')

/** Every `path(line,col): error TSxxxx: message` line tsc printed. */
export function parseErrors(stdout) {
  return stdout
    .split('\n')
    .filter((line) => /error TS\d+:/.test(line))
    .map((line) => line.trim())
}

/** `{ 'src/lib/foo.js': 3, … }`, most errors first. */
export function byFile(errors) {
  const counts = new Map()
  for (const error of errors) {
    const file = /^(.*?)\(\d+,\d+\)/.exec(error)?.[1] ?? '(no file)'
    counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/** `{ TS2339: 40, … }`, most frequent first. */
export function byCode(errors) {
  const counts = new Map()
  for (const error of errors) {
    const code = /error (TS\d+):/.exec(error)?.[1] ?? 'TS?'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export function summarise(errors, max) {
  const lines = ['## Typecheck (`tsc --checkJs`, non-strict)', '']
  lines.push(`**${errors.length}** errors against a ceiling of **${max}**.`, '')
  if (errors.length) {
    lines.push('| file | errors |', '| --- | ---: |')
    for (const [file, n] of byFile(errors).slice(0, 15)) lines.push(`| \`${file}\` | ${n} |`)
    lines.push('', `By code: ${byCode(errors).map(([c, n]) => `${c} ×${n}`).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Compare per-file counts against the committed ceiling.
 * @param {Map<string, number>|[string, number][]} counts errors per file now
 * @param {Record<string, number>} ceiling the committed per-file allowance
 * @returns {{ grown: {file: string, was: number, now: number}[],
 *             shrunk: {file: string, was: number, now: number}[] }}
 */
export function compare(counts, ceiling) {
  const now = new Map(counts)
  const grown = []
  const shrunk = []
  for (const file of new Set([...now.keys(), ...Object.keys(ceiling)])) {
    const was = ceiling[file] ?? 0
    const is = now.get(file) ?? 0
    if (is > was) grown.push({ file, was, now: is })
    else if (is < was) shrunk.push({ file, was, now: is })
  }
  grown.sort((a, b) => b.now - b.was - (a.now - a.was))
  shrunk.sort((a, b) => a.file.localeCompare(b.file))
  return { grown, shrunk }
}

function main() {
  const { files: ceiling } = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const maxErrors = Object.values(ceiling).reduce((a, b) => a + b, 0)
  const tsc = spawnSync('npx', ['tsc', '-p', 'jsconfig.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  // tsc exits non-zero when it reports errors, which is the normal case here;
  // a missing binary or a broken config is the failure we cannot continue past.
  if (tsc.error) {
    console.error(`[typecheck] could not run tsc: ${tsc.error.message}`)
    process.exit(1)
  }
  const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
  const errors = parseErrors(output)
  if (!errors.length && tsc.status !== 0) {
    console.error('[typecheck] tsc failed without reporting a typed error:')
    console.error(output.trim())
    process.exit(1)
  }

  const summary = summarise(errors, maxErrors)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
  console.log(summary)

  const counts = byFile(errors)
  const { grown, shrunk } = compare(counts, ceiling)

  if (grown.length) {
    console.error(
      '\n[typecheck] a JSDoc block no longer describes its function. ' +
        'These files report more errors than the ceiling allows:',
    )
    for (const { file, was, now } of grown) {
      console.error(`\n  ${file}: ${was} -> ${now}`)
      for (const error of errors.filter((e) => e.startsWith(`${file}(`))) {
        console.error(`    ${error}`)
      }
    }
    console.error(
      '\nFix the block, or — if the error is a genuine TS narrowing quirk on ' +
        'correct JS — annotate it with a reason, as src/types/globals.d.ts does.',
    )
    process.exit(1)
  }
  if (shrunk.length) {
    console.log(`\n[typecheck] ${maxErrors - errors.length} fewer than the ceiling allows:`)
    for (const { file, was, now } of shrunk) console.log(`  ${file}: ${was} -> ${now}`)
    console.log('Update scripts/typecheck-baseline.json so the gain is held.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
