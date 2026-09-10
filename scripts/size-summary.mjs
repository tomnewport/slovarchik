// Measure the shipped payload against the committed budget (#669).
//
// The counterpart to coverage-summary.mjs, and deliberately built the same way:
// a pure render function over a plain measurement object, a main() that reads
// the real artefacts, and a markdown table appended to $GITHUB_STEP_SUMMARY
// (falling back to stdout locally).
//
// The one difference is that this *gates*. Coverage is enforced by the
// thresholds in vite.config.js and that script only publishes; here the budget
// lives in scripts/size-budget.json and this script is what fails the run. The
// table is written before the exit code is set, so a breach always arrives with
// the numbers that explain it rather than a bare non-zero exit.
//
// Reads dist/, so it must run after `npm run build`.

import { readFileSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

/** Gzipped size of a file, in bytes — what actually crosses the network. */
function gzipBytes(path) {
  return gzipSync(readFileSync(path)).length
}

/**
 * The entry assets, as index.html actually references them.
 *
 * Read out of the built HTML rather than matched by filename: the names carry
 * content hashes, and an entry renamed by a Vite upgrade should keep being
 * measured rather than silently drop to zero. Only `/assets/` URLs are taken —
 * registerSW.js is emitted separately by the PWA plugin and is not part of the
 * bundle this budget is about.
 */
export function entryAssets(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  const pick = (re) =>
    [...html.matchAll(re)]
      .map((m) => m[1].replace(/^.*\/assets\//, 'assets/'))
      .map((rel) => ({ file: rel, path: join(distDir, rel) }))

  return {
    entryJs: pick(/<script[^>]+src="([^"]+\/assets\/[^"]+\.js)"/g),
    entryCss: pick(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\/assets\/[^"]+\.css)"/g),
  }
}

/** Every dist/vocab/*.json the first install downloads. */
export function vocabAssets(distDir) {
  const dir = join(distDir, 'vocab')
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: `vocab/${f}`, path: join(dir, f) }))
}

/**
 * Measure the built output: raw and gzipped bytes for each budgeted group.
 * @returns {Record<string, {files: Array<{file: string, raw: number, gzip: number}>, gzip: number}>}
 */
export function measure(distDir) {
  const { entryJs, entryCss } = entryAssets(distDir)
  const groups = { entryJs, entryCss, vocab: vocabAssets(distDir) }

  return Object.fromEntries(
    Object.entries(groups).map(([key, assets]) => {
      const files = assets.map(({ file, path }) => ({
        file,
        raw: statSync(path).size,
        gzip: gzipBytes(path),
      }))
      return [key, { files, gzip: files.reduce((n, f) => n + f.gzip, 0) }]
    }),
  )
}

/**
 * Compare a measurement against the budget.
 *
 * A budgeted group the build produced no files for is a failure, not a pass:
 * zero bytes is what this script reports when it has stopped finding the asset
 * at all — an entry Vite emits under different markup, a renamed dist/vocab —
 * and a gate that measures nothing would sit at 0.0% forever while the payload
 * grew unwatched. `found` separates "nothing there" from "genuinely tiny".
 */
export function evaluate(measured, budget) {
  return Object.entries(budget.limits).map(([key, limit]) => {
    const found = (measured[key]?.files?.length ?? 0) > 0
    const actual = measured[key]?.gzip ?? 0
    return {
      key,
      label: limit.label,
      why: limit.why,
      actual,
      limit: limit.bytes,
      found,
      ok: found && actual <= limit.bytes,
      used: limit.bytes === 0 ? 0 : (actual / limit.bytes) * 100,
    }
  })
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

/** Render the markdown report for the CI job summary. */
export function renderSummary(measured, rows) {
  const missing = rows.filter((r) => !r.found)
  const over = rows.filter((r) => !r.ok && r.found)
  const heading = missing.length
    ? '### 📦 Size budget — nothing measured'
    : over.length
      ? '### 📦 Size budget — over budget'
      : '### 📦 Size budget'

  const lines = [heading, '', '| Asset | Gzipped | Budget | Used | |', '| --- | --: | --: | --: | :-: |']
  for (const r of rows) {
    lines.push(
      `| ${r.label} | ${kb(r.actual)} | ${kb(r.limit)} | ${r.used.toFixed(1)}% | ${r.ok ? '✅' : '❌'} |`,
    )
  }

  if (missing.length) {
    lines.push('', 'Measured nothing at all:', '')
    for (const r of missing) {
      lines.push(`- **${r.label}** matched no file in \`dist/\`.`)
    }
    lines.push(
      '',
      'That is a broken gate rather than a small payload — the budget cannot',
      'watch an asset it can no longer find. Check how `dist/index.html` now',
      'references the entry chunk, and that `dist/vocab/` still exists, then fix',
      '`scripts/size-summary.mjs` rather than deleting the check.',
    )
  }

  if (over.length) {
    lines.push('', 'Over budget:', '')
    for (const r of over) {
      lines.push(`- **${r.label}** is ${kb(r.actual - r.limit)} over. ${r.why}`)
    }
    lines.push(
      '',
      'If the growth is intended, raise the limit in `scripts/size-budget.json`',
      'in this PR and say in the commit message what grew and by how much.',
    )
  }

  const vocab = measured.vocab?.files ?? []
  if (vocab.length) {
    const biggest = [...vocab].sort((a, b) => b.gzip - a.gzip).slice(0, 8)
    lines.push('', '<details><summary>Largest vocab files</summary>', '')
    lines.push('| File | Raw | Gzipped |', '| --- | --: | --: |')
    for (const f of biggest) lines.push(`| \`${f.file}\` | ${kb(f.raw)} | ${kb(f.gzip)} |`)
    lines.push('', '</details>')
  }

  return lines.join('\n')
}

export function main() {
  const distDir = resolve('dist')
  const budget = JSON.parse(readFileSync(resolve('scripts/size-budget.json'), 'utf8'))

  let measured
  try {
    measured = measure(distDir)
  } catch (err) {
    console.error(`Cannot measure ${distDir} — run \`npm run build\` first.\n${err.message}`)
    process.exitCode = 1
    return
  }

  const rows = evaluate(measured, budget)
  const markdown = renderSummary(measured, rows)

  // Publish before deciding the exit code, so a breach is never a bare failure.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
  console.log(markdown)

  const missing = rows.filter((r) => !r.found)
  if (missing.length) {
    console.error(
      `\n✗ measured no files for: ${missing.map((r) => r.key).join(', ')} — the budget ` +
        'has stopped watching them. Fix scripts/size-summary.mjs, do not delete the check.',
    )
    process.exitCode = 1
  }

  const over = rows.filter((r) => !r.ok && r.found)
  if (over.length) {
    console.error(
      `\n✗ over the size budget: ${over
        .map((r) => `${r.key} ${kb(r.actual)} > ${kb(r.limit)}`)
        .join(', ')}`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
