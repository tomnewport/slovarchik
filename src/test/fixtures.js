// Test helpers: read the real vocab YAML files from public/ via the filesystem
// (tests run in Node) and build word records from them.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { buildWords, shapeNouns, shapeContextPhrases, POS_BY_FILE } from '../lib/vocabBuild.js'
import { indexPhrases } from '../lib/phraseContext.js'

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

/**
 * Parsed vocab documents, keyed by filename and parsed once per Vitest worker.
 *
 * The corpus is 6.4 MB of YAML and never changes during a run, yet
 * `loadFixtureWords()` is called 78 times across 32 test files — so the same
 * bytes were parsed 78 times, at ~340 ms a go (#664).
 *
 * Only the *documents* are cached. `buildWords` still runs fresh on every call,
 * and that distinction is the safety argument: the word records it returns get
 * written to after the fact — `linkHeteronyms`/`linkAmbiguousEn`/`linkFacts`
 * fill in the cross-links, and the store's `stampContextDrill` sets
 * `hasContextDrill` — so sharing *those* between tests would leak state across
 * a file. `buildWords` itself only ever *reads* its input, so sharing the
 * documents the records are built from leaks nothing on its own.
 *
 * The caveat, because it is not obvious from `buildWords`: a built record is
 * not a full copy of its document. `normalizeWord` ends with `extra: word` —
 * the raw authored node, by reference — and passes `usage`, `collections`,
 * `meaningsAlt`, `short` and `participles` straight through as well. Those are
 * live aliases into the cached document now that it is shared, so writing
 * through one (`w.extra.defective = true`) would reach every later
 * `loadFixtureWords()` in the same file and make the suite order-dependent.
 * Nothing does today — the whole suite passes with the documents deep-frozen —
 * and the rule that keeps it that way is: **treat a fixture document, and
 * anything reachable from `w.extra`, as read-only.** Derive with a spread
 * (`{ ...w, extra: { ...w.extra, x } }`), as src/lib/paradigm.test.js and
 * src/lib/paradigmShape.test.js already do.
 */
const docsByFile = new Map()

let fixtureDocs = null

function loadFixtureDocs() {
  fixtureDocs ??= loadFixtureFiles().map((r) => {
    if (!docsByFile.has(r.file)) docsByFile.set(r.file, yaml.load(r.content))
    return { pos: r.pos, doc: docsByFile.get(r.file) }
  })
  return fixtureDocs
}

/**
 * One parsed vocab document by filename — the single-file counterpart to
 * {@link loadFixtureWords}, for the data oracles that assert against the raw
 * authored YAML rather than the built word records. Shares the cache above, so
 * a file that wants both the documents and the words parses each one once.
 */
export function loadFixtureDoc(file) {
  if (!docsByFile.has(file)) {
    docsByFile.set(file, yaml.load(readFileSync(resolve(vocabDir, file), 'utf8')))
  }
  return docsByFile.get(file)
}

export function loadFixtureWords() {
  return buildWords(loadFixtureDocs())
}

export function loadFixtureNouns() {
  return shapeNouns(loadFixtureWords())
}

/** key → annotated context phrases, built from words' usage `inflect` blocks. */
export function loadFixtureContextPhrases() {
  return indexPhrases(shapeContextPhrases(loadFixtureWords()))
}

/** The parsed grammar-rules map (public/vocab/grammar-rules.yml). */
export function loadFixtureRules() {
  return loadFixtureDoc('grammar-rules.yml')?.rules ?? {}
}

// Hand-rolled corpus loading elsewhere in the suite, and why it stays (#664).
//
// Vitest isolates each test file in its own module registry, so the cache above
// is per-file: it pays off where one file builds the words repeatedly, and buys
// nothing where a file parses one document once. These four do exactly that,
// and each wants the raw authored YAML for a single part of speech rather than
// the built records, so routing them through here would add an import without
// removing a parse:
//
//   src/lib/nounsData.test.js      nouns.yml (2.7 MB), once
//   src/lib/verbsData.test.js      verbs.yml (1.8 MB) + adjectives.yml, once each
//   src/stores/vocab.test.js       nouns.yml, once, as a store-input fixture
//   src/lib/paradigm.test.js       five files, once, over a deliberately
//                                  narrowed POS set that loadFixtureWords()
//                                  would widen — a different assertion
