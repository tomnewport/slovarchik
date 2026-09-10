import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { precacheEntries, vocabEntries, renderSummary } from './check-precache.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

// A minified manifest in the shape vite-plugin-pwa emits: unquoted keys, a
// revision hash for the static files and null for the content-hashed assets.
const shell =
  'precacheAndRoute([{url:"index.html",revision:"abc123"},' +
  '{url:"assets/index-D96PxI5.js",revision:null},' +
  '{url:"assets/index-CaGQnf75.css",revision:null},' +
  '{url:"manifest.webmanifest",revision:"def456"}])'

const withVocab =
  'precacheAndRoute([{url:"index.html",revision:"abc123"},' +
  '{url:"vocab/nouns.json",revision:"aaa"},' +
  '{url:"vocab/verbs.json",revision:"bbb"}])'

describe('reading the generated precache manifest', () => {
  it('pulls out every entry, hashed or not', () => {
    const entries = precacheEntries(shell)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toEqual({ url: 'index.html', revision: 'abc123' })
    expect(entries[1]).toEqual({ url: 'assets/index-D96PxI5.js', revision: null })
  })

  it('finds nothing in a source with no manifest', () => {
    expect(precacheEntries('self.addEventListener("fetch", () => {})')).toEqual([])
  })
})

describe('the vocab partition', () => {
  it('passes an app-shell-only manifest', () => {
    expect(vocabEntries(precacheEntries(shell))).toEqual([])
  })

  it('catches vocab that has crept back into the precache', () => {
    const offenders = vocabEntries(precacheEntries(withVocab))
    expect(offenders.map((e) => e.url)).toEqual(['vocab/nouns.json', 'vocab/verbs.json'])
  })

  it('matches vocab under a base path too', () => {
    const entries = precacheEntries('[{url:"slovarchik/vocab/nouns.json",revision:"a"}]')
    expect(vocabEntries(entries)).toHaveLength(1)
  })

  it('does not mistake a lookalike filename for the vocab directory', () => {
    const entries = precacheEntries('[{url:"assets/vocabBuild-abc.js",revision:null}]')
    expect(vocabEntries(entries)).toEqual([])
  })
})

describe('the published summary', () => {
  it('says what is precached when the partition holds', () => {
    const md = renderSummary(precacheEntries(shell), [])
    expect(md).toContain('Precache partition')
    expect(md).toContain('4 entries')
    expect(md).not.toContain('broken')
  })

  it('names the offenders and points at the config when it does not', () => {
    const entries = precacheEntries(withVocab)
    const md = renderSummary(entries, vocabEntries(entries))
    expect(md).toContain('broken')
    expect(md).toContain('vocab/nouns.json')
    expect(md).toContain('vite.config.js')
    expect(md).toContain('#266')
  })
})

// The generated manifest is what the gate actually reads, but the config is
// where the partition is expressed — assert the intent is still written down,
// so a deleted globIgnores fails here even before anything is built.
describe('the workbox config still declares the partition', () => {
  const config = readFileSync(join(repo, 'vite.config.js'), 'utf8')

  it('ignores vocab when building the precache manifest', () => {
    expect(config).toMatch(/globIgnores:\s*\[[^\]]*vocab/)
  })

  it('keeps a runtime caching rule for the vocab instead', () => {
    expect(config).toMatch(/runtimeCaching/)
    expect(config).toMatch(/slovarchik-vocab/)
  })
})
