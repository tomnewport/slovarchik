// Shared corpus + parts-file loading for the curriculum-parts tooling (#674).
//
// The generator (gen-parts.mjs) and the gate (check-parts.mjs) must agree
// exactly on what the corpus is and how the parts file is read — a gate that
// disagrees with the tool meant to satisfy it is worse than no gate — so both
// come through here.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as yaml from 'js-yaml'

import { buildWords, POS_BY_FILE, learnableWords } from '../src/lib/vocabBuild.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB_DIR = resolve(ROOT, 'public', 'vocab')

/** Repo-relative path of the committed parts definition. */
export const PARTS_PATH = 'public/vocab/parts.yml'

/**
 * Every learnable word in the corpus, normalised as the app sees it.
 * Gloss-only entries (`learn: false`) are excluded: they are not curriculum and
 * so belong to no part.
 */
export function loadCorpusWords() {
  const files = readdirSync(VOCAB_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({
      pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')],
      doc: yaml.load(readFileSync(resolve(VOCAB_DIR, f), 'utf8')),
    }))
    .filter((r) => r.pos)
  return learnableWords(buildWords(files)).filter((w) => w.cefr)
}

/** The committed parts definition, or null when there isn't one yet. */
export function readPartsFile() {
  const path = resolve(ROOT, PARTS_PATH)
  if (!existsSync(path)) return null
  return yaml.load(readFileSync(path, 'utf8'))
}
