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
  auditAlternates,
  verbRendering,
  aspectCollisions,
  duplicateEnglish,
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

  it('excuses the relative pronoun a participle forces into the English', () => {
    // «Люби́вший» is one word; English can only say it with a relative clause.
    const r = alignPhrase('Люби́вший ма́льчик чита́ет.', 'The boy who loved reads.', index)
    expect(r.addedEnglish).not.toContain('who')
  })

  it('excuses the conjunction an adverbial gerund forces', () => {
    const r = alignPhrase('Чита́я, ма́льчик молча́л.', 'While reading, the boy was silent.', index)
    expect(r.addedEnglish).not.toContain('while')
  })

  it('still counts a relative pronoun when no participle licenses it', () => {
    const r = alignPhrase('Ма́льчик чита́ет.', 'The boy who reads.', index)
    expect(r.addedEnglish).toContain('who')
  })

  it('does not treat an ordinary adjective in -нный as a participle', () => {
    // дли́нный is an adjective, not a participle, so "that" stays flagged.
    const r = alignPhrase('Дли́нный ма́льчик чита́ет.', 'The long boy that reads.', index)
    expect(r.addedEnglish).toContain('that')
  })

  it('lets a Russian token claim its subordinator before it is excused', () => {
    // «что» glosses as "that"; the participle must not steal its target.
    const r = alignPhrase('Чита́вший ма́льчик знал, что.', 'The boy who read knew that.', index)
    expect(r.addedEnglish).not.toContain('that')
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

describe('verbRendering', () => {
  const hear = { meaning: 'to hear' }

  it('returns the auxiliary chain plus the verb as written', () => {
    expect(verbRendering('I would hear the bell.', hear)).toBe('would hear')
    expect(verbRendering('I would have heard the bell.', hear)).toBe('would have heard')
  })

  it('keeps the main verb unstemmed, so tense still separates', () => {
    expect(verbRendering('She thanked him.', { meaning: 'to thank' })).toBe('thanked')
    expect(verbRendering('She thanks him.', { meaning: 'to thank' })).not.toBe('thanked')
  })

  it('returns null when the English contains no form of the verb', () => {
    expect(verbRendering('She left the room.', hear)).toBeNull()
    expect(verbRendering('anything', {})).toBeNull()
  })
})

describe('aspectCollisions', () => {
  const pair = buildWords([
    {
      pos: 'verb',
      doc: {
        words: {
          'слышать=to hear': {
            cefr_level: 'A2', aspect: 'impf', pair: 'услышать=to hear',
            en_gb: { standard: 'to hear' },
          },
          'услышать=to hear': {
            cefr_level: 'A2', aspect: 'pf', pair: 'слышать=to hear',
            en_gb: { standard: 'to hear' },
          },
        },
      },
    },
  ])

  const phrase = (source, ru, en) => ({ source, ru, en })

  it('reports a pair whose two members read the same', () => {
    const found = aspectCollisions(pair, [
      phrase('слышать=to hear', 'Без шу́ма я бы слы́шала ка́ждое сло́во.', 'Without the noise I would hear every word.'),
      phrase('услышать=to hear', 'Будь му́зыка поти́ше, я услы́шала бы звоно́к.', 'I would hear the bell if the music were quieter.'),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rendering).toBe('would hear')
    expect(found[0].severity).toBe('frame')
  })

  it('marks an identical English sentence as the worse severity', () => {
    const found = aspectCollisions(pair, [
      phrase('слышать=to hear', 'Она́ слы́шала его́.', 'She heard him.'),
      phrase('услышать=to hear', 'Она́ услы́шала его́.', 'She heard him.'),
    ])
    expect(found[0].severity).toBe('identical')
  })

  it('reports nothing when the English distinguishes the aspects', () => {
    expect(aspectCollisions(pair, [
      phrase('слышать=to hear', 'Без шу́ма я бы слы́шала ка́ждое сло́во.', 'Without the noise I would hear every word.'),
      phrase('услышать=to hear', 'Будь му́зыка поти́ше, я услы́шала бы звоно́к.', 'I would have heard the bell if the music had been quieter.'),
    ])).toEqual([])
  })

  it('examines an unordered pair only once', () => {
    const found = aspectCollisions(pair, [
      phrase('слышать=to hear', 'Она́ слы́шала его́.', 'She heard him.'),
      phrase('услышать=to hear', 'Она́ услы́шала его́.', 'She heard him.'),
    ])
    expect(found).toHaveLength(1)
  })

  it('handles an empty corpus', () => {
    expect(aspectCollisions([], [])).toEqual([])
    expect(aspectCollisions(undefined, undefined)).toEqual([])
  })
})

describe('duplicateEnglish', () => {
  const p = (source, ru, en) => ({ source, ru, en })

  it('groups distinct Russian sentences sharing one English', () => {
    const found = duplicateEnglish([
      p('беспокоиться=to worry', 'Не беспоко́йся, всё бу́дет хорошо́.', "Don't worry, everything will be fine."),
      p('волноваться=to worry', 'Не волну́йся, всё бу́дет хорошо́.', "Don't worry, everything will be fine."),
      p('книга=book', 'Я чита́ю кни́гу.', 'I am reading a book.'),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].phrases).toHaveLength(2)
  })

  it('ignores punctuation and case when comparing the English', () => {
    expect(duplicateEnglish([
      p('a=a', 'Оди́н.', 'It is fine!'),
      p('b=b', 'Два.', 'it is fine'),
    ])).toHaveLength(1)
  })

  it('treats one sentence reused under two headwords as no clash', () => {
    expect(duplicateEnglish([
      p('a=a', 'Одна́ и та́ же.', 'Same sentence.'),
      p('b=b', 'Одна́ и та́ же.', 'Same sentence.'),
    ])).toEqual([])
  })

  it('counts a stress disagreement as two different sentences', () => {
    // This is the point: two copies of one sentence stressed differently is a
    // data bug, and comparing the raw Russian is what exposes it.
    expect(duplicateEnglish([
      p('бассейн=swimming pool', 'По сре́дам я хожу́ в бассе́йн.', 'On Wednesdays I go to the swimming pool.'),
      p('среда=Wednesday', 'По среда́м я хожу́ в бассе́йн.', 'On Wednesdays I go to the swimming pool.'),
    ])).toHaveLength(1)
  })

  it('handles an empty bank', () => {
    expect(duplicateEnglish([])).toEqual([])
    expect(duplicateEnglish(undefined)).toEqual([])
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

describe('auditAlternates', () => {
  const p = (source, ru, en, enAlt = []) => ({ source, ru, en, enAlt })

  it('says nothing about a corpus whose alternates are ordinary paraphrases', () => {
    // The point of the whole design. Low content-word overlap is what a *good*
    // English paraphrase looks like — these two share nothing and are both
    // right — so overlap alone must never flag on its own.
    expect(auditAlternates([
      p('голова=head', 'У меня́ боли́т голова́.', 'I have a headache.', ['My head hurts.']),
    ])).toEqual([])
  })

  it('flags the «утро» signature: alternates that describe a different sentence', () => {
    // The one known instance, as review/alt-removals.jsonl recorded it: three
    // renderings of «Он рабо́тает с утра́ до ве́чера» left behind on a sentence
    // they have nothing to do with.
    const rows = auditAlternates([
      p('утро=morning', 'Он дожда́лся у́тра до́ма.', 'He waited for the morning at home.', [
        'From morning till evening he works.',
        'He works from morning to evening.',
        'From morning to evening he works.',
      ]),
    ])
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.signals).toContain('orphan-block')
  })

  it('does not call a lone divergent alternate an orphan', () => {
    // Cohesion needs a block. One alternate cannot corroborate itself, however
    // little it shares with the primary.
    expect(auditAlternates([
      p('звонок=bell', 'В дверь позвони́ли.', 'There was a ring at the door.', ['The doorbell rang.']),
    ])).toEqual([])
  })

  it('flags an alternate that is verbatim the aspect partner\'s own sentence', () => {
    // Grading, not the contrast drill: answering the imperfective sentence with
    // the perfective reading is marked correct, so the aspect goes untaught.
    const words = [
      { key: 'благодарить=to thank', aspectPair: { key: 'поблагодарить=to thank' } },
      { key: 'поблагодарить=to thank', aspectPair: { key: 'благодарить=to thank' } },
    ]
    const rows = auditAlternates([
      p('благодарить=to thank', 'Она́ благодари́ла учи́теля.', 'She was thanking the teacher.', ['She thanked the teacher.']),
      p('поблагодарить=to thank', 'Она́ поблагодари́ла учи́теля.', 'She thanked the teacher.'),
    ], { words })
    expect(rows).toHaveLength(1)
    expect(rows[0].signals).toContain('foreign-partner')
    expect(rows[0].alsoTranslates).toEqual(['Она́ поблагодари́ла учи́теля.'])
  })

  it('calls a shared rendering merely foreign when the words are unrelated', () => {
    const rows = auditAlternates([
      p('заходить=to drop in', 'Заходи́те к нам в го́сти!', 'Drop in to visit us!', ['Come and visit us!']),
      p('приходить=to come', 'Приходи́ к нам в го́сти.', 'Come and visit us!'),
    ])
    expect(rows[0].signals).toEqual(['foreign'])
  })

  it('flags an alternate that only re-punctuates its primary', () => {
    const rows = auditAlternates([
      p('ванна=bath', 'Она́ принима́ет горя́чую ва́нну.', "She's taking a hot bath.", ['She is taking a hot bath.']),
    ])
    expect(rows[0].signals).toEqual(['duplicate'])
  })

  it('flags an alternate that re-accepts English a proposal called unnatural', () => {
    const rejected = new Set(['my strength fades towards evening'])
    const rows = auditAlternates([
      p('пропадать=to disappear', 'Си́лы пропада́ют к ве́черу.', 'I run out of energy by evening.', ['My strength fades towards evening.']),
    ], { rejected })
    expect(rows[0].signals).toContain('contradicted')
  })

  it('sorts the sharp signals above the weak ones', () => {
    const rows = auditAlternates([
      p('a=a', 'Оди́н.', 'One.', ['One.']),
      p('утро=morning', 'Он дожда́лся у́тра до́ма.', 'He waited for the morning at home.', [
        'From morning till evening he works.',
        'He works from morning to evening.',
      ]),
    ])
    expect(rows[0].signals).toContain('orphan-block')
  })

  it('handles a corpus with no alternates at all', () => {
    expect(auditAlternates([p('a=a', 'Оди́н.', 'One.')])).toEqual([])
    expect(auditAlternates(undefined)).toEqual([])
  })
})
