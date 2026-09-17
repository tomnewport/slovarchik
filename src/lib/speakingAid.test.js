import { describe, it, expect } from 'vitest'

import {
  HINT_ORDER,
  HINT_REVEAL,
  blankToken,
  buildSpeakingAid,
  hintLadder,
  rungIsFree,
  speakingDictionary,
  speakingSkeleton,
} from './speakingAid.js'

/** An aligned hint token, as `alignedHintTokens` hands them over. */
function token(text, { key, ru, en, credit } = {}) {
  return {
    text,
    hint: key ? { key, ru: ru ?? key, en, senses: [{ key, ru: ru ?? key, en }] } : null,
    alignment: key ? { key, show: [key], credit: credit ?? [key], via: 'test' } : null,
  }
}

// «Купи́ ребёнку а́тлас» — "buy the child an atlas" — drilling а́тлас.
const sentence = [
  token('Купи́', { key: 'купи́ть=to buy', ru: 'купи́ть', en: 'to buy' }),
  token('ребёнку', { key: 'ребёнок=child', ru: 'ребёнок', en: 'child' }),
  token('а́тлас.', { key: 'а́тлас=atlas', ru: 'а́тлас', en: 'atlas' }),
]
const about = { targets: ['а́тлас=atlas'], targetTokens: ['атлас'] }

describe('rungIsFree', () => {
  it('leaves the fire lit for the dictionary and the ordering hint', () => {
    expect(rungIsFree(0)).toBe(true)
    expect(rungIsFree(HINT_ORDER)).toBe(true)
  })

  it('puts it out once the answer has been revealed', () => {
    expect(rungIsFree(HINT_REVEAL)).toBe(false)
  })
})

describe('hintLadder', () => {
  it('offers ordering then the reveal when there is a sentence to arrange', () => {
    expect(hintLadder({ hasSkeleton: true })).toEqual([HINT_ORDER, HINT_REVEAL])
  })

  it('goes straight to the reveal for a single word', () => {
    expect(hintLadder({ hasSkeleton: false })).toEqual([HINT_REVEAL])
    expect(hintLadder()).toEqual([HINT_REVEAL])
  })
})

describe('speakingDictionary', () => {
  it('lists the non-target words as headwords, alphabetically', () => {
    expect(speakingDictionary(sentence, about)).toEqual([
      { key: 'купи́ть=to buy', ru: 'купи́ть', en: 'to buy' },
      { key: 'ребёнок=child', ru: 'ребёнок', en: 'child' },
    ])
  })

  it('never lists the word being assessed, whichever way it is recognised', () => {
    // By alignment alone (no `targetTokens` resolved from the paradigm)…
    expect(speakingDictionary(sentence, { targets: ['а́тлас=atlas'] }).map((e) => e.key)).not.toContain(
      'а́тлас=atlas',
    )
    // …and by surface form alone, when alignment settled nothing.
    const unaligned = [token('а́тлас.', { key: 'а́тлас=atlas', en: 'atlas' })]
    unaligned[0].alignment = null
    expect(speakingDictionary(unaligned, { targetTokens: ['атлас'] })).toEqual([])
  })

  it('excludes a target credited through a collapsed alignment group', () => {
    const tokens = [token('гро́мче', { key: 'гро́мкий=loud', en: 'loud', credit: ['гро́мкий=loud', 'гро́мко=loudly'] })]
    expect(speakingDictionary(tokens, { targets: ['гро́мко=loudly'] })).toEqual([])
  })

  it('lists a repeated word once and drops tokens with nothing to define', () => {
    const tokens = [
      token('и', { key: 'и=and', ru: 'и', en: 'and' }),
      token('Москва́'),
      token('и', { key: 'и=and', ru: 'и', en: 'and' }),
    ]
    expect(speakingDictionary(tokens, {})).toEqual([{ key: 'и=and', ru: 'и', en: 'and' }])
  })
})

describe('blankToken', () => {
  it('replaces the letters and keeps the punctuation around them', () => {
    expect(blankToken('а́тлас.')).toBe('___.')
    expect(blankToken('«дом»')).toBe('«___»')
  })
})

describe('speakingSkeleton', () => {
  it('keeps every other word in its real inflected form', () => {
    expect(speakingSkeleton(sentence, about)).toEqual([
      { text: 'Купи́', blank: false },
      { text: 'ребёнку', blank: false },
      { text: '___.', blank: true },
    ])
  })
})

describe('buildSpeakingAid', () => {
  it('reports a usable skeleton when the target was found', () => {
    const aid = buildSpeakingAid(sentence, about)
    expect(aid.hasSkeleton).toBe(true)
    expect(aid.dictionary).toHaveLength(2)
  })

  it('withholds the skeleton when nothing in the sentence is the target', () => {
    // Blank-free, so the "hint" would be the answer in full.
    expect(buildSpeakingAid(sentence, { targets: ['мо́ре=sea'] }).hasSkeleton).toBe(false)
  })

  it('withholds the skeleton for a one-word prompt', () => {
    const one = [token('дом', { key: 'дом=house', en: 'house' })]
    expect(buildSpeakingAid(one, { targets: ['дом=house'] }).hasSkeleton).toBe(false)
  })
})
