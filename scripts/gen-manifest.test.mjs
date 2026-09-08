import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import {
  buildManifest,
  emitPhraseNotes,
  emitVocabJson,
  gitUpdated,
  hashFile,
  jsonName,
  phraseNotesEntry,
  wordEntries,
  FILES,
  PHRASE_NOTES_FILE,
  PHRASE_NOTES_POS,
} from './gen-manifest.mjs'
import { buildWords, phraseNotesFrom, shapePhrases } from '../src/lib/vocabBuild.js'

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


  describe('phrase-notes.json (#657)', () => {
    // A two-word corpus with a usage example whose English is ambiguous about
    // ты/вы, so the shaped phrase actually carries an annotation to ship.
    const nounsYml = [
      'words:',
      '  дом=house:',
      '    gender: m',
      '    usage:',
      '      - { ru: "Ты идёшь домой", en_gb: "You are going home" }',
      '      - { ru: "Вы идёте домой", en_gb: "You are going home" }',
      '',
    ].join('\n')

    function emit() {
      writeFileSync(resolve(dir, 'nouns.yml'), nounsYml)
      emitVocabJson(dir)
      const manifest = buildManifest(dir, () => '2026-01-01T00:00:00Z')
      const doc = emitPhraseNotes(dir, manifest.files)
      return { manifest, doc }
    }

    it('writes the annotations the runtime would otherwise derive', () => {
      const { doc } = emit()
      const words = buildWords([{ pos: 'noun', doc: JSON.parse(readFileSync(resolve(dir, 'nouns.json'), 'utf8')) }])
      expect(doc.notes).toEqual(phraseNotesFrom(shapePhrases(words)))
      expect(Object.keys(doc.notes).length).toBeGreaterThan(0)
    })

    it('stamps the corpus it was derived from, and only the word files', () => {
      const { manifest, doc } = emit()
      expect(doc.corpus).toContain('nouns.json:')
      expect(doc.corpus).not.toContain('grammar-rules.json:')
      expect(doc.corpus).not.toContain(PHRASE_NOTES_FILE)
      expect(wordEntries(manifest.files).map((f) => f.file)).not.toContain('grammar-rules.json')
    })

    it('is a manifest entry like any other, so the client caches it per-hash', () => {
      const { manifest } = emit()
      const entry = phraseNotesEntry(dir, manifest.files)
      expect(entry.pos).toBe(PHRASE_NOTES_POS)
      expect(entry.file).toBe(PHRASE_NOTES_FILE)
      expect(entry.hash).toMatch(/^[0-9a-f]{16}$/)
      expect(entry.updated).toBe('2026-01-01T00:00:00Z')
      // The entry describes itself, so it is never part of its own token.
      expect(wordEntries([entry])).toEqual([])
    })

    it('is deterministic — the same corpus emits the same bytes', () => {
      emit()
      const first = readFileSync(resolve(dir, PHRASE_NOTES_FILE), 'utf8')
      emit()
      expect(readFileSync(resolve(dir, PHRASE_NOTES_FILE), 'utf8')).toBe(first)
    })

    it('changes its corpus token when a word file changes', () => {
      const before = emit().doc.corpus
      writeFileSync(resolve(dir, 'nouns.yml'), nounsYml.replace('домой', 'домо́й'))
      emitVocabJson(dir)
      const manifest = buildManifest(dir, () => '2026-01-01T00:00:00Z')
      expect(emitPhraseNotes(dir, manifest.files).corpus).not.toBe(before)
    })
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
