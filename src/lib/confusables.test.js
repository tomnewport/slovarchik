import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords } from './vocabBuild.js'
import { buildFormIndex } from './phraseHint.js'
import { diagnose, correctionMessage, VERDICTS } from './confusables.js'
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

  it('quotes the notes instead when two same-gloss words carry them', () => {
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
    expect(verdict.type).toBe('other-word')
    expect(correctionMessage(verdict).detail).toBe('I want trousers (the standard word).')
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
