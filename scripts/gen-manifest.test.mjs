import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { buildManifest, findDrift, hashFile, FILES } from './gen-manifest.mjs'

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

  it('preserves `updated` while a file is unchanged and bumps it when it changes', () => {
    const first = buildManifest(dir, null, '2026-01-01T00:00:00Z')
    // Rebuild with unchanged content and a later clock: dates must NOT move.
    const second = buildManifest(dir, first, '2026-02-02T00:00:00Z')
    expect(second.files).toEqual(first.files)

    // Change one file; only its `updated` (and hash) should move to `now`.
    writeFileSync(resolve(dir, 'nouns.yml'), '# nouns.yml v2\n')
    const third = buildManifest(dir, second, '2026-03-03T00:00:00Z')
    const noun = third.files.find((f) => f.file === 'nouns.yml')
    const verb = third.files.find((f) => f.file === 'verbs.yml')
    expect(noun.updated).toBe('2026-03-03T00:00:00Z')
    expect(noun.hash).not.toBe(first.files.find((f) => f.file === 'nouns.yml').hash)
    expect(verb.updated).toBe('2026-01-01T00:00:00Z') // untouched
  })

  it('migration: adopts a timestamp-only manifest without resetting dates', () => {
    const legacy = {
      version: 1,
      files: FILES.map(({ pos, file }) => ({ pos, file, updated: '2025-12-25T00:00:00Z' })),
    }
    const built = buildManifest(dir, legacy, '2026-06-06T00:00:00Z')
    // Every file keeps its historical date and gains a hash.
    for (const entry of built.files) {
      expect(entry.updated).toBe('2025-12-25T00:00:00Z')
      expect(entry.hash).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('findDrift flags a file whose committed hash no longer matches its bytes', () => {
    const manifest = buildManifest(dir, null, '2026-01-01T00:00:00Z')
    expect(findDrift(dir, manifest)).toEqual([])
    writeFileSync(resolve(dir, 'glossary.yml'), '# glossary.yml edited by hand\n')
    const drift = findDrift(dir, manifest)
    expect(drift.map((d) => d.file)).toEqual(['glossary.yml'])
  })

  it('the committed manifest matches the real vocab files', () => {
    const vocabDir = resolve(process.cwd(), 'public/vocab')
    const committed = JSON.parse(readFileSync(resolve(vocabDir, 'manifest.json'), 'utf8'))
    expect(findDrift(vocabDir, committed)).toEqual([])
  })
})
