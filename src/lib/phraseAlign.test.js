import { describe, it, expect } from 'vitest'

import { buildFormIndex } from './phraseHint.js'
import {
  alignPhraseTokens,
  alignedHintTokens,
  alignedKeys,
  englishStems,
  resolveCandidates,
  tokenCandidates,
  unalignedTokens,
} from './phraseAlign.js'

/**
 * «мыть»'s imperative — «мой» — which is what makes it collide with the
 * possessive pronoun. Stored on the record the way a real verb stores it, so
 * `wordForms` finds it.
 */
const WASHES = { pos: 'verb', conjugation: { imp_sg: 'мой' } }

/** A minimal normalised word record, as `buildWords` would hand one over. */
const word = (key, ru, meaning, extra = {}) => ({
  key,
  ru,
  headword: extra.headword ?? ru,
  meaning,
  pos: extra.pos ?? 'noun',
  learnable: extra.learnable !== false,
  lemma: extra.lemma ?? null,
  mannerPair: extra.mannerPair ?? null,
  participleOf: extra.participleOf ?? null,
  forms: extra.forms ?? {},
  extra: {
    ...(extra.comparative ? { forms: { comparative: extra.comparative } } : {}),
    ...(extra.conjugation ? { conjugation: extra.conjugation } : {}),
  },
})

const fixture = (words) => ({
  words,
  index: buildFormIndex(words),
  byKey: new Map(words.map((w) => [w.key, w])),
})

describe('tokenCandidates', () => {
  const { index } = fixture([
    word('кот=cat', 'кот', 'cat'),
    word('кит=whale', 'кит', 'whale', { forms: { sg: { acc: 'кот' } } }),
    word('спать=to sleep', 'спать', 'to sleep'),
  ])

  it('returns one key for a form only one word claims', () => {
    expect(tokenCandidates('спать', index)).toEqual(['спать=to sleep'])
  })

  it('returns every word that can surface as a contested form', () => {
    expect(tokenCandidates('кот', index).sort()).toEqual(['кит=whale', 'кот=cat'])
  })

  it('ignores punctuation and returns nothing for an unknown word', () => {
    expect(tokenCandidates('кот.', index).sort()).toEqual(['кит=whale', 'кот=cat'])
    expect(tokenCandidates('фывап', index)).toEqual([])
    expect(tokenCandidates('—', index)).toEqual([])
  })

  it('prefers a stress-exact match, so heteronyms stay apart', () => {
    const { index: heteronym } = fixture([
      word('полка=shelf', 'полка', 'shelf', {
        forms: { sg: { prep: 'по́лке' } },
      }),
      word('полк=regiment', 'полк', 'regiment', {
        forms: { sg: { prep: 'полке́' } },
      }),
    ])
    expect(tokenCandidates('по́лке', heteronym)).toEqual(['полка=shelf'])
    expect(tokenCandidates('полке́', heteronym)).toEqual(['полк=regiment'])
    // Unmarked, the two are genuinely indistinguishable and both come back.
    expect(tokenCandidates('полке', heteronym).sort()).toEqual(['полк=regiment', 'полка=shelf'])
  })
})

describe('resolveCandidates', () => {
  it('settles an uncontested token without needing a dictionary', () => {
    expect(resolveCandidates(['кот=cat'])).toEqual({
      key: 'кот=cat',
      show: ['кот=cat'],
      credit: ['кот=cat'],
      via: 'unique',
    })
  })

  it('has no opinion at all with no candidates', () => {
    expect(resolveCandidates([])).toBeNull()
    expect(resolveCandidates(null)).toBeNull()
  })

  it('refuses to guess a contested token when handed no dictionary', () => {
    // Every rung below `inflect` reads word records. Without them the rungs
    // cannot run, and a rung that cannot run must not fall back to a coin flip.
    expect(resolveCandidates(['а=a', 'б=b'], {})).toBeNull()
  })

  it('takes an authored annotation over everything else', () => {
    const { byKey } = fixture([
      word('мой=my', 'мой', 'my'),
      word('мыть=to wash', 'мыть', 'to wash', WASHES),
    ])
    const out = resolveCandidates(['мой=my', 'мыть=to wash'], {
      byKey,
      authored: 'мыть=to wash',
      evidence: englishStems('my hands'),
    })
    expect(out).toEqual({
      key: 'мыть=to wash',
      show: ['мыть=to wash'],
      credit: ['мыть=to wash'],
      via: 'authored',
    })
  })

  it('ignores an authored annotation naming a word that cannot be this token', () => {
    const { byKey } = fixture([
      word('мой=my', 'мой', 'my'),
      word('мыть=to wash', 'мыть', 'to wash', WASHES),
    ])
    expect(
      resolveCandidates(['мой=my', 'мыть=to wash'], {
        byKey,
        authored: 'кот=cat',
      }),
    ).toBeNull()
  })

  it('credits the lemma when a rung names one of its gloss-only stubs', () => {
    // The annotation may name the stub — it is the entry whose gloss fits — but
    // a stub is not in the curriculum, so what the bars can report is its lemma.
    const { byKey } = fixture([
      word('купить=to buy', 'купить', 'to buy', { pos: 'verb' }),
      word('купи=buy', 'купи', 'buy (imperative)', { learnable: false, lemma: 'купить=to buy' }),
      word('купе=compartment', 'купе', 'compartment'),
    ])
    const out = resolveCandidates(['купе=compartment', 'купи=buy', 'купить=to buy'], {
      byKey,
      authored: 'купи=buy',
    })
    expect(out.key).toBe('купи=buy')
    expect(out.credit).toEqual(['купить=to buy'])
    // The rival word is ruled out; the stub's own lemma is not.
    expect(out.show.sort()).toEqual(['купи=buy', 'купить=to buy'])
  })

  it("takes the example's own inflect: target next", () => {
    const { byKey } = fixture([
      word('мой=my', 'мой', 'my'),
      word('мыть=to wash', 'мыть', 'to wash', WASHES),
    ])
    const out = resolveCandidates(['мой=my', 'мыть=to wash'], {
      byKey,
      inflect: 'мыть=to wash',
    })
    expect(out.via).toBe('inflect')
    expect(out.key).toBe('мыть=to wash')
  })
})

describe('resolveCandidates — structural rungs', () => {
  it('collapses a gloss-only stub into the lemma it is a form of', () => {
    const { byKey } = fixture([
      word('купить=to buy', 'купить', 'to buy', { pos: 'verb' }),
      word('купи=buy', 'купи', 'buy (imperative)', {
        learnable: false,
        lemma: 'купить=to buy',
      }),
    ])
    const out = resolveCandidates(['купи=buy', 'купить=to buy'], {
      byKey,
      bare: 'купи',
    })
    expect(out.via).toBe('lemma')
    expect(out.key).toBe('купить=to buy')
    // Both glosses stay on show — "buy (imperative)" is the more useful of the
    // two for a learner tapping «купи́» — but only the curriculum word is
    // creditable, because a stub is not something the bars can report.
    expect(out.show.sort()).toEqual(['купи=buy', 'купить=to buy'])
    expect(out.credit).toEqual(['купить=to buy'])
  })

  it('collapses several entries spelling one Russian word, crediting every sense', () => {
    const { byKey } = fixture([
      word('лист=leaf', 'лист', 'leaf'),
      word('лист=sheet', 'лист', 'sheet'),
    ])
    const out = resolveCandidates(['лист=leaf', 'лист=sheet'], {
      byKey,
      bare: 'лист',
    })
    expect(out.via).toBe('polysemy')
    expect(out.show).toEqual(['лист=leaf', 'лист=sheet'])
    expect(out.credit).toEqual(['лист=leaf', 'лист=sheet'])
  })

  it('collapses an adjective and its manner adverb', () => {
    const { byKey } = fixture([
      word('быстрый=fast', 'быстрый', 'fast', {
        pos: 'adjective',
        mannerPair: { key: 'быстро=quickly' },
      }),
      word('быстро=quickly', 'быстро', 'quickly', {
        pos: 'adverb',
        mannerPair: { key: 'быстрый=fast' },
      }),
    ])
    const out = resolveCandidates(['быстро=quickly', 'быстрый=fast'], {
      byKey,
      bare: 'быстро',
    })
    expect(out.via).toBe('family')
    // The head is whichever member owns the token as its dictionary form.
    expect(out.key).toBe('быстро=quickly')
    expect(out.credit.sort()).toEqual(['быстро=quickly', 'быстрый=fast'])
  })

  it('collapses a three-way family joined through a suppletive comparative', () => {
    // «лу́чше» is the comparative of both хоро́ший and хорошо́, and has an entry of
    // its own; without the comparative edge the three read as rival words.
    const { byKey } = fixture([
      word('хороший=good', 'хороший', 'good', {
        pos: 'adjective',
        mannerPair: { key: 'хорошо=well' },
        comparative: 'лу́чше',
      }),
      word('хорошо=well', 'хорошо', 'well', {
        pos: 'adverb',
        mannerPair: { key: 'хороший=good' },
        comparative: 'лу́чше',
      }),
      word('лучше=better', 'лучше', 'better', { pos: 'adverb' }),
    ])
    const out = resolveCandidates(['лучше=better', 'хороший=good', 'хорошо=well'], {
      byKey,
      bare: 'лучше',
    })
    expect(out.via).toBe('family')
    expect(out.credit).toHaveLength(3)
  })

  it('joins two words that merely share a comparative form', () => {
    // «бо́льше» is stored as the comparative of большо́й and мно́го without being
    // an entry itself, so there is no third node to route the edges through.
    const { byKey } = fixture([
      word('большой=big', 'большой', 'big', {
        pos: 'adjective',
        comparative: 'бо́льше',
      }),
      word('много=a lot', 'много', 'a lot', {
        pos: 'adverb',
        comparative: 'бо́льше',
      }),
    ])
    const out = resolveCandidates(['большой=big', 'много=a lot'], {
      byKey,
      bare: 'больше',
    })
    expect(out.via).toBe('family')
    expect(out.credit.sort()).toEqual(['большой=big', 'много=a lot'])
  })

  it('leaves two unrelated words unresolved rather than picking one', () => {
    const { byKey } = fixture([
      word('мой=my', 'мой', 'my', { pos: 'pronoun' }),
      word('мыть=to wash', 'мыть', 'to wash', { pos: 'verb', ...WASHES }),
    ])
    expect(resolveCandidates(['мой=my', 'мыть=to wash'], { byKey, bare: 'мой' })).toBeNull()
  })
})

describe('resolveCandidates — the English evidence rung', () => {
  const { byKey } = fixture([
    word('дорога=road', 'дорога', 'road'),
    word('дорогой=expensive', 'дорогой', 'expensive', { pos: 'adjective' }),
    word('встреча=meeting', 'встреча', 'meeting'),
    word('встретить=to meet', 'встретить', 'to meet', { pos: 'verb' }),
    word('бег=running', 'бег', 'running'),
    word('бежать=to run', 'бежать', 'to run', { pos: 'verb' }),
  ])

  it('takes the candidate the translation vouches for', () => {
    const out = resolveCandidates(['дорога=road', 'дорогой=expensive'], {
      byKey,
      evidence: englishStems('We stayed in an expensive hotel'),
      bare: 'дорогой',
    })
    expect(out).toMatchObject({ key: 'дорогой=expensive', via: 'english' })
  })

  it('stays quiet where a noun and its verb share an English root', () => {
    // «встре́чу» is the meeting or "I will meet", and English says "meeting"
    // for both. The rung can see the overlap, so it declines — this is the
    // shape of ambiguity that an align: annotation exists to settle.
    expect(
      resolveCandidates(['встреча=meeting', 'встретить=to meet'], {
        byKey,
        evidence: englishStems('Authors came to the meeting'),
        bare: 'встречу',
      }),
    ).toBeNull()
  })

  it('stays quiet when two candidates answer to the same English word', () => {
    // "running" is evidence for «бег» and for «бежа́ть» alike. A prefix match
    // that cannot tell them apart is not evidence.
    expect(
      resolveCandidates(['бег=running', 'бежать=to run'], {
        byKey,
        evidence: englishStems('I am running to work'),
        bare: 'бегу',
      }),
    ).toBeNull()
  })

  it('stays quiet when the translation says nothing about either candidate', () => {
    expect(
      resolveCandidates(['встреча=meeting', 'водить=to drive'], {
        byKey,
        evidence: englishStems('It happened yesterday'),
        bare: 'встречу',
      }),
    ).toBeNull()
  })
})

describe('alignPhraseTokens', () => {
  const { index, byKey } = fixture([
    word('кот=cat', 'кот', 'cat'),
    word('спать=to sleep', 'спать', 'to sleep', { pos: 'verb', forms: {} }),
    word('мой=my', 'мой', 'my', { pos: 'pronoun' }),
    word('мыть=to wash', 'мыть', 'to wash', { pos: 'verb', ...WASHES }),
  ])

  it('tags every display token, keeping the phrase order and the raw text', () => {
    const out = alignPhraseTokens('Кот спать.', index, { byKey })
    expect(out.map((t) => t.text)).toEqual(['Кот', 'спать.'])
    expect(out.map((t) => t.alignment?.key)).toEqual(['кот=cat', 'спать=to sleep'])
  })

  it('reads an authored align: block at its 1-based index', () => {
    const out = alignPhraseTokens('Мой кот', index, {
      byKey,
      align: { 1: 'мыть=to wash' },
    })
    expect(out[0].alignment).toMatchObject({
      key: 'мыть=to wash',
      via: 'authored',
    })
  })

  it('reads a string-keyed align: block, as YAML hands one over', () => {
    const out = alignPhraseTokens('Мой кот', index, {
      byKey,
      align: { 3: 'x', 1: 'мыть=to wash' },
    })
    expect(out[0].alignment?.key).toBe('мыть=to wash')
  })

  it('applies inflect: only to the token it names', () => {
    const out = alignPhraseTokens('Мой мой', index, {
      byKey,
      inflectToken: 2,
      inflectKey: 'мыть=to wash',
    })
    expect(out[0].alignment).toBeNull()
    expect(out[1].alignment).toMatchObject({
      key: 'мыть=to wash',
      via: 'inflect',
    })
  })

  it('leaves an unknown word with neither candidates nor an alignment', () => {
    const [token] = alignPhraseTokens('фывап', index, { byKey })
    expect(token).toEqual({ text: 'фывап', candidates: [], alignment: null })
  })
})

describe('alignedKeys and unalignedTokens', () => {
  const { index, byKey } = fixture([
    word('кот=cat', 'кот', 'cat'),
    word('мой=my', 'мой', 'my', { pos: 'pronoun' }),
    word('мыть=to wash', 'мыть', 'to wash', { pos: 'verb', ...WASHES }),
  ])

  it('lists each attributed word once, in phrase order', () => {
    expect(alignedKeys('Кот и кот', index, { byKey })).toEqual(['кот=cat'])
  })

  it('reports the contested tokens nothing settled, 1-based', () => {
    expect(unalignedTokens('Мой кот', index, { byKey })).toEqual([
      { token: 1, text: 'Мой', candidates: ['мой=my', 'мыть=to wash'] },
    ])
  })

  it('reports nothing once the token is annotated', () => {
    expect(
      unalignedTokens('Мой кот', index, {
        byKey,
        align: { 1: 'мыть=to wash' },
      }),
    ).toEqual([])
  })
})

describe('alignedHintTokens', () => {
  const words = [
    word('мой=my', 'мой', 'my', { pos: 'pronoun' }),
    word('мыть=to wash', 'мыть', 'to wash', { pos: 'verb', ...WASHES }),
    word('лист=leaf', 'лист', 'leaf'),
    word('лист=sheet', 'лист', 'sheet'),
  ]
  const { index, byKey } = fixture(words)

  it('glosses an aligned token as the word it is, not the one the index picked', () => {
    // Unaligned, «Мой» glosses as the pronoun: its dictionary form outranks the
    // verb's imperative in the index's collision rules.
    const [plain] = alignedHintTokens('Мой', index, { byKey })
    expect(plain.hint.en).toBe('my')

    const [aligned] = alignedHintTokens('Мой', index, {
      byKey,
      align: { 1: 'мыть=to wash' },
    })
    expect(aligned.hint.en).toBe('to wash')
    expect(aligned.hint.senses).toHaveLength(1)
  })

  it('keeps every gloss where the token is one word with several senses', () => {
    const [token] = alignedHintTokens('лист', index, { byKey })
    expect(token.alignment.via).toBe('polysemy')
    expect(token.hint.en).toBe('leaf / sheet')
  })

  it('hands back the index entry unchanged when alignment agrees with it', () => {
    const bare = alignedHintTokens('лист', index, {})
    const withDict = alignedHintTokens('лист', index, { byKey })
    expect(withDict[0].hint).toBe(bare[0].hint)
  })

  it('does not repeat a gloss two entries share', () => {
    // «вина́» is the genitive of «вино́» "wine" and also the nominative of
    // «вина́» "guilt"; the glossary carries a stub for the form, glossed "wine"
    // like its lemma. Rebuilding the entry around the wine reading must not
    // print "wine / wine" — the form index has its own guard against that, and
    // a rebuilt entry has to match it.
    const words = [
      word('вина=guilt', 'вина', 'guilt'),
      word('вина=wine', 'вина', 'wine', { learnable: false, lemma: 'вино=wine' }),
      word('вино=wine', 'вино', 'wine', { forms: { sg: { gen: 'вина́' } } }),
    ]
    const { index, byKey } = fixture(words)
    const [token] = alignedHintTokens('вина', index, { byKey, align: { 1: 'вино=wine' } })
    expect(token.hint.en).toBe('wine')
    expect(token.hint.senses).toHaveLength(1)
  })

  it('leaves a token with no dictionary entry alone', () => {
    const [token] = alignedHintTokens('фывап', index, { byKey })
    expect(token).toEqual({ text: 'фывап', hint: null, alignment: null })
  })
})

describe('englishStems', () => {
  it('drops stop words, punctuation and anything too short', () => {
    expect([...englishStems('The kitten is on a rug.')]).toEqual(['kitten'])
  })

  it('strips the suffixes that separate a gloss from its sentence form', () => {
    expect(englishStems('She was running quickly').has('runn')).toBe(true)
  })

  it('keeps shorter stems when asked, so a short gloss can still object', () => {
    expect([...englishStems('to run', 3)]).toEqual(['run'])
    expect([...englishStems('to run')]).toEqual([])
  })
})
