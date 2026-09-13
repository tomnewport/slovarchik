import { describe, it, expect } from 'vitest'

import { applyLinks, proposeLemmaLinks } from './gen-lemma-links.mjs'
import { buildWords } from '../src/lib/vocabBuild.js'

/** «купи́ть», whose imperative «купи́» the glossary carries as a stub. */
const BUY = {
  pos: 'verb',
  doc: {
    words: {
      'купить=to buy': {
        cefr_level: 'A2',
        accented: 'купи́ть',
        en_gb: { standard: 'to buy' },
        conjugation: { imp_sg: 'купи́' },
      },
    },
  },
}

const glossary = (words) => ({ pos: 'glossary', doc: { words } })

const stub = (key, accented, extra = {}) => ({
  [key]: {
    cefr_level: 'B1',
    learn: false,
    accented,
    en_gb: { standard: 'x' },
    ...extra,
  },
})

describe('proposeLemmaLinks', () => {
  it('links a stub whose form sits in exactly one paradigm', () => {
    const words = buildWords([BUY, glossary(stub('купи=buy', 'купи́'))])
    expect(proposeLemmaLinks(words).linked).toEqual([{ key: 'купи=buy', lemma: 'купить=to buy' }])
  })

  it('leaves a form two curriculum words share for a human', () => {
    const rival = {
      pos: 'noun',
      doc: {
        words: {
          'купа=heap': {
            cefr_level: 'B1',
            accented: 'купа́',
            en_gb: { standard: 'heap' },
            declension: { sg: { dat: 'купи́' } },
          },
        },
      },
    }
    const words = buildWords([BUY, rival, glossary(stub('купи=buy', 'купи́'))])
    const { linked, contested } = proposeLemmaLinks(words)
    expect(linked).toEqual([])
    expect(contested[0].candidates.sort()).toEqual(['купа=heap', 'купить=to buy'])
  })

  it('refuses a stub spelled like its would-be owner’s dictionary form', () => {
    // «есть» "there is" is not a form of «есть» "to eat" — it is a homograph,
    // and a link would credit the wrong lexeme in every sentence for ever.
    const eat = {
      pos: 'verb',
      doc: {
        words: {
          'есть=to eat': { cefr_level: 'A1', accented: 'есть', en_gb: { standard: 'to eat' } },
        },
      },
    }
    const words = buildWords([eat, glossary(stub('есть=there is', 'есть'))])
    const { linked, orphan } = proposeLemmaLinks(words)
    expect(linked).toEqual([])
    expect(orphan.map((o) => o.key)).toContain('есть=there is')
  })

  it('leaves a stub that is already linked alone', () => {
    const words = buildWords([BUY, glossary(stub('купи=buy', 'купи́', { lemma: 'купить=to buy' }))])
    expect(proposeLemmaLinks(words).linked).toEqual([])
  })

  it('reports a stub no curriculum paradigm covers', () => {
    const words = buildWords([BUY, glossary(stub('азии=Asia', 'а́зии'))])
    expect(proposeLemmaLinks(words).orphan.map((o) => o.key)).toEqual(['азии=Asia'])
  })

  it('never proposes a link for a curriculum word', () => {
    const words = buildWords([BUY])
    const { linked, contested, orphan } = proposeLemmaLinks(words)
    expect([...linked, ...contested, ...orphan]).toEqual([])
  })
})

describe('applyLinks', () => {
  const file = [
    '# header comment',
    '---',
    'words:',
    '  "купи=buy":',
    '    cefr_level: B1',
    '    learn: false',
    '    accented: "купи́"',
    '  "азии=Asia":',
    '    cefr_level: B1',
    '    learn: false',
    '    accented: "а́зии"',
    '',
  ].join('\n')

  it('writes the link under the entry’s learn: false line', () => {
    const out = applyLinks(file, [{ key: 'купи=buy', lemma: 'купить=to buy' }])
    expect(out).toContain('    learn: false\n    lemma: "купить=to buy"\n    accented: "купи́"')
  })

  it('leaves every other entry untouched', () => {
    const out = applyLinks(file, [{ key: 'купи=buy', lemma: 'купить=to buy' }])
    expect(out.split('\n').filter((l) => l.startsWith('    lemma:'))).toHaveLength(1)
    expect(out).toContain('# header comment')
    expect(out).toContain('    accented: "а́зии"')
  })

  it('is a no-op when there is nothing to link', () => {
    expect(applyLinks(file, [])).toBe(file)
  })

  it('is idempotent — re-running proposes nothing to rewrite', () => {
    const once = applyLinks(file, [{ key: 'купи=buy', lemma: 'купить=to buy' }])
    expect(applyLinks(once, [])).toBe(once)
  })
})
