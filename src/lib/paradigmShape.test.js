import { describe, it, expect } from 'vitest'

import { buildParadigm, buildNonFiniteParadigm } from './paradigm.js'
import { paradigmNotes } from './paradigmShape.js'
import { loadFixtureWords } from '../test/fixtures.js'

/** A verb record in the shape buildWords() produces. */
const verb = (key, headword, extra, rest = {}) => ({
  key,
  pos: 'verb',
  headword,
  meaning: 'to do',
  extra,
  ...rest,
})

const chitat = verb('читать=to read', 'чита́ть', {
  conjugation: {
    present: {
      '1sg': 'чита́ю',
      '2sg': 'чита́ешь',
      '3sg': 'чита́ет',
      '1pl': 'чита́ем',
      '2pl': 'чита́ете',
      '3pl': 'чита́ют',
    },
    past_m: 'чита́л',
    past_f: 'чита́ла',
    past_n: 'чита́ло',
    past_pl: 'чита́ли',
  },
})

const nachatsya = verb(
  'начаться=to begin',
  'нача́ться',
  {
    conjugation: {
      future: { '3sg': 'начнётся', '3pl': 'начну́тся' },
      past_m: 'нача́лся',
      past_f: 'начала́сь',
      past_n: 'нача́лось',
      past_pl: 'нача́лись',
    },
  },
  { aspect: 'pf', aspectPair: { key: 'начинаться=to begin', ru: 'начина́ться', aspect: 'impf' } },
)

const notesFor = (word) => paradigmNotes(buildParadigm(word))
const keysFor = (word) => notesFor(word).map((n) => n.key)

describe('paradigmNotes — a table that needs no explanation', () => {
  it('says nothing about a full imperfective table', () => {
    expect(notesFor(chitat)).toEqual([])
  })

  it('says nothing about a non-verb, or about a verb variant table', () => {
    const noun = { key: 'стол=table', pos: 'noun', headword: 'стол', forms: {} }
    expect(paradigmNotes(buildParadigm(noun))).toEqual([])
    const pisat = verb('писать=to write', 'писа́ть', {
      conjugation: { present: { '1sg': 'пишу́', '3sg': 'пи́шет' }, past_m: 'писа́л' },
      participles: { act_pres: 'пи́шущий', act_past: 'писа́вший' },
      gerund: 'пиша́',
    })
    // The participle table is gappy for its own reasons — not this module's.
    expect(paradigmNotes(buildNonFiniteParadigm(pisat))).toEqual([])
  })

  it('tolerates a null paradigm', () => {
    expect(paradigmNotes(null)).toEqual([])
  })
})

describe('paradigmNotes — no present tense (perfective)', () => {
  const prochitat = verb(
    'прочитать=to read',
    'прочита́ть',
    {
      conjugation: {
        future: {
          '1sg': 'прочита́ю',
          '2sg': 'прочита́ешь',
          '3sg': 'прочита́ет',
          '1pl': 'прочита́ем',
          '2pl': 'прочита́ете',
          '3pl': 'прочита́ют',
        },
        past_m: 'прочита́л',
      },
    },
    { aspect: 'pf', aspectPair: { key: 'читать=to read', ru: 'чита́ть', aspect: 'impf' } },
  )

  it('explains the Simple Future column and names the imperfective partner', () => {
    const [note, ...rest] = paradigmNotes(buildParadigm(prochitat))
    expect(rest).toEqual([]) // the person axis is complete — nothing else to say
    expect(note.key).toBe('no-present')
    expect(note.text).toMatch(/No present tense/)
    expect(note.ru).toBe('чита́ть')
  })

  it('drops the partner clause when the verb has no imperfective partner', () => {
    const alone = { ...prochitat, aspectPair: null }
    const [note] = paradigmNotes(buildParadigm(alone))
    expect(note.ru).toBeNull()
    expect(note.text).not.toMatch(/partner/)
  })

  it('never fires on an imperfective, whose finite column is a real present', () => {
    expect(keysFor(chitat)).not.toContain('no-present')
  })
})

describe('paradigmNotes — the person axis', () => {
  it('explains a third-person-only verb (начаться), alongside the tense note', () => {
    const notes = notesFor(nachatsya)
    expect(notes.map((n) => n.key)).toEqual(['no-present', 'third-person'])
    expect(notes[1].text).toMatch(/Third person only/)
    expect(notes[1].text).toMatch(/missing from the language, not from the app/)
    // Its past agrees for gender, so the neuter/plural clause stays off.
    expect(notes[1].text).not.toMatch(/neuter or a plural/)
  })

  it('adds the past-agreement clause when the past has no masculine/feminine', () => {
    const govoritsya = verb('говориться=to be said', 'говори́ться', {
      defective: true,
      conjugation: {
        present: { '3sg': 'говори́тся', '3pl': 'говоря́тся' },
        past_n: 'говори́лось',
        past_pl: 'говори́лись',
      },
    })
    const [note] = notesFor(govoritsya)
    expect(note.key).toBe('third-person')
    expect(note.text).toMatch(/neuter or a plural/)
  })

  it('explains an impersonal verb (повезти) as subjectless, with a dative example', () => {
    const povezti = verb(
      'повезти=to be lucky',
      'повезти́',
      { defective: true, conjugation: { future: { '3sg': 'повезёт' }, past_n: 'повезло́' } },
      { aspect: 'pf' },
    )
    const notes = notesFor(povezti)
    expect(notes.map((n) => n.key)).toEqual(['no-present', 'impersonal'])
    expect(notes[1].text).toMatch(/no subject at all/)
    expect(notes[1].ru).toBe('мне повезло́')
  })

  it('explains a verb whose every person cell holds the same form (хотеться)', () => {
    const khotetsya = verb('хотеться=to feel like', 'хоте́ться', {
      conjugation: {
        present: {
          '1sg': 'хо́чется',
          '2sg': 'хо́чется',
          '3sg': 'хо́чется',
          '1pl': 'хо́чется',
          '2pl': 'хо́чется',
          '3pl': 'хо́чется',
        },
        past_n: 'хоте́лось',
      },
    })
    const [note] = notesFor(khotetsya)
    expect(note.key).toBe('invariant-person')
    expect(note.text).toMatch(/One form for every person/)
    expect(note.ru).toBe('мне хо́чется')
  })

  it('lets an authored paradigm_note replace the derived person note only', () => {
    const authored = {
      ...nachatsya,
      extra: { ...nachatsya.extra, paradigm_note: '  Reflexive passive: …  ' },
    }
    const notes = paradigmNotes(buildParadigm(authored))
    expect(notes.map((n) => n.key)).toEqual(['no-present', 'authored'])
    expect(notes[1].text).toBe('Reflexive passive: …') // trimmed
  })
})

describe('paradigmNotes — over the corpus', () => {
  // A derived note asserts a fact about Russian from an absence in the data, so
  // the set of verbs making that claim is pinned: a table that lost its 1st/2nd
  // person to an authoring slip would otherwise start explaining itself as a
  // fact of the language. Adding a genuinely third-person-only verb means
  // adding it here (and to `DEFECTIVE` in morphGolden.js when cells are absent).
  const words = loadFixtureWords()
  const byNote = new Map()
  for (const word of words.filter((w) => w.pos === 'verb')) {
    for (const note of paradigmNotes(buildParadigm(word))) {
      if (note.key === 'no-present') continue // every perfective; nothing to pin
      if (!byNote.has(note.key)) byNote.set(note.key, [])
      byNote.get(note.key).push(word.key)
    }
  }
  const keysOf = (key) => (byNote.get(key) ?? []).sort()

  it('claims "third person only" for exactly the verbs authored that way', () => {
    expect(keysOf('third-person')).toEqual([
      'выясниться=to turn out',
      'доноситься=to reach',
      'достаться=to fall to',
      'заключаться=to consist of',
      'закончиться=to end',
      'иметься=to be available',
      'кончаться=to end',
      'кончиться=to end',
      'называться=to be called',
      'найтись=to be found',
      'начаться=to begin',
      'начинаться=to begin',
      'образоваться=to form',
      'открываться=to open',
      'открыться=to open',
      'получаться=to turn out',
      'получиться=to turn out',
      'понадобиться=to be needed',
      'послышаться=to be heard',
    ])
  })

  it('claims "impersonal" only for the subjectless verbs', () => {
    expect(keysOf('impersonal')).toEqual(['захотеться=to feel like', 'повезти=to be lucky'])
    expect(keysOf('invariant-person')).toEqual(['хотеться=to feel like'])
  })

  it('reads the authored note off говориться rather than deriving one', () => {
    expect(keysOf('authored')).toEqual(['говориться=to be said'])
    const note = paradigmNotes(
      buildParadigm(words.find((w) => w.key === 'говориться=to be said')),
    ).at(-1)
    expect(note.text).toMatch(/^Reflexive passive/)
  })

  it('leaves the great majority of verb tables unexplained', () => {
    const explained = [...byNote.values()].flat().length
    expect(explained).toBeLessThan(30)
  })
})
