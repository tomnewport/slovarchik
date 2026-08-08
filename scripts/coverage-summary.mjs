// Render the v8 coverage summary as markdown for the CI job summary (#535).
//
// `npm run test:coverage` enforces the per-layer thresholds in vite.config.js;
// this only makes the resulting numbers visible on the run, so a slide toward a
// threshold is noticeable before it trips one. Reads coverage/coverage-summary.json
// (the `json-summary` reporter) and appends to $GITHUB_STEP_SUMMARY, falling
// back to stdout when run locally.

import { readFileSync, appendFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const METRICS = ['statements', 'branches', 'functions', 'lines']

/** The layer a covered file belongs to, or null for anything unmeasured. */
function layerOf(path) {
  const match = /^src\/(lib|stores|composables)\//.exec(path)
  return match ? match[1] : null
}

function pct(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100
}

function formatPct(value) {
  return `${value.toFixed(2)}%`
}

/** Sum each metric's covered/total across a set of per-file entries. */
function rollUp(entries) {
  const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]))
  for (const entry of entries) {
    for (const metric of METRICS) {
      totals[metric].covered += entry[metric]?.covered ?? 0
      totals[metric].total += entry[metric]?.total ?? 0
    }
  }
  return totals
}

function row(label, totals) {
  const cells = METRICS.map((m) => formatPct(pct(totals[m].covered, totals[m].total)))
  return `| ${label} | ${cells.join(' | ')} |`
}

/**
 * Build the markdown report from a parsed coverage-summary.json.
 *
 * `root` is the directory the absolute paths in the summary are relative to.
 */
export function renderSummary(summary, root = process.cwd()) {
  const files = []
  for (const [path, entry] of Object.entries(summary)) {
    if (path === 'total') continue
    const rel = relative(root, path).split('\\').join('/')
    const layer = layerOf(rel)
    if (layer) files.push({ path: rel, layer, entry })
  }

  const lines = ['### 🧪 Coverage', '', '| Scope | Statements | Branches | Functions | Lines |']
  lines.push('| --- | --- | --- | --- | --- |')
  lines.push(row('**All measured**', rollUp(files.map((f) => f.entry))))
  for (const layer of ['lib', 'stores', 'composables']) {
    const inLayer = files.filter((f) => f.layer === layer)
    if (inLayer.length) lines.push(row(`src/${layer}`, rollUp(inLayer.map((f) => f.entry))))
  }

  // The handful worth a look — sorted by line coverage, lowest first.
  const weakest = files
    .map((f) => ({ path: f.path, lines: pct(f.entry.lines.covered, f.entry.lines.total) }))
    .sort((a, b) => a.lines - b.lines)
    .slice(0, 8)
    .filter((f) => f.lines < 100)
  if (weakest.length) {
    lines.push('', '<details><summary>Least-covered files</summary>', '')
    lines.push('| File | Lines |', '| --- | --- |')
    for (const f of weakest) lines.push(`| \`${f.path}\` | ${formatPct(f.lines)} |`)
    lines.push('', '</details>')
  }

  return lines.join('\n')
}

function main() {
  const path = resolve('coverage/coverage-summary.json')
  let summary
  try {
    summary = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    console.error(`No coverage summary at ${path} — run \`npm run test:coverage\` first.`)
    process.exitCode = 1
    return
  }
  const markdown = renderSummary(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
  console.log(markdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
