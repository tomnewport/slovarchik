import { describe, it, expect } from 'vitest'

import { buildAmbiguityIndex, phraseAmbiguities, annotateEnglish } from './phraseAmbiguity.js'
import { shapePhrases } from './vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

/** A minimal verb record in the shape buildWords produces. */
function verb(key, ru, conjugation) {
  return { key, ru, headword: ru, pos: 'verb', meaning: key.split('=')[1], forms: {}, extra: { conjugation } }
}

/** A minimal adjective record carrying short (predicate) forms. */
function adjective(key, ru, short) {
  return { key, ru, headword: ru, pos: 'adjective', meaning: key.split('=')[1], forms: {}, extra: { short } }
}

const хотеть = verb('хотеть=to want', 'хоте́ть', {
  present: { '1sg': 'хочу́', '2sg': 'хо́чешь', '3sg': 'хо́чет', '2pl': 'хоти́те' },
  past_m: 'хоте́л',
  past_f: 'хоте́ла',
})
const купить = verb('купить=to buy', 'купи́ть', {
  imperative: { sg: 'купи́', pl: 'купи́те' },
  past_m: 'купи́л',
  past_f: 'купи́ла',
})
const устать = verb('устать=to get tired', 'уста́ть', { past_m: 'уста́л', past_f: 'уста́ла' })
const хлопнуть = verb('хлопнуть=to slam', 'хло́пнуть', { past_m: 'хло́пнул', past_f: 'хло́пнула' })
const мыть = verb('мыть=to wash', 'мыть', { imperative: { sg: 'мой', pl: 'мо́йте' } })
const мой = { key: 'мой=my', ru: 'мой', headword: 'мой', pos: 'pronoun', meaning: 'my', forms: {}, extra: {} }
const готовый = adjective('готовый=ready', 'гото́вый', { m: 'гото́в', f: 'гото́ва' })

const WORDS = [хотеть, купить, устать, хлопнуть, мыть, мой, готовый]
const index = buildAmbiguityIndex(WORDS)

describe('buildAmbiguityIndex', () => {
  it('tags 2sg/2pl and imperative forms by the person they address', () => {
    expect(index.get('хочешь')).toBe('2sg')
    expect(index.get('хотите')).toBe('2pl')
    expect(index.get('купи')).toBe('2sg')
    expect(index.get('купите')).toBe('2pl')
  })

  it('tags gender-marked past and short-adjective forms', () => {
    expect(index.get('устал')).toBe('m')
    expect(index.get('устала')).toBe('f')
    expect(index.get('готов')).toBe('m')
    expect(index.get('готова')).toBe('f')
  })

  it('leaves person-neutral forms as evidence of nothing', () => {
    expect(index.get('хочу')).toBe('other')
    expect(index.get('хочет')).toBe('other')
  })

  it('marks a form claimed by two different words as ambiguous', () => {
    // «мой» is both the possessive "my" and the imperative of мыть, so it can
    // never prove a phrase addresses one person informally.
    expect(index.get('мой')).toBe(null)
  })
})

describe('phraseAmbiguities', () => {
  it('flags an informal "you" from a 2sg verb with no pronoun', () => {
    expect(phraseAmbiguities('Хо́чешь ча́ю?', index)).toEqual(['you-informal'])
  })

  it('flags a formal/plural "you" from a plural imperative', () => {
    expect(phraseAmbiguities('Купи́те хлеб.', index)).toEqual(['you-formal'])
  })

  it('flags the T–V distinction from the pronouns alone', () => {
    expect(phraseAmbiguities('Как тебя́ зову́т?', index)).toEqual(['you-informal'])
    expect(phraseAmbiguities('Э́то ваш дом.', index)).toEqual(['you-formal'])
  })

  it('says nothing when the Russian marks no person at all', () => {
    // A generic English "you" ("you can work here") has nothing behind it.
    expect(phraseAmbiguities('Здесь мо́жно рабо́тать.', index)).toEqual([])
  })

  it('says nothing when a phrase somehow marks both readings', () => {
    expect(phraseAmbiguities('Ты и вы.', index)).toEqual([])
  })

  it("flags the speaker's gender from past-tense agreement with я", () => {
    expect(phraseAmbiguities('Я купи́л биле́т.', index)).toEqual(['speaker-m'])
    expect(phraseAmbiguities('Я купи́ла биле́т.', index)).toEqual(['speaker-f'])
  })

  it("flags the speaker's gender from a short adjective", () => {
    expect(phraseAmbiguities('Я гото́ва.', index)).toEqual(['speaker-f'])
  })

  it('flags the addressee’s gender alongside the informal "you"', () => {
    expect(phraseAmbiguities('Ты уста́л?', index)).toEqual(['you-informal', 'addressee-m'])
    expect(phraseAmbiguities('Ты уста́ла?', index)).toEqual(['you-informal', 'addressee-f'])
  })

  it('does not read agreement across a clause boundary', () => {
    // хло́пнула is the door's, not the speaker's — the comma stops the search.
    expect(phraseAmbiguities('Е́сли бы дверь хло́пнула, я бы уста́л.', index)).toEqual(['speaker-m'])
  })

  it('ignores a clause whose gendered forms disagree', () => {
    expect(phraseAmbiguities('Я уста́л и уста́ла', index)).toEqual([])
  })

  it('only reads the nominative pronoun, not the object forms', () => {
    // «меня́» is the object; the masculine past belongs to whoever pushed.
    expect(phraseAmbiguities('Меня́ уста́л.', index)).toEqual([])
  })

  it('handles empty and unknown input without inventing notes', () => {
    expect(phraseAmbiguities('', index)).toEqual([])
    expect(phraseAmbiguities('Абракада́бра.', index)).toEqual([])
    expect(phraseAmbiguities('Хо́чешь ча́ю?', undefined)).toEqual([])
  })
})

describe('annotateEnglish', () => {
  it('pins a note to the English word it disambiguates', () => {
    const { parts, trailing } = annotateEnglish('Do you want tea?', ['you-informal'])
    expect(parts).toEqual([
      { text: 'Do ', note: '' },
      { text: 'you', note: 'informal' },
      { text: ' want tea?', note: '' },
    ])
    expect(trailing).toEqual([])
  })

  it('merges several notes about the same person into one parenthetical', () => {
    const { parts } = annotateEnglish('You chose the wrong road.', ['you-informal', 'addressee-m'])
    expect(parts[0]).toEqual({ text: 'You', note: 'informal, to a man' })
  })

  it('annotates the speaker and the addressee separately, in reading order', () => {
    const { parts } = annotateEnglish('I told you.', ['you-informal', 'speaker-f'])
    expect(parts.map((p) => p.note)).toEqual(['female speaker', '', 'informal', ''])
  })

  it('pins the note to a possessive when there is no bare "you"', () => {
    const { parts } = annotateEnglish('Enter your password.', ['you-formal'])
    expect(parts[1]).toEqual({ text: 'your', note: 'formal or plural' })
  })

  it('trails notes that have no English word to attach to', () => {
    // A bare imperative names nobody, but the answer still needs the вы form.
    const { parts, trailing } = annotateEnglish('Read the first paragraph.', ['you-formal'])
    expect(parts).toEqual([{ text: 'Read the first paragraph.', note: '' }])
    expect(trailing).toEqual(['formal or plural “you”'])
  })

  it('returns the plain text when there is nothing to annotate', () => {
    expect(annotateEnglish('Good morning!', [])).toEqual({
      parts: [{ text: 'Good morning!', note: '' }],
      trailing: [],
    })
  })
})

describe('the phrase bank', () => {
  const phrases = shapePhrases(loadFixtureWords())

  it('annotates a meaningful share of the real phrases', () => {
    const annotated = phrases.filter((p) => p.enNotes.length)
    expect(annotated.length).toBeGreaterThan(100)
    // …and leaves the majority — which hide nothing — untouched.
    expect(annotated.length).toBeLessThan(phrases.length / 2)
  })

  it('never contradicts itself on a real phrase', () => {
    for (const p of phrases) {
      const ids = new Set(p.enNotes)
      expect(ids.has('you-informal') && ids.has('you-formal')).toBe(false)
      expect(ids.has('speaker-m') && ids.has('speaker-f')).toBe(false)
      expect(ids.has('addressee-m') && ids.has('addressee-f')).toBe(false)
    }
  })

  it('only ever emits known note ids', () => {
    const known = new Set([
      'you-informal',
      'you-formal',
      'addressee-m',
      'addressee-f',
      'speaker-m',
      'speaker-f',
    ])
    for (const p of phrases) for (const id of p.enNotes) expect(known.has(id)).toBe(true)
  })

  it('reads the T–V distinction off real corpus phrases', () => {
    const byRu = new Map(phrases.map((p) => [p.ru, p]))
    const notesFor = (ru) => byRu.get(ru)?.enNotes ?? null
    // A sample of phrases whose English gives the learner no way to choose.
    expect(notesFor('Хо́чешь ча́ю? — Нет, спаси́бо.')).toEqual(['you-informal'])
    expect(notesFor('Прочита́йте пе́рвый абза́ц.')).toEqual(['you-formal'])
  })
})
