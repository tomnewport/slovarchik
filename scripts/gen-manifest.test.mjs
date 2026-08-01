import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { buildManifest, emitVocabJson, gitUpdated, hashFile, jsonName, FILES } from './gen-manifest.mjs'

// The generator hashes a fixed set of vocab files; give the temp dir all of
// them so the file-list guard is satisfied, then vary the ones under test.
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
  for (const { file } of FILES) writeFileSync(resolve(dir, file), `# ${file}\n`)
  return dir
}

describe('gen-manifest', () => {
  let dir
  beforeEach(() => {
    dir = scaffold()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('hashes content, not the timestamp — same bytes give the same hash', () => {
    const a = hashFile(dir, 'nouns.yml')
    writeFileSync(resolve(dir, 'nouns.yml'), '# nouns.yml\n') // rewrite identical bytes
    expect(hashFile(dir, 'nouns.yml')).toBe(a)
    writeFileSync(resolve(dir, 'nouns.yml'), '# nouns.yml changed\n')
    expect(hashFile(dir, 'nouns.yml')).not.toBe(a)
  })

  it('derives `updated` from the injected date source, per file', () => {
    // `updated`/`hash` stay keyed off the `.yml` source; the manifest `file`
    // points at the emitted `.json` the client fetches.
    const dates = { 'nouns.yml': '2026-01-01T00:00:00Z' }
    const manifest = buildManifest(dir, (file) => dates[file] ?? '2025-12-25T00:00:00Z')
    const noun = manifest.files.find((f) => f.file === 'nouns.json')
    const verb = manifest.files.find((f) => f.file === 'verbs.json')
    expect(noun.updated).toBe('2026-01-01T00:00:00Z')
    expect(verb.updated).toBe('2025-12-25T00:00:00Z')
    // Every entry points at a `.json` file and carries a content hash + its pos.
    for (const entry of manifest.files) {
      expect(entry.file).toMatch(/\.json$/)
      expect(entry.hash).toMatch(/^[0-9a-f]{16}$/)
      const src = FILES.find((f) => jsonName(f.file) === entry.file)
      expect(entry.pos).toBe(src.pos)
    }
  })

  it('emitVocabJson writes a parsed .json next to each .yml source', () => {
    writeFileSync(resolve(dir, 'nouns.yml'), 'words:\n  дом=house:\n    gender: m\n')
    emitVocabJson(dir)
    // Every registered file gets a sibling .json...
    for (const { file } of FILES) {
      expect(existsSync(resolve(dir, jsonName(file)))).toBe(true)
    }
    // ...and it is the parsed document, not the raw YAML text.
    const doc = JSON.parse(readFileSync(resolve(dir, 'nouns.json'), 'utf8'))
    expect(doc).toEqual({ words: { 'дом=house': { gender: 'm' } } })
  })

  it('gitUpdated returns the last commit date (as UTC Z), null when untracked', () => {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'T',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 'T',
          GIT_COMMITTER_EMAIL: 't@example.com',
          // Fixed committer date (with an offset) so the normalisation to Z is
          // deterministic and testable.
          GIT_COMMITTER_DATE: '2026-03-04T12:00:00+02:00',
        },
      })
    git('init', '-q')
    git('add', 'nouns.yml')
    git('commit', '-qm', 'add nouns')

    expect(gitUpdated(dir, 'nouns.yml')).toBe('2026-03-04T10:00:00Z') // +02:00 → UTC
    // verbs.yml exists on disk but was never committed → no history.
    expect(gitUpdated(dir, 'verbs.yml')).toBe(null)
  })

  it('gitUpdated returns null outside a git repository', () => {
    // `dir` was never `git init`-ed in this test.
    expect(gitUpdated(dir, 'nouns.yml')).toBe(null)
  })
})
