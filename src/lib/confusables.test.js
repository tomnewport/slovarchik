import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import { buildFormIndex } from './phraseHint.js'
import {
  diagnose,
  diagnoseEnglish,
  buildGlossIndex,
  correctionMessage,
  VERDICTS,
} from './confusables.js'
import { shapeVocab } from './vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

/** A diagnosis context over a word list. */
function contextFor(words) {
  return { formIndex: buildFormIndex(words), byKey: new Map(words.map((w) => [w.key, w])) }
}

/** Diagnose `typed` against the word `targetKey`, whose wanted form is `target`. */
function verdictOf(words, typed, targetKey, target) {
  const ctx = contextFor(words)
  return diagnose(typed, { ...ctx, targetKey, target })
}

// ── The headline regressions, against the corpus as it actually stands ───────
// сшить/шить and одеться/одеваться are linked by `pair:` and carry an identical
// gloss, deliberately (#527): the prompt shows the aspect, so no distinguishing
// note is needed. That leaves a wrong answer with nothing to say — which is the
// whole point of this module.
describe('the identical-gloss aspect pairs in the real corpus', () => {
  const words = loadFixtureWords()
  const byKey = new Map(words.map((w) => [w.key, w]))

  it('шить and сшить really do share one base gloss', () => {
    // The premise of the whole module: quoting the two glosses at a learner who
    // typed the wrong one would print "to sew" twice. (Both now carry notes that
    // separate them on a *prompt*; the base gloss is still the same string, and
    // it is the base gloss a correction would otherwise reach for.)
    expect(byKey.get('шить=to sew').meaning).toBe(byKey.get('сшить=to sew').meaning)
    expect(byKey.get('одеться=to get dressed').meaning).toBe(
      byKey.get('одеваться=to get dressed').meaning,
    )
  })

  it('diagnoses сшить for шить as an aspect confusion', () => {
    expect(verdictOf(words, 'сшить', 'шить=to sew', 'шить')).toMatchObject({
      type: 'aspect',
      dimension: 'aspect',
      gotGrade: 'pf',
      wantGrade: 'impf',
    })
  })

  it('explains it without leaning on the glosses, which are the same string', () => {
    const { headline, detail } = correctionMessage(
      verdictOf(words, 'сшить', 'шить=to sew', 'шить'),
    )
    expect(headline).toContain('«сшить»')
    expect(headline).toContain('a single completed action')
    expect(detail).toContain('a process, habit or repeated action')
    // The distinction is carried by the senses, not by printing "to sew" twice.
    expect(`${headline} ${detail}`).not.toContain('to sew')
  })

  it('does the same for the reflexive pair одеться / одеваться', () => {
    const message = correctionMessage(
      verdictOf(words, 'оде́ться', 'одеваться=to get dressed', 'одева́ться'),
    )
    expect(message.headline).toContain('«оде́ться»')
    expect(message.detail).toContain('imperfective')
    expect(`${message.headline} ${message.detail}`).not.toContain('to get dressed')
  })

  it('never spells the answer out — that is what Show me the answer is for', () => {
    // As a whole word: «сшить» legitimately contains "шить", and quoting what the
    // learner typed is the point.
    const namesAnswer = (text, answer) =>
      new RegExp(`(^|[^\\p{L}])${answer}([^\\p{L}]|$)`, 'u').test(text)
    for (const [typed, key, form] of [
      ['сшить', 'шить=to sew', 'шить'],
      ['шью', 'шить=to sew', 'шить'],
      ['оде́ться', 'одеваться=to get dressed', 'одеваться'],
      ['кни́га', 'газета=newspaper', 'газета'],
    ]) {
      const { headline, detail } = correctionMessage(verdictOf(words, typed, key, form))
      expect(namesAnswer(`${headline} ${detail}`.toLowerCase(), form), `${typed} → ${form}`).toBe(
        false,
      )
    }
  })

  it('reads an inflected form of the target as a wrong form, not a different word', () => {
    const verdict = verdictOf(words, 'шью', 'шить=to sew', 'шить')
    expect(verdict.type).toBe('wrong-form')
    expect(correctionMessage(verdict).headline).toContain('«шью»')
  })

  it('says nothing about an answer that is not a word', () => {
    expect(verdictOf(words, 'квакозябра', 'шить=to sew', 'шить')).toBeNull()
    expect(verdictOf(words, '', 'шить=to sew', 'шить')).toBeNull()
    expect(verdictOf(words, '   ', 'шить=to sew', 'шить')).toBeNull()
    expect(correctionMessage(null)).toBeNull()
  })
})

// ── Each verdict type, on data shaped to isolate it ──────────────────────────
const sound = `
words:
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    aspect: impf
    en_gb:
      standard: to ring (of a bell)
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    aspect: impf
    en_gb:
      standard: to call (to phone someone)
    confusable_with:
      - key: "звенеть=to ring"
        why: A bell does one and a person does the other.
`

describe('diagnose', () => {
  it('reports an authored confusable, with the authored why', () => {
    const words = fromYaml([{ pos: 'verb', text: sound }])
    const verdict = verdictOf(words, 'звене́ть', 'звонить=to call', 'звони́ть')
    expect(verdict.type).toBe('confusable')
    expect(correctionMessage(verdict)).toEqual({
      headline: '«звене́ть» is to ring',
      detail: 'A bell does one and a person does the other.',
      tier: 'lexical',
    })
  })

  it('mirrors onto the other member, since the link is symmetric', () => {
    const words = fromYaml([{ pos: 'verb', text: sound }])
    expect(verdictOf(words, 'звони́ть', 'звенеть=to ring', 'звене́ть').type).toBe('confusable')
  })

  it('drops an authored why that would spell the answer out', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb:
      standard: to ring (of a bell)
    confusable_with:
      - key: "звонить=to call"
        why: звони́ть is the one for telephones.
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb:
      standard: to call (to phone someone)
`,
      },
    ])
    const { detail } = correctionMessage(verdictOf(words, 'звене́ть', 'звонить=to call', 'звони́ть'))
    expect(detail).not.toContain('звони́ть')
    expect(detail).toBe('I want to call (to phone someone).')
  })

  it('calls a same-gloss word with no distinguishing notes a synonym', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "автомобиль=car":
    cefr_level: B1
    accented: автомоби́ль
    gender: m
    animacy: i
    en_gb: { standard: car }
  "машина=car":
    cefr_level: A1
    accented: маши́на
    gender: f
    animacy: i
    en_gb: { standard: car }
`,
      },
    ])
    const verdict = verdictOf(words, 'автомоби́ль', 'машина=car', 'маши́на')
    expect(verdict.type).toBe('synonym')
    expect(correctionMessage(verdict)).toEqual({
      headline: '«автомоби́ль» does mean car',
      detail: 'Good — but I’m after a different word here.',
      tier: 'synonym',
    })
  })

  it('calls it right word, wrong sense when two same-gloss words carry notes', () => {
    // The notes exist precisely to separate these (see spellPromptData.test.js),
    // so they say more than "that is a synonym".
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "брюки=trousers":
    cefr_level: A2
    accented: брю́ки
    gender: m
    animacy: i
    number: ["pl"]
    en_gb:
      standard: trousers (the standard word)
  "штаны=trousers":
    cefr_level: B1
    accented: штаны́
    gender: m
    animacy: i
    number: ["pl"]
    en_gb:
      standard: trousers (the informal word)
`,
      },
    ])
    const verdict = verdictOf(words, 'штаны́', 'брюки=trousers', 'брю́ки')
    expect(verdict.type).toBe('wrong-sense')
    expect(correctionMessage(verdict)).toEqual({
      headline: '«штаны́» is trousers (the informal word)',
      detail: 'Right word, wrong sense — I want trousers (the standard word).',
      tier: 'lexical',
    })
  })

  it('quotes both glosses for an aspect pair whose members differ in meaning', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "покупать=to buy":
    cefr_level: A1
    accented: покупа́ть
    aspect: impf
    pair: "купить=to buy"
    en_gb: { standard: to buy }
  "купить=to buy":
    cefr_level: A1
    accented: купи́ть
    aspect: pf
    pair: "покупать=to buy"
    en_gb: { standard: to buy }
`,
      },
    ])
    const message = correctionMessage(verdictOf(words, 'купи́ть', 'покупать=to buy', 'покупа́ть'))
    expect(message.headline).toBe(
      '«купи́ть» is the perfective — a single completed action or its result',
    )
    expect(message.detail).toBe('I want the imperfective: a process, habit or repeated action.')
  })

  it('reads a motion pair as a contrast of direction, not of aspect', () => {
    const words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "ходить=to go":
    cefr_level: A1
    accented: ходи́ть
    aspect: impf
    motion: indet
    motion_pair: "идти=to go"
    en_gb: { standard: to go (on foot) }
  "идти=to go":
    cefr_level: A1
    accented: идти́
    aspect: impf
    motion: det
    motion_pair: "ходить=to go"
    en_gb: { standard: to go (on foot) }
`,
      },
    ])
    const verdict = verdictOf(words, 'ходи́ть', 'идти=to go', 'идти́')
    expect(verdict).toMatchObject({ type: 'aspect', dimension: 'motion' })
    const message = correctionMessage(verdict)
    expect(message.headline).toContain('indeterminate')
    expect(message.detail).toBe('I want the determinate: one trip, under way in one direction.')
  })

  it('tells heteronyms apart by their stress', () => {
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
    const verdict = verdictOf(words, 'за́мок', 'замок=lock', 'замо́к')
    expect(verdict.type).toBe('heteronym')
    expect(correctionMessage(verdict).headline).toBe('«за́мок» is castle')
  })

  it('does not blame the stress when the two spellings are identical (#641)', () => {
    // «чай» (tea) and «чай» (I suppose) are homographs, not heteronyms: the
    // stress sits in the same place in both, so "move it" is advice a learner
    // cannot act on. `linkHeteronyms` (vocabBuild.js) draws the same line — it
    // needs the *stressed* forms to differ before it links a pair.
    const corpus = loadFixtureWords()
    // The particle is what is being drilled, and the learner writes a form of
    // the noun: the letters collide, but nothing about the stress explains it.
    const verdict = verdictOf(corpus, 'ча́е', 'чай=I suppose', 'чай')
    expect(verdict.type).toBe('homograph')
    const { headline, detail } = correctionMessage(verdict)
    expect(headline).toBe('«чай» is tea')
    expect(detail).toContain('Spelled the same, but a different word')
    expect(detail).not.toContain('stress')
  })

  it('stays quiet when the answer is the target word in the wrong form (#641)', () => {
    // The reported bug, against the real corpus: hearing «В ча́е сли́шком мно́го
    // са́хара» and writing «чай» is tea in the nominative — a case slip, which
    // the drill's own error map marks precisely. Reaching past that for the
    // homograph particle «чай» produced "«чай» is I suppose — the stress falls
    // elsewhere", wrong twice over: it is not that word, and the two are not
    // told apart by stress at all (which typed answers never require —
    // `phraseCorrect` strips it before grading).
    const corpus = loadFixtureWords()
    expect(
      verdictOf(corpus, 'В чай слишком много сахара', 'чай=tea', 'В ча́е сли́шком мно́го са́хара.'),
    ).toBeNull()
    // A single-word drill still gets the precise thing to say: the dictionary
    // form is the answer there, so "that is a form of it" names the gap.
    expect(verdictOf(corpus, 'ча́е', 'чай=tea', 'чай')).toMatchObject({ type: 'wrong-form' })
  })

  it('diagnoses a gloss-only word — a real word the learner typed, just not taught', () => {
    const words = fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "полдень=noon":
    cefr_level: B1
    learn: false
    accented: по́лдень
    gender: m
    animacy: i
    en_gb: { standard: noon }
  "утро=morning":
    cefr_level: A1
    accented: у́тро
    gender: n
    animacy: i
    en_gb: { standard: morning }
`,
      },
    ])
    const verdict = verdictOf(words, 'по́лдень', 'утро=morning', 'у́тро')
    expect(verdict.type).toBe('other-word')
    expect(correctionMessage(verdict).headline).toBe('«по́лдень» means noon')
  })

  it('returns nothing without an index or a word map', () => {
    expect(diagnose('сшить', {})).toBeNull()
    expect(diagnose('сшить', { formIndex: new Map() })).toBeNull()
  })

  it('ranks verdicts most-specific first', () => {
    expect(VERDICTS[0]).toBe('wrong-form')
    expect(VERDICTS[VERDICTS.length - 1]).toBe('other-word')
  })
})

describe('diagnose, on a phrase', () => {
  const words = loadFixtureWords()

  it('diagnoses the one token that differs', () => {
    const verdict = verdictOf(words, 'Я читаю книгу', 'читать=to read', 'Я чита́ю газе́ту')
    expect(verdict.type).toBe('other-word')
    expect(correctionMessage(verdict).headline).toContain('«кни́га»')
  })

  it('falls back to whole-phrase feedback when the alignment is ambiguous', () => {
    // Two slips, or a different number of words: which one did they mean?
    expect(verdictOf(words, 'Я читал книгу', 'читать=to read', 'Я чита́ю газе́ту')).toBeNull()
    expect(verdictOf(words, 'Я читаю', 'читать=to read', 'Я чита́ю газе́ту')).toBeNull()
  })

  it('says nothing when the differing token is not a word at all', () => {
    expect(verdictOf(words, 'Я читаю квакозябру', 'читать=to read', 'Я чита́ю газе́ту')).toBeNull()
  })
})

// ── The English direction (#589) ────────────────────────────────────────────
describe('diagnoseEnglish', () => {
  const words = loadFixtureWords()
  const byKey = new Map(words.map((w) => [w.key, w]))
  // The flashcard drill's own autocomplete pool, which doubles as the index.
  const pool = shapeVocab(words).map((w) => {
    const en = Array.isArray(w.en) ? (w.en[0] ?? '') : (w.en ?? '')
    return { key: w.id, ru: w.ru, en, label: w.note ? `${en} (${w.note})` : en }
  })
  const glossIndex = buildGlossIndex(pool)
  const guess = (typed, targetKey) => diagnoseEnglish(typed, { typed, targetKey, byKey, glossIndex })

  it('resolves a gloss belonging to another entry back to that word', () => {
    const verdict = guess('to put on', 'одеваться=to get dressed')
    expect(verdict).toMatchObject({ type: 'other-word', direction: 'en' })
    expect(correctionMessage(verdict).headline).toContain('«надева́ть»')
  })

  it('never states the English, which is the answer in this direction', () => {
    const { headline, detail } = correctionMessage(guess('to put on', 'одеваться=to get dressed'))
    expect(`${headline} ${detail}`).not.toContain('to get dressed')
  })

  it('reports a sense mismatch when the two entries both carry notes', () => {
    const verdict = guess('trousers (the informal word)', 'брюки=trousers')
    expect(verdict.type).toBe('wrong-sense')
    expect(correctionMessage(verdict).detail).toContain('Right English word, wrong sense')
  })

  it('reads a heteronym partner’s gloss as the stress confusion it is', () => {
    const verdict = guess('castle', 'замок=lock')
    expect(verdict.type).toBe('heteronym')
    expect(correctionMessage(verdict).detail).toContain('the stress is elsewhere')
  })

  it('says nothing for the card’s own gloss, or an unknown one', () => {
    expect(guess('to get dressed', 'одеваться=to get dressed')).toBeNull()
    expect(guess('flibbertigibbet', 'одеваться=to get dressed')).toBeNull()
    expect(guess('', 'одеваться=to get dressed')).toBeNull()
  })

  it('returns nothing without an index, a word map or a known target', () => {
    expect(diagnoseEnglish('to put on', {})).toBeNull()
    expect(diagnoseEnglish('to put on', { byKey, glossIndex, targetKey: 'nope=nope' })).toBeNull()
  })

  it('ignores case, articles and punctuation in the guess', () => {
    expect(guess('To Put On!', 'одеваться=to get dressed')?.type).toBe('other-word')
  })
})

describe('diagnoseEnglish, on data shaped to isolate each relation', () => {
  const inline = fromYaml([
    {
      pos: 'verb',
      text: `
words:
  "покупать=to buy":
    cefr_level: A1
    accented: покупа́ть
    aspect: impf
    pair: "купить=to buy"
    en_gb:
      standard: to buy (over and over)
  "купить=to buy":
    cefr_level: A1
    accented: купи́ть
    aspect: pf
    pair: "покупать=to buy"
    en_gb:
      standard: to buy (once)
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb:
      standard: to ring (of a bell)
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb:
      standard: to call (to phone someone)
    confusable_with:
      - key: "звенеть=to ring"
        why: A bell does one and a person does the other.
`,
    },
    {
      pos: 'noun',
      text: `
words:
  "автомобиль=car":
    cefr_level: B1
    accented: автомоби́ль
    gender: m
    animacy: i
    en_gb:
      standard: car
      alt:
        - motor car
  "машина=car":
    cefr_level: A1
    accented: маши́на
    gender: f
    animacy: i
    en_gb: { standard: car }
`,
    },
  ])
  const byKey = new Map(inline.map((w) => [w.key, w]))
  const pool = shapeVocab(inline).flatMap((w) =>
    (Array.isArray(w.en) ? w.en : [w.en]).map((en) => ({
      key: w.id,
      ru: w.ru,
      en,
      label: w.note ? `${en} (${w.note})` : en,
    })),
  )
  const glossIndex = buildGlossIndex(pool)
  const guess = (typed, targetKey) => diagnoseEnglish(typed, { targetKey, byKey, glossIndex })

  it('names the aspect partner, and says the aspect as a sense', () => {
    const verdict = guess('to buy (once)', 'покупать=to buy')
    expect(verdict).toMatchObject({ type: 'aspect', dimension: 'aspect' })
    const { headline, detail } = correctionMessage(verdict)
    expect(headline).toBe('«купи́ть» is “to buy (once)”')
    expect(detail).toContain('perfective partner — a single completed action')
  })

  it('treats a true synonym gently, and without an error tier', () => {
    const verdict = guess('motor car', 'машина=car')
    expect(verdict.type).toBe('synonym')
    expect(correctionMessage(verdict)).toEqual({
      headline: '«автомоби́ль» is “car”',
      detail: "That means the same thing — but I want this word's own English.",
      tier: 'synonym',
    })
  })

  it('uses the authored why for a confusable pair', () => {
    const verdict = guess('to ring (of a bell)', 'звонить=to call')
    expect(verdict.type).toBe('confusable')
    expect(correctionMessage(verdict).detail).toContain('A bell does one')
  })
})

describe('buildGlossIndex', () => {
  it('indexes both the bare gloss and the disambiguated label', () => {
    const index = buildGlossIndex([{ key: 'шапка=hat', en: 'hat', label: 'hat (winter)' }])
    expect(index.get('hat')).toEqual(['шапка=hat'])
    expect(index.get('hat (winter)')).toEqual(['шапка=hat'])
  })

  it('collects every word carrying a shared gloss', () => {
    const index = buildGlossIndex([
      { key: 'машина=car', en: 'car', label: 'car' },
      { key: 'автомобиль=car', en: 'car', label: 'car' },
    ])
    expect(index.get('car')).toEqual(['машина=car', 'автомобиль=car'])
  })

  it('skips entries with no key or no gloss', () => {
    expect(buildGlossIndex([{ en: 'orphan' }, { key: 'k' }, null]).size).toBe(0)
    expect(buildGlossIndex(undefined).size).toBe(0)
  })
})
