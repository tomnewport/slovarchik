// Test helpers: read the real vocab YAML files from public/ via the filesystem
// (tests run in Node) and build word records from them.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, shapeNouns, POS_BY_FILE } from '../lib/vocabBuild.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')

/** Raw { pos, text } records for every vocab YAML file on disk. */
export function loadFixtureFiles() {
  return readdirSync(vocabDir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({
      file: f,
      pos: POS_BY_FILE[f.replace(/\.ya?ml$/, '')],
      content: readFileSync(resolve(vocabDir, f), 'utf8'),
    }))
    .filter((r) => r.pos)
}

export function loadFixtureWords() {
  return buildWords(loadFixtureFiles().map((r) => ({ pos: r.pos, text: r.content })))
}

export function loadFixtureNouns() {
  return shapeNouns(loadFixtureWords())
}

/** The parsed phrase-completion carrier batteries (public/vocab/phrase-batteries.yml). */
export function loadFixtureBatteries() {
  return yaml.load(readFileSync(resolve(vocabDir, 'phrase-batteries.yml'), 'utf8'))
}
