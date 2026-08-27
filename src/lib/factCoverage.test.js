import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import {
  breakdownCandidates,
  derivationCandidates,
  confusableCandidates,
  staleReviewed,
  factCoverage,
  PRODUCTIVE_PREFIXES,
} from './factCoverage.js'
import { loadFixtureWords } from '../test/fixtures.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

const verb = (key, accented, extra = '') => `
  "${key}":
    cefr_level: A1
    accented: ${accented}
    en_gb: { standard: ${key.split('=')[1]} }${extra}`

describe('breakdownCandidates', () => {
  const family = fromYaml([
    {
      pos: 'verb',
      text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('входить=to enter', 'входи́ть')}${verb('выходить=to exit', 'выходи́ть')}${verb('находиться=to be located', 'находи́ться')}${verb('думать=to think', 'ду́мать')}`,
    },
  ])

  it('finds a prefixed word whose stem is itself an entry', () => {
    const keys = breakdownCandidates(family).map((c) => c.key)
    expect(keys).toContain('входить=to enter')
    expect(keys).toContain('выходить=to exit')
  })

  it('names the prefix and the root the see: link should point at', () => {
    const enter = breakdownCandidates(family).find((c) => c.key === 'входить=to enter')
    expect(enter).toMatchObject({ prefix: 'в', root: { key: 'ходить=to go', ru: 'ходи́ть' } })
  })

  it('sees through a reflexive ending', () => {
    const keys = breakdownCandidates(family).map((c) => c.key)
    expect(keys).toContain('находиться=to be located')
  })

  it('ignores a word whose stem is not an entry', () => {
    expect(breakdownCandidates(family).map((c) => c.key)).not.toContain('думать=to think')
  })

  it('never proposes the root itself', () => {
    expect(breakdownCandidates(family).map((c) => c.key)).not.toContain('ходить=to go')
  })

  it('ranks by root-family size — the reach is what makes a fact worth writing', { timeout: 60_000 }, () => {
    const ranked = breakdownCandidates(loadFixtureWords())
    // Assert the ordering itself rather than how big the biggest family happens
    // to be today: authoring facts drains the large families, so any threshold
    // on ranked[0].family measures how much has been written, not the ranking.
    const sizes = ranked.map((c) => c.family)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    // …and that it is ranking real families, not a list of singletons.
    expect(sizes[0]).toBeGreaterThan(1)
  })

  it('drops a word that already carries a build or root fact', () => {
    const done = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('входить=to enter', 'входи́ть', `
    facts:
      - { kind: root, text: Same root as ходить. }`)}`,
      },
    ])
    expect(breakdownCandidates(done)).toEqual([])
  })

  it('prefers the longest matching prefix', () => {
    // «под» is tried before «по», so подходи́ть is под + ходи́ть rather than a
    // failed по + дходить.
    expect(PRODUCTIVE_PREFIXES.indexOf('под')).toBeLessThan(PRODUCTIVE_PREFIXES.indexOf('по'))
    const words = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('ходить=to go', 'ходи́ть')}${verb('подходить=to approach', 'подходи́ть')}`,
      },
    ])
    expect(breakdownCandidates(words)[0]).toMatchObject({ prefix: 'под', root: { ru: 'ходи́ть' } })
  })

  it('reads переводи́ть as пере + води́ть', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `words:${verb('водить=to lead', 'води́ть')}${verb('переводить=to translate', 'переводи́ть')}`,
      },
    ])
    expect(breakdownCandidates(words)[0]).toMatchObject({ prefix: 'пере', root: { ru: 'води́ть' } })
  })

  it('is empty for an empty corpus', () => {
    expect(breakdownCandidates([])).toEqual([])
    expect(breakdownCandidates()).toEqual([])
  })
})

describe('derivationCandidates', () => {
  it('flags a productive suffix and guesses where it came from', () => {
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('учить=to teach', 'учи́ть')}` },
      {
        pos: 'noun',
        text: `
words:
  "учитель=teacher":
    cefr_level: A1
    accented: учи́тель
    gender: m
    animacy: a
    en_gb: { standard: teacher }
`,
      },
    ])
    const [teacher] = derivationCandidates(words)
    expect(teacher).toMatchObject({ key: 'учитель=teacher', suffix: 'тель' })
    expect(teacher.from).toMatchObject({ key: 'учить=to teach', via: 'exact' })
  })

  // ── #614: the source is verified, not guessed ────────────────────────────
  const noun = (key, accented, gender = 'm') => `
  "${key}":
    cefr_level: A1
    accented: ${accented}
    gender: ${gender}
    animacy: i
    en_gb: { standard: ${key.split('=')[1]} }`

  it('names no source when nothing reconstructs the stem', () => {
    // посте́ль is not a -тель agent noun; the suffix is a coincidence, and the
    // old pass answered посади́ть because it starts with «пос».
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('посадить=to plant', 'посади́ть')}` },
      { pos: 'noun', text: `words:${noun('постель=bed', 'посте́ль', 'f')}` },
    ])
    expect(derivationCandidates(words).find((c) => c.key === 'постель=bed').from).toBeNull()
  })

  it('will not derive a word from something longer than itself', () => {
    // внима́ние does not come from внима́тельно; derivation adds material.
    const words = fromYaml([
      { pos: 'adverb', text: `words:${verb('внимательно=attentively', 'внима́тельно')}` },
      { pos: 'noun', text: `words:${noun('внимание=attention', 'внима́ние', 'n')}` },
    ])
    expect(derivationCandidates(words).find((c) => c.key === 'внимание=attention').from).toBeNull()
  })

  it('requires the source to be a part of speech the suffix attaches to', () => {
    // зада́ние reconstructs equally well from зад and from зада́ть on the letters
    // alone. -ание goes on verbs, which is what separates them.
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('задать=to assign', 'зада́ть')}` },
      { pos: 'noun', text: `words:${noun('зад=back', 'зад')}${noun('задание=task', 'зада́ние', 'n')}` },
    ])
    const task = derivationCandidates(words).find((c) => c.key === 'задание=task')
    expect(task.from.key).toBe('задать=to assign')
  })

  it('sees through a consonant mutation, and says that it did', () => {
    // движе́ние is built on дви́гать, with the г→ж that Russian derivation is
    // full of — and the -ся must not make the source look too long to be one.
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('двигаться=to move', 'дви́гаться')}` },
      { pos: 'noun', text: `words:${noun('движение=movement', 'движе́ние', 'n')}` },
    ])
    const move = derivationCandidates(words).find((c) => c.key === 'движение=movement')
    expect(move.from).toMatchObject({ key: 'двигаться=to move', via: 'mutation' })
  })

  it('takes the stem the theme vowel left behind', () => {
    // жела́ние sits on «жел», which is жела́ть stripped twice: -ть, then the а.
    const words = fromYaml([
      { pos: 'verb', text: `words:${verb('желать=to wish', 'жела́ть')}` },
      { pos: 'noun', text: `words:${noun('желание=wish', 'жела́ние', 'n')}` },
    ])
    expect(derivationCandidates(words).find((c) => c.key === 'желание=wish').from.key).toBe(
      'желать=to wish',
    )
  })

  it('every source it names across the real corpus reconstructs exactly or by one mutation', () => {
    // The acceptance criterion of #614, asserted rather than spot-checked: no
    // claim survives that is not one of the two things the module says it is.
    for (const c of derivationCandidates(loadFixtureWords())) {
      if (c.from) expect(['exact', 'mutation']).toContain(c.from.via)
    }
  })

  it('still reports a suffixed word whose source is not in the corpus', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "радость=joy":
    cefr_level: A2
    accented: ра́дость
    gender: f
    animacy: i
    en_gb: { standard: joy }
`,
      },
    ])
    expect(derivationCandidates(words)[0]).toMatchObject({ suffix: 'ость', from: null })
  })
})

describe('confusableCandidates', () => {
  const pair = (aKey, aRu, aEn, bKey, bRu, bEn, level = 'A2') => `
words:
  "${aKey}":
    cefr_level: ${level}
    accented: ${aRu}
    en_gb: { standard: ${aEn} }
  "${bKey}":
    cefr_level: ${level}
    accented: ${bRu}
    en_gb: { standard: ${bEn} }
`

  it('shortlists a near-identical pair', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring') },
    ])
    const [found] = confusableCandidates(words)
    expect([found.a.key, found.b.key].sort()).toEqual(['звенеть=to ring', 'звонить=to call'])
    expect(found.distance).toBe(1)
  })

  it('ignores short words, where an edit distance of 1 means nothing', () => {
    // Every one-letter function word is "distance 1" from every other; without
    // a length floor the shortlist is nothing else.
    const words = fromYaml([{ pos: 'preposition', text: pair('в=in', 'в', 'in', 'к=towards', 'к', 'towards') }])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('normalises by length, so a long pair may differ by more than a short one', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('становиться=to become', 'станови́ться', 'to become', 'остановиться=to stop', 'останови́ться', 'to stop') },
    ])
    expect(confusableCandidates(words)).toHaveLength(1)
  })

  it('leaves an aspect pair alone — that link is derived, and authoring it fails CI', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "писать=to write":
    cefr_level: A1
    accented: писа́ть
    aspect: impf
    pair: "написать=to write"
    en_gb: { standard: to write }
  "написать=to write":
    cefr_level: A1
    accented: написа́ть
    aspect: pf
    pair: "писать=to write"
    en_gb: { standard: to write }
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('leaves a heteronym pair alone too', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "замок=castle":
    cefr_level: B1
    accented: за́мок
    gender: m
    animacy: i
    en_gb: { standard: castle }
  "замок=lock":
    cefr_level: B1
    accented: замо́к
    gender: m
    animacy: i
    en_gb: { standard: lock }
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  // ── #613: a rejection is as durable as an authored link ──────────────────
  it('drops a pair that has been reviewed and set aside', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring') },
    ])
    expect(confusableCandidates(words)).toHaveLength(1)
    const reviewed = [{ a: 'звонить=to call', b: 'звенеть=to ring', why: 'not actually a mix-up' }]
    expect(confusableCandidates(words, { reviewed })).toEqual([])
  })

  it('honours a rejection recorded the other way round', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring') },
    ])
    const reviewed = [{ a: 'звенеть=to ring', b: 'звонить=to call' }]
    expect(confusableCandidates(words, { reviewed })).toEqual([])
  })

  it('skips a pair already authored as confusable', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звенеть=to ring":
    cefr_level: A2
    accented: звене́ть
    en_gb: { standard: to ring }
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    confusable_with: [{ key: "звенеть=to ring", why: One is a bell. }]
`,
      },
    ])
    expect(confusableCandidates(words)).toEqual([])
  })

  it('skips words too far apart in level to be met together', () => {
    const words = fromYaml([
      { pos: 'verb', text: pair('звонить=to call', 'звони́ть', 'to call', 'звенеть=to ring', 'звене́ть', 'to ring').replace('cefr_level: A2\n    accented: звене́ть', 'cefr_level: C1\n    accented: звене́ть') },
    ])
    expect(confusableCandidates(words)).toEqual([])
    expect(confusableCandidates(words, { maxCefrGap: 5 })).toHaveLength(1)
  })

  // Corpus-scale: the scan considers millions of pairs, so it gets headroom
  // over the default per-test timeout for a slow CI runner.
  it('reports the closest pairs first', { timeout: 60_000 }, () => {
    const ranked = confusableCandidates(loadFixtureWords())
    expect(ranked.length).toBeGreaterThan(0)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].ratio).toBeGreaterThanOrEqual(ranked[i - 1].ratio)
    }
  })
})

describe('factCoverage', () => {
  const words = loadFixtureWords()

  it('counts the learnable corpus, by part of speech and by level', () => {
    const cov = factCoverage(words)
    expect(cov.total.words).toBe(words.filter((w) => w.learnable !== false).length)
    expect(cov.byPos.map((r) => r.pos)).toContain('verb')
    expect(cov.byCefr.map((r) => r.cefr)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
  })

  it('adds up: the buckets account for every word', () => {
    const cov = factCoverage(words)
    expect(cov.byPos.reduce((n, r) => n + r.words, 0)).toBe(cov.total.words)
    expect(cov.byCefr.reduce((n, r) => n + r.words, 0)).toBe(cov.total.words)
  })

  it('counts authored facts and confusable links', () => {
    const cov = factCoverage(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "звенеть=to ring":
    cefr_level: A2
    accented: звене́ть
    en_gb: { standard: to ring }
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    facts:
      - { kind: note, text: A note. }
    confusable_with: [{ key: "звенеть=to ring", why: One is a bell. }]
`,
        },
      ]),
    )
    expect(cov.total).toMatchObject({ words: 2, withFacts: 1, facts: 1, confusables: 2 })
  })

  it('handles an empty corpus', () => {
    expect(factCoverage([]).total.words).toBe(0)
    expect(factCoverage().byPos).toEqual([])
  })
})

describe('staleReviewed', () => {
  it('names the ledger entries whose words the corpus no longer has', () => {
    const words = fromYaml([
      { pos: 'verb', text: pairOf('звонить=to call', 'звони́ть', 'звенеть=to ring', 'звене́ть') },
    ])
    const stale = staleReviewed(words, [
      { a: 'звонить=to call', b: 'звенеть=to ring' },
      { a: 'звонить=to call', b: 'звинеть=typo' },
    ])
    expect(stale).toHaveLength(1)
    expect(stale[0].missing).toEqual(['звинеть=typo'])
  })

  // The ledger outlives the review that wrote it, so a key that has since been
  // renamed would sit there quietly claiming work was done. Cheap to assert.
  it('finds nothing stale in the committed ledger', () => {
    const reviewed = readFileSync(resolve(repoRoot, 'review/confusables-reviewed.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
    expect(reviewed.length).toBeGreaterThan(0)
    for (const r of reviewed) expect(r.why, `${r.a} / ${r.b}`).toBeTruthy()
    const stale = staleReviewed(loadFixtureWords(), reviewed)
    expect(stale, stale.map((r) => r.missing.join(', ')).join('\n')).toEqual([])
  })
})

const pairOf = (aKey, aRu, bKey, bRu) => `
words:
  "${aKey}":
    cefr_level: A2
    accented: ${aRu}
    en_gb: { standard: ${aKey.split('=')[1]} }
  "${bKey}":
    cefr_level: A2
    accented: ${bRu}
    en_gb: { standard: ${bKey.split('=')[1]} }
`
