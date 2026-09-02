import { describe, it, expect } from 'vitest'

import { comprehensionCheck } from './comprehension.js'
import { shapePhrases } from './vocabBuild.js'
import { loadFixtureWords, loadFixtureContextPhrases } from '../test/fixtures.js'

// A verb and its aspect partner, linked the way buildWords leaves them.
const verb = (over = {}) => ({
  key: 'поблагодарить=to thank',
  pos: 'verb',
  ru: 'поблагодарить',
  headword: 'поблагодари́ть',
  aspect: 'pf',
  aspectPair: { key: 'благодарить=to thank', ru: 'благодари́ть', aspect: 'impf' },
  ...over,
})

const ctx = (tense, token = 2) =>
  new Map([
    [
      'поблагодарить=to thank',
      [{ ru: 'Она́ поблагодари́ла учи́теля.', target: { key: 'поблагодарить=to thank', token, tense } }],
    ],
  ])

const phrase = { ru: 'Она́ поблагодари́ла учи́теля.', source: 'поблагодарить=to thank' }
const ask = (word, annotations) =>
  comprehensionCheck(phrase, { byKey: new Map([[word.key, word]]), annotations })

describe('comprehensionCheck (#597)', () => {
  it('asks which reading a past-tense perfective carries', () => {
    const check = ask(verb(), ctx('past'))
    expect(check.kind).toBe('aspect')
    expect(check.answer).toBe('pf')
    expect(check.options.map((o) => o.id)).toEqual(['impf', 'pf'])
    // The explanation names the word on screen and the partner it is not.
    expect(check.why).toContain('«поблагодари́ла»')
    expect(check.why).toContain('благодари́ть')
  })

  it('asks the future-tense version of the same question', () => {
    const check = ask(verb(), ctx('future'))
    expect(check.options.map((o) => o.text)).toEqual([
      'it will be going on, or will happen again and again',
      'it will happen once, and then be done',
    ])
  })

  // A Russian present tense is imperfective by definition, so there is no second
  // reading to choose between — and English says "is doing" perfectly well.
  it('says nothing about a present tense', () => {
    expect(ask(verb({ aspect: 'impf' }), ctx('present'))).toBeNull()
  })

  it('says nothing about a verb with no partner', () => {
    expect(ask(verb({ aspectPair: null }), ctx('past'))).toBeNull()
  })

  it('says nothing when the sentence carries no inflect annotation', () => {
    expect(ask(verb(), new Map())).toBeNull()
    expect(ask(verb(), ctx('past') && new Map([['поблагодарить=to thank', []]]))).toBeNull()
  })

  it('says nothing about a word that is not a verb', () => {
    expect(ask(verb({ pos: 'noun' }), ctx('past'))).toBeNull()
  })

  // идти́ against ходи́ть is a distinction English cannot make at all, where
  // aspect can at least be gestured at with a progressive — so where a verb has
  // both partners, the motion question is the more useful one.
  it('prefers the motion contrast when a verb carries both', () => {
    const idti = verb({
      key: 'идти=to go',
      ru: 'идти',
      headword: 'идти́',
      aspect: 'impf',
      motion: 'det',
      motionPair: { key: 'ходить=to walk', ru: 'ходи́ть', motion: 'indet' },
    })
    const check = comprehensionCheck(
      { ru: 'Он шёл в шко́лу.', source: 'идти=to go' },
      {
        byKey: new Map([[idti.key, idti]]),
        annotations: new Map([
          ['идти=to go', [{ ru: 'Он шёл в шко́лу.', target: { token: 2, tense: 'past' } }]],
        ]),
      },
    )
    expect(check.kind).toBe('motion')
    expect(check.answer).toBe('det')
    expect(check.why).toContain('ходи́ть')
  })

  // Both members of a motion pair are imperfective, so unlike aspect the
  // contrast holds in every tense — including the imperative.
  it('asks the motion question in a tense aspect would refuse', () => {
    const begat = verb({
      key: 'бегать=to run',
      ru: 'бегать',
      headword: 'бе́гать',
      aspect: 'impf',
      aspectPair: null,
      motion: 'indet',
      motionPair: { key: 'бежать=to run', ru: 'бежа́ть', motion: 'det' },
    })
    const check = comprehensionCheck(
      { ru: 'Бе́гайте в па́рке ка́ждое у́тро.', source: 'бегать=to run' },
      {
        byKey: new Map([[begat.key, begat]]),
        annotations: new Map([
          ['бегать=to run', [{ ru: 'Бе́гайте в па́рке ка́ждое у́тро.', target: { token: 1, tense: 'imperative' } }]],
        ]),
      },
    )
    expect(check.answer).toBe('indet')
  })
})

describe('comprehensionCheck over the bundled corpus', () => {
  const words = loadFixtureWords()
  const byKey = new Map(words.map((w) => [w.key, w]))
  const annotations = loadFixtureContextPhrases()
  const checks = shapePhrases(words)
    .map((p) => comprehensionCheck(p, { byKey, annotations }))
    .filter(Boolean)

  it('reaches the sentences the aspect-collision framing could not', () => {
    // #597's point: counted as prompt collisions this was worth two sentences.
    // Asked as "what does the Russian say that your English does not", it is
    // worth four figures.
    expect(checks.length).toBeGreaterThan(1500)
    const kinds = new Set(checks.map((c) => c.kind))
    expect(kinds).toEqual(new Set(['aspect', 'motion']))
  })

  it('always offers exactly two readings, one of them the answer', () => {
    for (const c of checks) {
      expect(c.options).toHaveLength(2)
      expect(c.options.map((o) => o.id)).toContain(c.answer)
      expect(c.why).toBeTruthy()
      expect(c.question).toBeTruthy()
    }
  })
})
