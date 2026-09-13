// Propose a packing of the corpus into curriculum parts (#674).
//
// This is a WORKLIST, not a gate: it prints a proposed `public/vocab/parts.yml`
// (or writes it with --write) for a maintainer to read and accept. The parts
// file is owned by a person precisely because this script's output is not
// stable under corpus growth — see docs/cefr-parts.md.
//
// Two modes:
//   (default)  propose a packing from scratch — used once, to seed the file
//   --repack   the minimal repair of the committed packing, moving as little as
//              possible to bring every part back inside its bounds
//
// The minimal repair matters more than the initial pack. A learner who has
// finished A2 should never watch their finished parts rearrange because B1
// gained some words, so a repack holds every collection where it is and moves
// only what the bounds force.

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as yaml from 'js-yaml'

import {
  PART_TARGET,
  PART_MIN,
  PART_MAX,
  MIN_FRAGMENT,
  GLUE_COLLECTION,
  partId,
  assignParts,
  partBreach,
} from '../src/lib/curriculum.js'
import { CEFR_ORDER } from '../src/lib/batches.js'
import { loadCorpusWords, readPartsFile, PARTS_PATH } from './parts-corpus.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * How many parts a level of `n` words needs: every part within the ceiling, and
 * no runt left at the end. A level smaller than the floor gets one part, which
 * is the waiver C1 relies on.
 */
export function partCount(n) {
  if (n <= PART_MAX && n < PART_MIN + PART_TARGET) return 1
  let k = Math.max(1, Math.round(n / PART_TARGET))
  while (n / k > PART_MAX) k++
  while (k > 1 && n - PART_TARGET * (k - 1) < PART_MIN) k--
  return k
}

/**
 * Pack one level's collections into `k` parts, filling earlier parts to target
 * and letting the last absorb the remainder.
 *
 * Filling in order (rather than balancing) is deliberate: it is what makes
 * "the lowest unfilled part" meaningful, so new vocabulary has one obvious
 * home rather than a choice of several half-empty ones.
 *
 * A collection is split only when both sides clear {@link MIN_FRAGMENT} —
 * otherwise it moves whole to the next part. Splitting a big collection is
 * fine; fragmenting a small one into two useless halves is what we avoid.
 */
export function packLevel(sizes, k) {
  const quota = Array.from({ length: k }, (_, i) =>
    i === k - 1 ? Infinity : PART_TARGET,
  )
  const parts = Array.from({ length: k }, () => ({ collections: [], take: {}, size: 0 }))
  let p = 0
  for (const [collection, n] of sizes) {
    let left = n
    while (left > 0) {
      if (p >= k - 1) {
        const last = parts[k - 1]
        last.collections.push(collection)
        last.size += left
        break
      }
      const room = quota[p] - parts[p].size
      if (room <= 0) {
        p++
        continue
      }
      if (left <= room) {
        parts[p].collections.push(collection)
        parts[p].size += left
        break
      }
      if (room >= MIN_FRAGMENT && left - room >= MIN_FRAGMENT) {
        parts[p].collections.push(collection)
        parts[p].take[collection] = room
        parts[p].size += room
        left -= room
        p++
      } else {
        p++
      }
    }
  }
  return parts
}

/** A proposed definition for the whole corpus. */
export function proposePacking(words) {
  const out = []
  for (const level of CEFR_ORDER) {
    const inLevel = words.filter((w) => w.cefr === level)
    if (!inLevel.length) continue
    const counts = new Map()
    for (const w of inLevel) {
      const c = w.collections?.[0] ?? GLUE_COLLECTION
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    // Biggest collections first, so the most substantial topics anchor the
    // earliest parts; ties broken by name so the packing is reproducible.
    const sizes = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const packed = packLevel(sizes, partCount(inLevel.length))
    packed.forEach((part, i) => {
      const def = { id: partId(level, i + 1), level, ordinal: i + 1, collections: part.collections }
      if (Object.keys(part.take).length) def.take = part.take
      out.push(def)
    })
  }
  return { parts: out }
}

/**
 * The minimal repair of an existing packing: keep every collection where it is,
 * and only when a part breaks its ceiling move collections off its end (or
 * split the largest, when no whole move is legal) into the next part of the
 * same level, adding a part when the level runs out of room.
 */
export function repack(words, definition) {
  const next = { parts: (definition?.parts ?? []).map((p) => ({ ...p, collections: [...p.collections], take: { ...(p.take ?? {}) } })) }
  for (let pass = 0; pass < 10; pass++) {
    const { parts } = assignParts(words, next)
    const levelTotals = {}
    for (const p of parts) levelTotals[p.level] = (levelTotals[p.level] ?? 0) + p.size
    const over = parts.find((p) => partBreach(p, levelTotals[p.level]) === 'over')
    if (!over) return next
    const idx = next.parts.findIndex((p) => p.id === over.id)
    const inLevel = next.parts.filter((p) => p.level === over.level)
    const isLast = inLevel[inLevel.length - 1].id === over.id
    if (isLast) {
      next.parts.splice(idx + 1, 0, {
        id: partId(over.level, over.ordinal + 1),
        level: over.level,
        ordinal: over.ordinal + 1,
        collections: [],
        take: {},
      })
    }
    const target = next.parts[idx + 1]
    const moved = next.parts[idx].collections.pop()
    if (moved == null) return next
    delete next.parts[idx].take[moved]
    target.collections.unshift(moved)
  }
  return next
}

/** Render a definition as the committed YAML, with its explanatory header. */
export function renderYaml(definition, stats) {
  const header = [
    '# parts.yml — the curriculum parts (#674). MAINTAINER-OWNED.',
    '#',
    '# A part is a chunk of about 500 words that a learner works through as one',
    '# goal: "A2 Part I", "B1 Part III". Each is a bundle of topic collections',
    '# inside a single CEFR level.',
    '#',
    '# This file is committed rather than computed because bin-packing is not',
    '# stable under insertion — one new word can reshuffle several collections —',
    '# and a goal that rearranges itself as the corpus grows is no goal at all.',
    '#',
    '# `collections` lists the topics a part holds. A collection named by several',
    '# parts is consumed in part order: a part with a `take` count for it gets',
    '# that many words (ordered by word key), and the part naming it *without* a',
    '# count takes whatever is left — which is how new words find a home without',
    '# anyone editing this file.',
    '#',
    `# Bounds, enforced by \`npm run check:parts\`: ${PART_MIN}–${PART_MAX} words, ${PART_TARGET} targeted.`,
    '# The floor is waived for a level smaller than it (C1 has 25 words).',
    '#',
    '# To change it: `npm run gen:parts -- --repack --write`, which moves the',
    '# minimum needed to bring every part back inside its bounds, then read the',
    '# diff. See docs/cefr-parts.md.',
    '#',
    '# Sizes when last generated:',
    ...stats.map((s) => `#   ${s.name.padEnd(12)} ${String(s.size).padStart(4)}`),
    '',
  ].join('\n')
  return `${header}${yaml.dump(definition, { lineWidth: 100, noRefs: true })}`
}

function main() {
  const args = process.argv.slice(2)
  const words = loadCorpusWords()
  const definition = args.includes('--repack')
    ? repack(words, readPartsFile())
    : proposePacking(words)
  const { parts, unassigned } = assignParts(words, definition)
  const stats = parts.map((p) => ({ name: p.name, size: p.size }))
  const yamlText = renderYaml(definition, stats)

  if (args.includes('--write')) {
    writeFileSync(resolve(ROOT, PARTS_PATH), yamlText)
    console.log(`[gen-parts] wrote ${PARTS_PATH}`)
  } else {
    console.log(yamlText)
  }
  console.error(`\n${parts.length} parts, ${words.length} learnable words`)
  for (const p of parts) console.error(`  ${p.name.padEnd(12)} ${String(p.size).padStart(4)}`)
  if (unassigned.length) console.error(`  !! ${unassigned.length} words in no part`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
