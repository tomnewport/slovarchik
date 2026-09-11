// CI gate: the committed curriculum parts still describe the corpus (#674).
//
// Unlike the coverage and payload ratchets, this one is not holding a number
// steady — it is asserting that a piece of committed data still matches the
// data it describes. The parts file is a promise to the learner ("A2 Part I is
// these 483 words"), and vocabulary is added constantly, so the two drift apart
// silently unless something checks.
//
// What it enforces:
//
//   1. every learnable word belongs to exactly one part — no orphans, which
//      would be words the curriculum can never reach;
//   2. no part exceeds PART_MAX, and none falls below PART_MIN unless its whole
//      CEFR level does (the C1 waiver);
//   3. no collection is fragmented below MIN_FRAGMENT — splitting a big topic
//      is fine, cutting a small one into useless halves is not;
//   4. part ids are unique and ordinals are contiguous from 1, since those ids
//      are persisted in `seenAchievements` and must stay meaningful.
//
// The failure is a worklist item, not a puzzle: the message names the repair,
// which is `npm run gen:parts -- --repack --write` followed by reading the diff.

import { pathToFileURL } from 'node:url'

import {
  PART_MIN,
  PART_MAX,
  MIN_FRAGMENT,
  assignParts,
  partBreach,
  collectionOf,
} from '../src/lib/curriculum.js'
import { loadCorpusWords, readPartsFile, PARTS_PATH } from './parts-corpus.mjs'

/**
 * Every problem with a packing, as human-readable lines. Empty means the gate
 * passes. Pure so it can be unit-tested without touching the real corpus.
 * @param {object[]} words learnable, normalised words
 * @param {object} definition the parsed parts file
 * @returns {string[]}
 */
export function auditParts(words, definition) {
  const problems = []
  if (!definition?.parts?.length) return [`${PARTS_PATH} defines no parts.`]

  const { parts, keyToPart, unassigned } = assignParts(words, definition)

  // 1. Orphans. Named individually up to a limit: the first few are usually
  // enough to see which collection was forgotten.
  if (unassigned.length) {
    const sample = unassigned.slice(0, 5).map((w) => `${w.key} (${w.cefr}, ${collectionOf(w)})`)
    problems.push(
      `${unassigned.length} learnable word(s) belong to no part, e.g. ${sample.join('; ')}.`,
    )
  }

  // 2. Bounds, with the small-level waiver.
  const levelTotals = {}
  for (const w of words) levelTotals[w.cefr] = (levelTotals[w.cefr] ?? 0) + 1
  for (const part of parts) {
    const breach = partBreach(part, levelTotals[part.level])
    if (breach === 'over') {
      problems.push(`${part.name} holds ${part.size} words, over the ${PART_MAX} ceiling.`)
    } else if (breach === 'under') {
      problems.push(
        `${part.name} holds ${part.size} words, under the ${PART_MIN} floor ` +
          `(its level has ${levelTotals[part.level]}, so the floor applies).`,
      )
    }
  }

  // 3. Fragments. Only a collection genuinely split across parts can offend;
  // one that simply happens to be small is not a fragment.
  // level -> collection -> part id -> count. Nested rather than keyed on a
  // joined string, which would need a separator no collection name can contain.
  const fragments = new Map()
  for (const part of parts) {
    if (!fragments.has(part.level)) fragments.set(part.level, new Map())
    const inLevel = fragments.get(part.level)
    for (const w of part.words) {
      const collection = collectionOf(w)
      if (!inLevel.has(collection)) inLevel.set(collection, new Map())
      const byPart = inLevel.get(collection)
      byPart.set(part.id, (byPart.get(part.id) ?? 0) + 1)
    }
  }
  for (const [level, inLevel] of fragments) {
    for (const [collection, byPart] of inLevel) {
      if (byPart.size < 2) continue
      for (const [id, n] of byPart) {
        if (n < MIN_FRAGMENT) {
          problems.push(
            `"${collection}" at ${level} is split across ${byPart.size} parts, ` +
              `leaving ${n} word(s) in ${id} — below the ${MIN_FRAGMENT}-word fragment floor.`,
          )
        }
      }
    }
  }

  // 4. Identity. Ids are persisted with a learner's achievements, so a
  // duplicate or a gap is a latent milestone bug, not a cosmetic one.
  const ids = new Set()
  for (const def of definition.parts) {
    if (ids.has(def.id)) problems.push(`Duplicate part id "${def.id}".`)
    ids.add(def.id)
  }
  const byLevel = {}
  for (const def of definition.parts) (byLevel[def.level] ??= []).push(def.ordinal)
  for (const [level, ordinals] of Object.entries(byLevel)) {
    const sorted = [...ordinals].sort((a, b) => a - b)
    const expected = sorted.map((_, i) => i + 1)
    if (sorted.join(',') !== expected.join(',')) {
      problems.push(`${level} ordinals are ${sorted.join(', ')}; expected ${expected.join(', ')}.`)
    }
  }

  // Never silently pass a file that claims a key/part count no word supports.
  if (keyToPart.size !== words.length - unassigned.length) {
    problems.push('A word was claimed by more than one part.')
  }
  return problems
}

function main() {
  const definition = readPartsFile()
  if (!definition) {
    console.error(`[check:parts] ${PARTS_PATH} is missing.`)
    process.exit(1)
  }
  const words = loadCorpusWords()
  const problems = auditParts(words, definition)
  const { parts } = assignParts(words, definition)

  if (!problems.length) {
    console.log(`[check:parts] ${parts.length} parts, ${words.length} learnable words, all in bounds:`)
    for (const p of parts) console.log(`  ${p.name.padEnd(12)} ${String(p.size).padStart(4)}`)
    return
  }
  console.error(`[check:parts] ${PARTS_PATH} no longer describes the corpus:\n`)
  for (const p of problems) console.error(`  • ${p}`)
  console.error(
    '\nRepair it with `npm run gen:parts -- --repack --write`, which moves the minimum\n' +
      'needed to bring every part back inside its bounds, then read the diff before\n' +
      'committing. See docs/cefr-parts.md for why the packing is committed data.',
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
