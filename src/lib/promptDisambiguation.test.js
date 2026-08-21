import { describe, it, expect } from 'vitest'
import {
  collidingPrompts,
  separatedByNotes,
  distinguishingTokens,
  hintFor,
  promptHints,
  ambiguousPrompts,
} from './promptDisambiguation.js'

/** A shaped word, as buildWords would produce it. */
const word = (key, meaning, meaningNote, pos = 'noun') => ({ key, meaning, meaningNote, pos })

const TROUSERS = [
  word('брюки=trousers', 'trousers', 'the standard word'),
  word('штаны=trousers', 'trousers', 'the informal word'),
]
const phrase = (id, ru, en, source, enNotes = []) => ({ id, ru, en, source, enNotes })

/**
 * The real resolver goes surface form → word via the corpus form index. These
 * tests only touch a handful of forms, so it is faked with an explicit map from
 * the inflected token the sentences actually contain.
 */
const resolveFrom = (forms) => (token) => forms[token]

describe('collidingPrompts', () => {
  it('groups only prompts reachable from more than one Russian sentence', () => {
    const out = collidingPrompts([
      phrase('a', 'На брю́ках появи́лось пятно́.', 'A stain appeared on the trousers.', 'брюки=trousers'),
      phrase('b', 'На штана́х появи́лось пятно́.', 'A stain appeared on the trousers.', 'штаны=trousers'),
      phrase('c', 'Э́то стол.', 'This is a table.', 'стол=table'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].en).toBe('A stain appeared on the trousers.')
  })

  it('does not treat the same sentence stored twice as a collision', () => {
    const out = collidingPrompts([
      phrase('a', 'Э́то стол.', 'This is a table.', 'стол=table'),
      phrase('b', 'Э́то стол.', 'This is a table.', 'это=this'),
    ])
    expect(out).toHaveLength(0)
  })
})

describe('separatedByNotes', () => {
  it('accepts a group whose members each carry different notes', () => {
    expect(separatedByNotes([
      phrase('a', 'Ты счита́ешь де́ньги?', 'Are you counting the money?', 'считать', ['you-informal']),
      phrase('b', 'Вы счита́ете де́ньги?', 'Are you counting the money?', 'считать', ['you-formal']),
    ])).toBe(true)
  })

  it('rejects a group where one member is unmarked', () => {
    expect(separatedByNotes([
      phrase('a', 'A', 'x', 'k', ['you-informal']),
      phrase('b', 'B', 'x', 'k', []),
    ])).toBe(false)
  })

  it('rejects a group whose members carry the same note', () => {
    expect(separatedByNotes([
      phrase('a', 'A', 'x', 'k', ['you-informal']),
      phrase('b', 'B', 'x', 'k', ['you-informal']),
    ])).toBe(false)
  })
})

describe('distinguishingTokens', () => {
  const group = [
    phrase('a', 'На брю́ках появи́лось пятно́.', 'x', 'брюки=trousers'),
    phrase('b', 'На штана́х появи́лось пятно́.', 'x', 'штаны=trousers'),
  ]

  it('returns only what is unique to the member', () => {
    expect(distinguishingTokens(group[0], group)).toEqual(['брюках'])
    expect(distinguishingTokens(group[1], group)).toEqual(['штанах'])
  })

  it('keeps й and ё intact — stripping stress must not orphan their diacritics', () => {
    const g = [
      phrase('a', 'Э́то кра́йне ва́жный вопро́с.', 'x', 'крайне=extremely'),
      phrase('b', 'Э́то чрезвыча́йно ва́жный вопро́с.', 'x', 'чрезвычайно=extremely'),
    ]
    // Naive NFD stripping splits «кра́йне» into "краи" + "не" and then hints
    // with the negation particle instead of the adverb.
    expect(distinguishingTokens(g[0], g)).toEqual(['крайне'])
    expect(distinguishingTokens(g[1], g)).toEqual(['чрезвычайно'])
  })
})

describe('hintFor', () => {
  const group = [
    phrase('a', 'На брю́ках появи́лось пятно́.', 'x', 'брюки=trousers'),
    phrase('b', 'На штана́х появи́лось пятно́.', 'x', 'штаны=trousers'),
  ]

  it('names the sense of the word that differs', () => {
    const resolve = resolveFrom({ брюках: TROUSERS[0], штанах: TROUSERS[1] })
    expect(hintFor(group[0], group, resolve)).toBe('trousers: the standard word')
    expect(hintFor(group[1], group, resolve)).toBe('trousers: the informal word')
  })

  it('yields nothing when the differing word has no distinguishing note', () => {
    const resolve = resolveFrom({ брюках: word('брюки=trousers', 'trousers', '') })
    expect(hintFor(group[0], group, resolve)).toBe('')
  })

  it('never hints with a function word, even when it is the only option', () => {
    const g = [
      phrase('a', 'Я не име́ю поня́тия.', 'x', 'иметь=to have'),
      phrase('b', 'У меня́ нет поня́тия.', 'x', 'понятие=idea'),
    ]
    // «не» is filed as an adverb, so a part-of-speech test alone lets it through.
    const resolve = resolveFrom({ не: word('не=not', 'not', 'negation particle', 'adverb') })
    expect(hintFor(g[0], g, resolve)).toBe('')
  })
})

describe('promptHints', () => {
  const phrases = [
    phrase('a', 'На брю́ках появи́лось пятно́.', 'A stain appeared on the trousers.', 'брюки=trousers'),
    phrase('b', 'На штана́х появи́лось пятно́.', 'A stain appeared on the trousers.', 'штаны=trousers'),
  ]
  const index = new Map([
    ['брюках', { key: 'брюки=trousers', senses: [{}] }],
    ['штанах', { key: 'штаны=trousers', senses: [{}] }],
  ])

  it('hints every member of a resolvable group', () => {
    const hints = promptHints(phrases, TROUSERS, index)
    expect(hints.get('a')).toBe('trousers: the standard word')
    expect(hints.get('b')).toBe('trousers: the informal word')
  })

  it('hints nobody when only some members can be hinted', () => {
    const half = [TROUSERS[0], word('штаны=trousers', 'trousers', '')]
    expect(promptHints(phrases, half, index).size).toBe(0)
  })

  it('hints nobody when the hints would be identical', () => {
    const same = [word('брюки=trousers', 'trousers', 'a leg garment'), word('штаны=trousers', 'trousers', 'a leg garment')]
    expect(promptHints(phrases, same, index).size).toBe(0)
  })

  it('leaves unambiguous prompts alone', () => {
    const solo = [phrase('a', 'Э́то стол.', 'This is a table.', 'стол=table')]
    expect(promptHints(solo, TROUSERS, index).size).toBe(0)
  })

  it('skips a group the ты/вы annotation already separates', () => {
    const tyvy = [
      phrase('a', 'Ты счита́ешь де́ньги?', 'Are you counting the money?', 'считать=to count', ['you-informal']),
      phrase('b', 'Вы счита́ете де́ньги?', 'Are you counting the money?', 'считать=to count', ['you-formal']),
    ]
    expect(promptHints(tyvy, TROUSERS, index).size).toBe(0)
  })
})

describe('ambiguousPrompts', () => {
  const index = new Map([
    ['брюках', { key: 'брюки=trousers', senses: [{}] }],
    ['штанах', { key: 'штаны=trousers', senses: [{}] }],
  ])
  const phrases = [
    phrase('a', 'На брю́ках появи́лось пятно́.', 'A stain appeared on the trousers.', 'брюки=trousers'),
    phrase('b', 'На штана́х появи́лось пятно́.', 'A stain appeared on the trousers.', 'штаны=trousers'),
  ]

  it('is empty once a hinted group has been confirmed', () => {
    const ok = new Set(['A stain appeared on the trousers.'])
    expect(ambiguousPrompts(phrases, TROUSERS, index, ok)).toEqual([])
  })

  it('does not call a hinted group resolved until a human confirms it', () => {
    // Different strings, same definition: «вско́ре» and «ско́ро» are both "soon".
    const paraphrase = [
      word('вскоре=soon', 'soon', 'a short time later', 'adverb'),
      word('скоро=soon', 'soon', 'in a short time', 'adverb'),
    ]
    const idx = new Map([
      ['вскоре', { key: 'вскоре=soon', senses: [{}] }],
      ['скоро', { key: 'скоро=soon', senses: [{}] }],
    ])
    const g = [
      phrase('a', 'Вско́ре насту́пит весна́.', 'Spring will soon arrive.', 'вскоре=soon'),
      phrase('b', 'Ско́ро насту́пит весна́.', 'Spring will soon arrive.', 'скоро=soon'),
    ]
    // A hint is still issued — it is informative even when not decisive …
    expect(promptHints(g, paraphrase, idx).size).toBe(2)
    // … but the group stays in the backlog until someone vouches for it.
    const out = ambiguousPrompts(g, paraphrase, idx)
    expect(out).toHaveLength(1)
    expect(out[0].why).toMatch(/nobody has confirmed/)
    expect(ambiguousPrompts(g, paraphrase, idx, new Set(['Spring will soon arrive.']))).toEqual([])
  })

  it('reports a group whose words share one note, and says so', () => {
    const same = [word('брюки=trousers', 'trousers', 'a leg garment'), word('штаны=trousers', 'trousers', 'a leg garment')]
    const out = ambiguousPrompts(phrases, same, index)
    expect(out).toHaveLength(1)
    expect(out[0].why).toMatch(/same note/)
  })

  it('calls out two spellings of one sentence as a data defect', () => {
    const stressed = [
      phrase('a', 'По сре́дам я хожу́ в бассе́йн.', 'On Wednesdays I go to the pool.', 'бассейн=swimming pool'),
      phrase('b', 'По среда́м я хожу́ в бассе́йн.', 'On Wednesdays I go to the pool.', 'среда=Wednesday'),
    ]
    const out = ambiguousPrompts(stressed, [], new Map())
    expect(out).toHaveLength(1)
    expect(out[0].why).toMatch(/stressed two different ways/)
  })
})
