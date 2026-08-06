import { describe, it, expect } from 'vitest'

import { loadFixtureWords } from '../test/fixtures.js'
import {
  genderedTokens,
  isFirstPersonSingular,
  firstPersonGender,
  feminizeFirstPerson,
  firstPersonGenderStats,
} from './genderBalance.js'

// A tiny hand-built past index so the unit cases don't depend on the corpus.
const pastIndex = {
  mToF: new Map([
    ['был', 'была́'],
    ['взял', 'взяла́'],
    ['сделал', 'сде́лала'],
    ['купил', 'купи́ла'],
    ['вернулся', 'верну́лась'],
  ]),
  fem: new Set(['была', 'взяла', 'сделала', 'купила', 'вернулась']),
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
})

describe('corpus first-person gender balance (issue #525)', () => {
  const stats = firstPersonGenderStats(loadFixtureWords())

  it('has a large first-person sample to reason about', () => {
    expect(stats.firstPerson).toBeGreaterThan(1000)
  })

  // Regression floor: the corpus was ~99% masculine before #525 rebalanced it to
  // an even split. This ratchet keeps it there — adding first-person masculine
  // phrases without balancing them (or vice-versa) trips the guard. If a change
  // deliberately shifts the balance, re-run `node scripts/gender-audit.mjs` and
  // move the floor to match the new, still-near-even split.
  it('keeps the masculine / feminine split even (neither side below 45%)', () => {
    const gendered = stats.masculine + stats.feminine
    expect(stats.feminine / gendered).toBeGreaterThan(0.45)
    expect(stats.masculine / gendered).toBeGreaterThan(0.45)
  })
})
