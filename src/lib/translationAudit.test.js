import { describe, it, expect } from 'vitest'
import {
  englishWords,
  stemEnglish,
  alignsWith,
  glossHeadWords,
  alignPhrase,
  auditPhrase,
  auditPhrases,
  tierOf,
  priorityScore,
  tierCounts,
} from './translationAudit.js'
import { buildFormIndex } from './phraseHint.js'
import { buildWords } from './vocabBuild.js'

/**
 * A miniature dictionary, built through the real normaliser so the records have
 * the shape buildFormIndex expects. Small enough to reason about, which is the
 * point — these are unit tests of the alignment, not of the corpus.
 */
const words = buildWords([
  {
    pos: 'noun',
    doc: {
      words: {
        'книга=book': {
          cefr_level: 'A1',
          en_gb: { standard: 'book (a bound text)' },
          declension: { sg_nom: 'кни́га', sg_acc: 'кни́гу', pl_nom: 'кни́ги' },
        },
        'мальчик=boy': {
          cefr_level: 'A1',
          en_gb: { standard: 'boy' },
          declension: { sg_nom: 'ма́льчик' },
        },
        'бабушка=grandmother': {
          cefr_level: 'A1',
          en_gb: { standard: 'grandmother' },
          declension: { sg_nom: 'ба́бушка' },
        },
      },
    },
  },
  {
    pos: 'verb',
    doc: {
      words: {
        'читать=to read': {
          cefr_level: 'A1',
          en_gb: { standard: 'to read' },
          conjugation: { present: 'чита́ет', past_m: 'чита́л', past_f: 'чита́ла' },
        },
      },
    },
  },
])
const index = buildFormIndex(words)

describe('englishWords', () => {
  it('lower-cases and drops punctuation', () => {
    expect(englishWords('The Boy reads, quietly.')).toEqual(['the', 'boy', 'reads', 'quietly'])
  })

  it('expands negative contractions so "не" has something to align with', () => {
    expect(englishWords("he doesn't read")).toEqual(['he', 'does', 'not', 'read'])
    expect(englishWords("he won't read")).toEqual(['he', 'will', 'not', 'read'])
    expect(englishWords("he can't read")).toEqual(['he', 'can', 'not', 'read'])
    expect(englishWords("he shan't read")).toEqual(['he', 'shall', 'not', 'read'])
  })

  it('expands the remaining contractions', () => {
    expect(englishWords("I'll go")).toEqual(['i', 'will', 'go'])
    expect(englishWords("we've gone")).toEqual(['we', 'have', 'gone'])
    expect(englishWords("they're here")).toEqual(['they', 'are', 'here'])
    expect(englishWords("I'd go")).toEqual(['i', 'would', 'go'])
    expect(englishWords("I'm here")).toEqual(['i', 'am', 'here'])
    expect(englishWords("it's here")).toEqual(['it', 'is', 'here'])
  })

  it('returns nothing for empty or nullish input', () => {
    expect(englishWords('')).toEqual([])
    expect(englishWords(null)).toEqual([])
  })
})

describe('stemEnglish', () => {
  it('folds regular plurals and past/progressive forms', () => {
    expect(stemEnglish('victories')).toBe('victory')
    expect(stemEnglish('books')).toBe('book')
    expect(stemEnglish('watches')).toBe('watch')
    expect(stemEnglish('running')).toBe('run')
    expect(stemEnglish('carried')).toBe('carry')
    expect(stemEnglish('knives')).toBe('knif')
  })

  it('leaves a word ending in double-s alone', () => {
    expect(stemEnglish('glass')).toBe('glass')
  })
})

describe('alignsWith', () => {
  it('matches identical and inflected forms', () => {
    expect(alignsWith('book', 'book')).toBe(true)
    expect(alignsWith('victory', 'victories')).toBe(true)
  })

  it('matches derivational pairs where one extends the other', () => {
    expect(alignsWith('teach', 'teacher')).toBe(true)
    expect(alignsWith('quick', 'quickly')).toBe(true)
  })

  it('does not match unrelated short words', () => {
    expect(alignsWith('boy', 'bus')).toBe(false)
    expect(alignsWith('read', 'ride')).toBe(false)
  })
})

describe('glossHeadWords', () => {
  it('drops the parenthetical explanation and grammatical words', () => {
    expect(glossHeadWords('bus (a large road vehicle for many people)')).toEqual(['bus'])
    expect(glossHeadWords('to read')).toEqual(['read'])
  })
})

describe('alignPhrase', () => {
  it('scores a word-for-word translation as fully literal', () => {
    const r = alignPhrase('Ма́льчик чита́ет кни́гу.', 'The boy reads a book.', index)
    expect(r.literalness).toBe(1)
    expect(r.glossMisses).toEqual([])
    expect(r.addedEnglish).toEqual([])
  })

  it('reports English words with no Russian source', () => {
    const r = alignPhrase('Ма́льчик чита́ет кни́гу.', 'The boy reads a book to us.', index)
    expect(r.addedEnglish).toEqual(['us'])
  })

  it('reports a Russian word whose gloss is absent from the English', () => {
    const r = alignPhrase('Ба́бушка чита́ет.', 'Grandma reads.', index)
    expect(r.glossMisses.map((m) => m.ru)).toEqual(['Ба́бушка'])
    expect(r.literalness).toBe(0.5)
  })

  it('aligns oblique pronouns against their English case forms', () => {
    // «него» is glossed nowhere in the corpus; the closed-class table covers it.
    const r = alignPhrase('Он чита́ет для него́.', 'He reads for him.', index)
    expect(r.glossMisses).toEqual([])
    expect(r.unglossed).toEqual([])
  })

  it('aligns negation with an expanded contraction', () => {
    const r = alignPhrase('Он не чита́ет.', "He doesn't read.", index)
    expect(r.glossMisses).toEqual([])
  })

  it('accepts any usual English realisation of a preposition', () => {
    expect(alignPhrase('кни́га в', 'a book at', index).glossMisses).toEqual([])
    expect(alignPhrase('кни́га в', 'a book into', index).glossMisses).toEqual([])
  })

  it('flags a token no dictionary entry covers', () => {
    const r = alignPhrase('Ма́льчик квази́рует.', 'The boy quasifies.', index)
    expect(r.unglossed).toEqual(['квази́рует.'])
  })

  it('ignores particles and the copula', () => {
    const r = alignPhrase('Он бы чита́л же.', 'He would read.', index)
    expect(r.content).toBe(2) // он + читал; бы and же do not count
  })

  it('treats an empty phrase as vacuously literal', () => {
    expect(alignPhrase('', '', index).literalness).toBe(1)
  })

  it('consumes each English word at most once', () => {
    // Two Russian tokens glossing to "book" cannot both align to one "book".
    const r = alignPhrase('кни́га кни́га', 'a book', index)
    expect(r.glossMisses).toHaveLength(1)
  })
})

describe('tierOf', () => {
  const base = {
    content: 4, literalness: 1, glossMisses: [], unglossed: [], addedEnglish: [],
    commas: 0, dash: false, colon: false, lengthRatio: 1,
  }

  it('puts an ungloss-able token in the high tier', () => {
    expect(tierOf({ ...base, unglossed: ['x'] })).toBe('high')
  })

  it('puts a mostly unaligned sentence in the high tier', () => {
    expect(tierOf({ ...base, literalness: 0.5 })).toBe('high')
  })

  it('does not promote a very short sentence on literalness alone', () => {
    expect(tierOf({ ...base, content: 2, literalness: 0 })).not.toBe('high')
  })

  it('uses the medium tier for the weaker signals', () => {
    expect(tierOf({ ...base, glossMisses: [1, 2] })).toBe('medium')
    expect(tierOf({ ...base, addedEnglish: ['a', 'b'] })).toBe('medium')
    expect(tierOf({ ...base, commas: 1 })).toBe('medium')
    expect(tierOf({ ...base, dash: true })).toBe('medium')
    expect(tierOf({ ...base, colon: true })).toBe('medium')
    expect(tierOf({ ...base, lengthRatio: 2 })).toBe('medium')
  })

  it('calls a phrase tripping nothing clean', () => {
    expect(tierOf(base)).toBe('clean')
  })
})

describe('priorityScore', () => {
  const base = {
    content: 4, literalness: 1, glossMisses: [], unglossed: [], addedEnglish: [],
    commas: 0, dash: false, colon: false, lengthRatio: 1,
  }

  it('is zero for a phrase tripping nothing', () => {
    expect(priorityScore(base)).toBe(0)
  })

  it('rises with every signal, never falls', () => {
    expect(priorityScore({ ...base, literalness: 0.5 })).toBeGreaterThan(0)
    expect(priorityScore({ ...base, unglossed: ['x'] })).toBeGreaterThan(0)
    expect(priorityScore({ ...base, addedEnglish: ['x'] })).toBeGreaterThan(0)
    expect(priorityScore({ ...base, commas: 2 })).toBeGreaterThan(0)
    expect(priorityScore({ ...base, lengthRatio: 3 })).toBeGreaterThan(0)
  })

  it('ranks a longer unaligned sentence above a shorter one', () => {
    const short = priorityScore({ ...base, content: 3, literalness: 0 })
    const long = priorityScore({ ...base, content: 8, literalness: 0 })
    expect(long).toBeGreaterThan(short)
  })
})

describe('auditPhrase', () => {
  it('carries the phrase through with its signals and tier', () => {
    const row = auditPhrase({ ru: 'Ма́льчик чита́ет кни́гу.', en: 'The boy reads a book.', source: 'книга=book', cefr: 'A1' }, index)
    expect(row.source).toBe('книга=book')
    expect(row.cefr).toBe('A1')
    expect(row.ruLength).toBe(3)
    expect(row.tier).toBe('clean')
  })

  it('counts clause markers on the Russian side', () => {
    const row = auditPhrase({ ru: 'Он чита́ет, но не понима́ет — увы.', en: 'He reads.' }, index)
    expect(row.commas).toBe(1)
    expect(row.dash).toBe(true)
  })

  it('tolerates a missing phrase object', () => {
    expect(() => auditPhrase(undefined, index)).not.toThrow()
  })
})

describe('auditPhrases', () => {
  const phrases = [
    { ru: 'Ма́льчик чита́ет кни́гу.', en: 'The boy reads a book.', source: 'книга=book' },
    { ru: 'Ба́бушка чита́ет кни́гу, и мы слу́шаем.', en: 'Grandma reads a book aloud to everyone.', source: 'книга=book' },
  ]

  it('returns a row per phrase, most suspicious first', () => {
    const rows = auditPhrases(phrases, words)
    expect(rows).toHaveLength(2)
    expect(rows[0].priority).toBeGreaterThanOrEqual(rows[1].priority)
    expect(rows[0].ru).toContain('Ба́бушка')
  })

  it('handles an empty bank', () => {
    expect(auditPhrases([], words)).toEqual([])
    expect(auditPhrases(undefined, words)).toEqual([])
  })
})

describe('tierCounts', () => {
  it('counts each tier', () => {
    expect(tierCounts([{ tier: 'high' }, { tier: 'high' }, { tier: 'clean' }]))
      .toEqual({ high: 2, medium: 0, clean: 1 })
  })

  it('handles no rows', () => {
    expect(tierCounts()).toEqual({ high: 0, medium: 0, clean: 0 })
  })
})
