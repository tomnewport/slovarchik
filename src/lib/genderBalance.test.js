import { describe, it, expect } from 'vitest'

import { loadFixtureWords } from '../test/fixtures.js'
import {
  genderedTokens,
  isFirstPersonSingular,
  isSecondPersonSingular,
  firstPersonGender,
  secondPersonGender,
  feminizeFirstPerson,
  feminizeSecondPerson,
  firstPersonGenderStats,
  secondPersonGenderStats,
} from './genderBalance.js'

// A tiny hand-built past index so the unit cases don't depend on the corpus.
const pastIndex = {
  mToF: new Map([
    ['был', 'была́'],
    ['взял', 'взяла́'],
    ['сделал', 'сде́лала'],
    ['купил', 'купи́ла'],
    ['вернулся', 'верну́лась'],
    ['устал', 'уста́ла'],
    ['пришел', 'пришла́'],
  ]),
  fem: new Set(['была', 'взяла', 'сделала', 'купила', 'вернулась', 'устала', 'пришла']),
}

describe('isFirstPersonSingular', () => {
  it('detects a standalone я subject anywhere in the phrase', () => {
    expect(isFirstPersonSingular('Я был на рабо́те.')).toBe(true)
    expect(isFirstPersonSingular('Вчера́ я был до́ма.')).toBe(true)
    expect(isFirstPersonSingular('«Я зна́ю», — сказа́л он.')).toBe(true)
  })
  it('ignores я inside a larger word and phrases without it', () => {
    expect(isFirstPersonSingular('Он говори́т по-япо́нски.')).toBe(false)
    expect(isFirstPersonSingular('Мы бы́ли до́ма.')).toBe(false)
  })
})

describe('isSecondPersonSingular', () => {
  it('detects a standalone ты subject anywhere in the phrase', () => {
    expect(isSecondPersonSingular('Ты уста́л?')).toBe(true)
    expect(isSecondPersonSingular('Заче́м ты сюда́ пришёл?')).toBe(true)
  })
  it('ignores ты inside a larger word and the oblique forms', () => {
    expect(isSecondPersonSingular('У меня́ ты́сяча дел.')).toBe(false)
    expect(isSecondPersonSingular('Я тебя́ ви́дел.')).toBe(false) // тебя́ is not the subject
    expect(isSecondPersonSingular('Вы уста́ли?')).toBe(false)
  })
})

describe('genderedTokens', () => {
  it('recognises a masculine past verb and offers its feminine form', () => {
    const t = genderedTokens('Вчера́ я был на рабо́те.', pastIndex)
    expect(t).toEqual([{ index: 2, gender: 'm', kind: 'verb', feminine: 'была́' }])
  })
  it('keeps the mobile-stress feminine from the table, not a mangled ending', () => {
    const [t] = genderedTokens('Я взял такси́.', pastIndex)
    expect(t.feminine).toBe('взяла́') // not «взя́ла»
  })
  it('flags a predicate short form as gendered (masculine)', () => {
    const t = genderedTokens('Я рад тебя́ ви́деть.', pastIndex)
    expect(t.map((x) => [x.gender, x.kind])).toEqual([['m', 'predicate']])
  })
  it('falls back to morphology for a past verb missing from the table', () => {
    // опа́здывал: only the perfective опозда́ть is a headword, so it is unknown to
    // the table but must still count as a second gendered token.
    const t = genderedTokens('Е́сли бы я опа́здывал, я бы бежа́л.', {
      mToF: new Map([['бежал', 'бежа́ла']]),
      fem: new Set(['бежала']),
    })
    expect(t).toHaveLength(2)
    expect(t.map((x) => x.kind).sort()).toEqual(['past', 'verb'])
  })
  it('does not treat neuter -ло / plural -ли as gender-revealing', () => {
    expect(genderedTokens('Мне бы́ло хорошо́, и мы шли.', pastIndex)).toEqual([])
  })
})

describe('firstPersonGender', () => {
  it('reads the speaker gender off a first-person phrase', () => {
    expect(firstPersonGender('Я был до́ма.', pastIndex)).toBe('m')
    expect(firstPersonGender('Я была́ до́ма.', pastIndex)).toBe('f')
  })
  it('is null for non-first-person or genderless phrases, mixed when both appear', () => {
    expect(firstPersonGender('Он был до́ма.', pastIndex)).toBeNull()
    expect(firstPersonGender('Я чита́ю кни́гу.', pastIndex)).toBeNull()
    expect(firstPersonGender('Я взял то, что она́ взяла́.', pastIndex)).toBe('mixed')
  })
})

describe('feminizeFirstPerson', () => {
  it('flips a single masculine verb to its stored feminine form', () => {
    expect(feminizeFirstPerson('Вчера́ я был на рабо́те.', pastIndex)).toEqual({
      ru: 'Вчера́ я была́ на рабо́те.',
      index: 2,
    })
  })
  it('preserves a leading capital and trailing punctuation on the token', () => {
    expect(feminizeFirstPerson('Верну́лся я по́здно.', pastIndex)?.ru).toBe('Верну́лась я по́здно.')
  })
  it('refuses phrases with a second gendered token (would disagree)', () => {
    expect(feminizeFirstPerson('Я был рад.', pastIndex)).toBeNull()
    expect(feminizeFirstPerson('Когда́ я пришёл, я взял кни́гу.', pastIndex)).toBeNull()
  })
  it('refuses when the phrase is not first-person or already feminine', () => {
    expect(feminizeFirstPerson('Он был до́ма.', pastIndex)).toBeNull()
    expect(feminizeFirstPerson('Я была́ до́ма.', pastIndex)).toBeNull()
  })
  it('refuses a lone predicate (no verb form to derive)', () => {
    expect(feminizeFirstPerson('Я рад.', pastIndex)).toBeNull()
  })
  it('refuses when the gendered verb sits in another subject’s clause', () => {
    // сде́лал is ты's, not the speaker's — flipping it would change the wrong
    // person's gender (and re-skew the second person).
    expect(feminizeFirstPerson('Я зна́ю, что ты сде́лал.', pastIndex)).toBeNull()
  })
})

describe('feminizeSecondPerson (issue #541)', () => {
  it('flips the addressee’s verb to its stored feminine form', () => {
    expect(feminizeSecondPerson('Ты уста́л?', pastIndex)).toEqual({
      ru: 'Ты уста́ла?',
      index: 1,
    })
    expect(feminizeSecondPerson('Заче́м ты сюда́ пришёл?', pastIndex)?.ru).toBe(
      'Заче́м ты сюда́ пришла́?',
    )
  })
  it('keeps the mobile stress from the verb table', () => {
    expect(feminizeSecondPerson('Чью кни́гу ты взял?', pastIndex)?.ru).toBe('Чью кни́гу ты взяла́?')
  })
  it('refuses phrases with a second gendered token', () => {
    expect(feminizeSecondPerson('Ты был рад.', pastIndex)).toBeNull()
    expect(feminizeSecondPerson('Ты взял то, что я купи́л.', pastIndex)).toBeNull()
  })
  it('refuses when the gendered verb belongs to another subject’s clause', () => {
    expect(feminizeSecondPerson('Ты зна́ешь, что он сде́лал?', pastIndex)).toBeNull()
    expect(feminizeSecondPerson('Ты зна́ешь, что я сде́лал?', pastIndex)).toBeNull()
  })
  it('refuses non-second-person or already-feminine phrases', () => {
    expect(feminizeSecondPerson('Я был до́ма.', pastIndex)).toBeNull()
    expect(feminizeSecondPerson('Вы бы́ли до́ма.', pastIndex)).toBeNull()
    expect(feminizeSecondPerson('Ты уста́ла?', pastIndex)).toBeNull()
  })
})

describe('secondPersonGender', () => {
  it('reads the addressee gender off a second-person phrase', () => {
    expect(secondPersonGender('Ты уста́л?', pastIndex)).toBe('m')
    expect(secondPersonGender('Ты уста́ла?', pastIndex)).toBe('f')
    expect(secondPersonGender('Ты чита́ешь кни́гу.', pastIndex)).toBeNull()
    expect(secondPersonGender('Он был до́ма.', pastIndex)).toBeNull()
  })
})

// Regression floor: the corpus was ~99% masculine in the first person before
// #525 rebalanced it, and ~95% masculine in the second person before #541. This
// ratchet keeps both there — adding masculine phrases without balancing them (or
// vice-versa) trips the guard. If a change deliberately shifts the balance,
// re-run `node scripts/gender-audit.mjs` and move the floor to match the new,
// still-near-even split.
describe('corpus gender balance (issues #525, #541)', () => {
  const words = loadFixtureWords()
  const first = firstPersonGenderStats(words)
  const second = secondPersonGenderStats(words)

  it('has a large sample of both persons to reason about', () => {
    expect(first.firstPerson).toBeGreaterThan(1000)
    expect(second.secondPerson).toBeGreaterThan(500)
  })

  it.each([
    ['first person (я …)', () => first],
    ['second person (ты …)', () => second],
  ])('keeps the %s masculine / feminine split even (neither side below 45%%)', (_label, get) => {
    const stats = get()
    const gendered = stats.masculine + stats.feminine
    expect(stats.feminine / gendered).toBeGreaterThan(0.45)
    expect(stats.masculine / gendered).toBeGreaterThan(0.45)
  })
})
