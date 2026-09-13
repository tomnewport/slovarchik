import { describe, it, expect } from 'vitest'

import {
  auditAnnotations,
  auditLemmaLinks,
  conflictingAnnotations,
  divergentDuplicates,
  ratchetFailures,
  residue,
  shippedPhrases,
  staleBaselineEntries,
} from './check-align.mjs'
import { buildWords } from '../src/lib/vocabBuild.js'
import { buildFormIndex } from '../src/lib/phraseHint.js'

/**
 * A corpus built the way the app builds one, so the gate is exercised against
 * real normalised records rather than hand-shaped stand-ins: `usage`, `lemma:`
 * and `learn: false` all have to survive `buildWords` for these checks to mean
 * anything.
 */
const corpus = (files) => buildWords(files)

/** «мыть» and the pronoun «мой» — one contested token, two unrelated words. */
const WASH = {
  pos: 'verb',
  doc: {
    words: {
      'мыть=to wash': {
        cefr_level: 'A2',
        accented: 'мыть',
        en_gb: { standard: 'to wash' },
        conjugation: { imp_sg: 'мой' },
        usage: [{ ru: 'Мой ру́ки.', en_gb: 'Wash your hands.' }],
      },
    },
  },
}
const MY = {
  pos: 'pronoun',
  doc: {
    words: {
      'мой=my': { cefr_level: 'A1', accented: 'мой', en_gb: { standard: 'my' } },
    },
  },
}

describe('shippedPhrases', () => {
  it('keeps one phrase per sentence and merges the copies’ align blocks', () => {
    // The same sentence filed under two words, annotated on the second copy.
    // The app resolves the first, so the annotation has to travel to it.
    const words = corpus([
      {
        pos: 'verb',
        doc: {
          words: {
            'мыть=to wash': {
              ...WASH.doc.words['мыть=to wash'],
              usage: [{ ru: 'Мой ру́ки.', en_gb: 'Wash your hands.' }],
            },
            'аб=a': {
              cefr_level: 'A1',
              accented: 'аб',
              en_gb: { standard: 'a' },
              usage: [{ ru: 'Мой ру́ки.', en_gb: 'Go and wash.', align: { 1: 'мыть=to wash' } }],
            },
          },
        },
      },
      MY,
    ])
    const shipped = shippedPhrases(words)
    const phrase = shipped.filter((p) => p.ru === 'Мой ру́ки.')
    expect(phrase).toHaveLength(1)
    expect(phrase[0].align).toEqual({ 1: 'мыть=to wash' })
  })
})

describe('residue', () => {
  /**
   * «Мой дом.» rather than «Мой ру́ки.»: the English of the latter says "wash",
   * which vouches for the verb and lets the evidence rung settle the token. Here
   * "house" speaks for neither candidate and "my" is a stop word, so the token
   * reaches the end of the ladder unsettled — which is what this is measuring.
   */
  const sentence = (extra = {}) =>
    corpus([
      WASH,
      {
        pos: 'pronoun',
        doc: {
          words: {
            'мой=my': {
              ...MY.doc.words['мой=my'],
              usage: [{ ru: 'Мой дом.', en_gb: 'My house.', ...extra }],
            },
          },
        },
      },
    ])

  it('counts every contested token nothing settles, grouped by candidate set', () => {
    const { groups, settled } = residue(sentence())
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ group: 'мой=my|мыть=to wash', count: 1 })
    expect(groups[0].samples[0]).toMatchObject({ token: 1, ru: 'Мой дом.' })
    expect(settled.get('unresolved')).toBe(1)
  })

  it('reports nothing once the sentence is annotated', () => {
    const { groups, settled } = residue(sentence({ align: { 1: 'мой=my' } }))
    expect(groups).toEqual([])
    expect(settled.get('authored')).toBe(1)
  })
})

describe('auditAnnotations', () => {
  const annotate = (align) =>
    corpus([
      {
        pos: 'verb',
        doc: {
          words: {
            'мыть=to wash': {
              ...WASH.doc.words['мыть=to wash'],
              usage: [{ ru: 'Мой ру́ки.', en_gb: 'Wash your hands.', align }],
            },
          },
        },
      },
      MY,
    ])
  const audit = (align) => {
    const words = annotate(align)
    return auditAnnotations(words, buildFormIndex(words)).problems
  }

  it('passes a well-formed annotation', () => {
    expect(audit({ 1: 'мыть=to wash' })).toEqual([])
  })

  it('catches an index past the end of the sentence', () => {
    expect(audit({ 9: 'мыть=to wash' })[0]).toMatch(/outside the sentence's 2 tokens/)
  })

  it('catches a word that is not in the corpus', () => {
    expect(audit({ 1: 'мыло=soap' })[0]).toMatch(/not a word in the corpus/)
  })

  it('catches a word the token could not be', () => {
    expect(audit({ 2: 'мыть=to wash' })[0]).toMatch(/is not a form of/)
  })

  it('catches an annotation on a token nothing contests', () => {
    // Drop the pronoun and «Мой» is only ever the verb, so saying so is dead
    // weight — and dead weight is what silently becomes wrong when the corpus
    // moves under it.
    const onlyVerb = corpus([
      {
        pos: 'verb',
        doc: {
          words: {
            'мыть=to wash': {
              ...WASH.doc.words['мыть=to wash'],
              usage: [{ ru: 'Мой ру́ки.', en_gb: 'Wash your hands.', align: { 1: 'мыть=to wash' } }],
            },
          },
        },
      },
    ])
    expect(auditAnnotations(onlyVerb, buildFormIndex(onlyVerb)).problems[0]).toMatch(
      /is not contested/,
    )
  })
})

describe('conflictingAnnotations', () => {
  it('passes copies that agree', () => {
    const byPhrase = new Map([
      [
        'Мой ру́ки.',
        [
          { key: 'a=a', align: { 1: 'мыть=to wash' } },
          { key: 'b=b', align: { 1: 'мыть=to wash' } },
        ],
      ],
    ])
    expect(conflictingAnnotations(byPhrase)).toEqual([])
  })

  it('catches copies that disagree about one token', () => {
    const byPhrase = new Map([
      [
        'Мой ру́ки.',
        [
          { key: 'a=a', align: { 1: 'мыть=to wash' } },
          { key: 'b=b', align: { 1: 'мой=my' } },
        ],
      ],
    ])
    expect(conflictingAnnotations(byPhrase)[0]).toMatch(/aligned to мыть=to wash by a=a/)
  })

  it('says nothing about a sentence that appears once', () => {
    expect(conflictingAnnotations(new Map([['x', [{ key: 'a=a', align: { 1: 'b=b' } }]]]))).toEqual(
      [],
    )
  })
})

describe('auditLemmaLinks', () => {
  const stub = (extra) =>
    corpus([
      WASH,
      {
        pos: 'glossary',
        doc: {
          words: {
            'мой=wash!': {
              cefr_level: 'A2',
              learn: false,
              accented: 'мой',
              en_gb: { standard: 'wash (imperative)' },
              ...extra,
            },
          },
        },
      },
    ])

  it('passes a stub pointing at a word it really is a form of', () => {
    expect(auditLemmaLinks(stub({ lemma: 'мыть=to wash' }))).toEqual([])
  })

  it('says nothing about a stub with no link at all', () => {
    expect(auditLemmaLinks(stub({}))).toEqual([])
  })

  it('catches a link to a word that is not in the corpus', () => {
    expect(auditLemmaLinks(stub({ lemma: 'мыло=soap' }))[0]).toMatch(/names no word in the corpus/)
  })

  it('catches a link to a word the stub is not a form of', () => {
    const words = corpus([
      WASH,
      MY,
      {
        pos: 'glossary',
        doc: {
          words: {
            'аби=abi': {
              cefr_level: 'B1',
              learn: false,
              accented: 'аби',
              lemma: 'мыть=to wash',
              en_gb: { standard: 'abi' },
            },
          },
        },
      },
    ])
    expect(auditLemmaLinks(words)[0]).toMatch(/is not a form of/)
  })

  it('catches a chain through a second gloss-only entry', () => {
    // `lexeme()` follows one hop by design, so a chain stops at the middle link
    // and the collapse quietly does nothing.
    const words = corpus([
      WASH,
      {
        pos: 'glossary',
        doc: {
          words: {
            'мой=wash!': {
              cefr_level: 'A2',
              learn: false,
              accented: 'мой',
              lemma: 'мою=washing',
              en_gb: { standard: 'wash (imperative)' },
            },
            'мою=washing': {
              cefr_level: 'A2',
              learn: false,
              accented: 'мою',
              en_gb: { standard: 'washing' },
            },
          },
        },
      },
    ])
    expect(auditLemmaLinks(words)[0]).toMatch(/names another gloss-only entry/)
  })

  it('catches a link on a word the curriculum teaches', () => {
    const words = corpus([
      WASH,
      {
        pos: 'pronoun',
        doc: {
          words: {
            'мой=my': { ...MY.doc.words['мой=my'], lemma: 'мыть=to wash' },
          },
        },
      },
    ])
    expect(auditLemmaLinks(words)[0]).toMatch(/is on a curriculum word/)
  })
})

describe('divergentDuplicates', () => {
  /** One sentence under two words, each `inflect:` naming the same token. */
  const twice = (align) =>
    corpus([
      {
        pos: 'verb',
        doc: {
          words: {
            'мыть=to wash': {
              ...WASH.doc.words['мыть=to wash'],
              usage: [
                {
                  ru: 'Мой ру́ки.',
                  en_gb: 'Wash your hands.',
                  inflect: { token: 1, tense: 'imperative', person: 'imp_sg' },
                },
              ],
            },
          },
        },
      },
      {
        pos: 'pronoun',
        doc: {
          words: {
            'мой=my': {
              ...MY.doc.words['мой=my'],
              usage: [
                {
                  ru: 'Мой ру́ки.',
                  en_gb: 'My hands.',
                  inflect: { token: 1, case: 'nom', number: 'sg' },
                  ...(align ? { align } : {}),
                },
              ],
            },
          },
        },
      },
    ])

  it('catches a token whose answer depends on which copy is kept', () => {
    const words = twice(null)
    const problems = divergentDuplicates(words, buildFormIndex(words))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/resolves differently/)
    expect(problems[0]).toMatch(/мыть=to wash/)
    expect(problems[0]).toMatch(/мой=my/)
  })

  it('is settled by one align: block on either copy, because align merges', () => {
    const words = twice({ 1: 'мыть=to wash' })
    expect(divergentDuplicates(words, buildFormIndex(words))).toEqual([])
  })

  it('says nothing when the sentence appears once', () => {
    const words = corpus([WASH, MY])
    expect(divergentDuplicates(words, buildFormIndex(words))).toEqual([])
  })
})

describe('ratchetFailures', () => {
  const baseline = { groups: { 'a|b': 3 } }

  it('passes a group inside its allowance', () => {
    expect(ratchetFailures([{ group: 'a|b', count: 3, samples: [] }], baseline)).toEqual([])
  })

  it('fails a group that grew', () => {
    const [failure] = ratchetFailures([{ group: 'a|b', count: 4, samples: [] }], baseline)
    expect(failure).toMatchObject({ group: 'a|b', count: 4, limit: 3, fresh: false })
  })

  it('fails a group the baseline has never seen', () => {
    const [failure] = ratchetFailures([{ group: 'c|d', count: 1, samples: [] }], baseline)
    expect(failure).toMatchObject({ group: 'c|d', limit: 0, fresh: true })
  })

  it('treats a missing baseline as allowing nothing', () => {
    expect(ratchetFailures([{ group: 'a|b', count: 1, samples: [] }], undefined)).toHaveLength(1)
  })
})

describe('staleBaselineEntries', () => {
  it('names a line whose group has been annotated away', () => {
    const stale = staleBaselineEntries([{ group: 'a|b', count: 1 }], {
      groups: { 'a|b': 1, 'c|d': 4 },
    })
    expect(stale).toEqual([{ group: 'c|d', limit: 4 }])
  })

  it('leaves a line alone while its group still has residue', () => {
    expect(staleBaselineEntries([{ group: 'a|b', count: 1 }], { groups: { 'a|b': 9 } })).toEqual([])
  })
})
