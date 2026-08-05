import { describe, it, expect } from 'vitest'
import {
  isQuestion,
  phraseTokens,
  typingSequence,
  phraseCorrect,
  phraseCorrectBagOfWords,
  assessedWordCorrect,
  nextChar,
  hintKeys,
  spellingDiff,
  spellingDistance,
  RU_LETTERS,
  EN_LETTERS,
  listeningTokens,
  listeningWordPool,
  buildListeningBank,
  buildAssemblyBank,
  phraseFeedback,
} from './phrases.js'

// A deterministic pseudo-rng so hintKeys assertions are stable.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

describe('isQuestion', () => {
  it('detects a trailing question mark', () => {
    expect(isQuestion('Вы берёте зо́нтик в доро́гу?')).toBe(true)
    expect(isQuestion('Are you taking an umbrella?')).toBe(true)
  })
  it('ignores trailing whitespace and closing quotes', () => {
    expect(isQuestion('«Ты идёшь?»')).toBe(true)
    expect(isQuestion('Кто там?  ')).toBe(true)
  })
  it('is false for statements and exclamations', () => {
    expect(isQuestion('Я иду́ в шко́лу.')).toBe(false)
    expect(isQuestion('Осторо́жно!')).toBe(false)
    expect(isQuestion('')).toBe(false)
    expect(isQuestion(null)).toBe(false)
  })
  it('does not fire on a mid-sentence question mark', () => {
    expect(isQuestion('«Ты идёшь?» — спроси́л он.')).toBe(false)
  })
})

describe('phraseTokens', () => {
  it('splits on whitespace and keeps punctuation attached', () => {
    expect(phraseTokens('Я иду́ в шко́лу.')).toEqual(['Я', 'иду́', 'в', 'шко́лу.'])
  })
  it('returns an empty array for blank input', () => {
    expect(phraseTokens('   ')).toEqual([])
  })
})

describe('typingSequence', () => {
  it('drops stress, punctuation and case but preserves ё', () => {
    expect(typingSequence('Всё хорошо́!')).toBe('всё хорошо')
  })
  it('collapses whitespace', () => {
    expect(typingSequence('I  go   to school')).toBe('i go to school')
  })
})

describe('phraseCorrect', () => {
  it('accepts an answer that differs only in punctuation, case and stress', () => {
    expect(phraseCorrect('я иду в школу', 'Я иду́ в шко́лу.')).toBe(true)
  })
  it('rejects a wrong answer', () => {
    expect(phraseCorrect('я иду домой', 'Я иду́ в шко́лу.')).toBe(false)
  })
  it('rejects an empty answer', () => {
    expect(phraseCorrect('', 'дом')).toBe(false)
  })
  it('accepts an answer with a different article than the target', () => {
    expect(phraseCorrect('a cat eats a fish', 'The cat eats the fish.')).toBe(true)
  })
  it('accepts an answer with articles omitted', () => {
    expect(phraseCorrect('cat eats fish', 'The cat eats the fish.')).toBe(true)
  })
  it('does not strip "the" from inside a word', () => {
    expect(phraseCorrect('theorem', 'theorem')).toBe(true)
    expect(phraseCorrect('theory', 'theory')).toBe(true)
  })
  it('can still answer a single-article phrase correctly', () => {
    expect(phraseCorrect('a', 'a')).toBe(true)
  })
  it('accepts a match against any of several allowed renderings', () => {
    const targets = ['In summer the grass is green.', 'The grass is green in summer.']
    expect(phraseCorrect('the grass is green in summer', targets)).toBe(true)
    expect(phraseCorrect('in summer the grass is green', targets)).toBe(true)
  })
  it('rejects an answer that matches none of the allowed renderings', () => {
    expect(phraseCorrect('the sky is blue', ['this city is big', 'this is a big city'])).toBe(false)
  })
  it('treats ё and е as interchangeable in either direction', () => {
    expect(phraseCorrect('все', 'всё')).toBe(true)
    expect(phraseCorrect('всё', 'все')).toBe(true)
    expect(phraseCorrect('у нее нет пальто', 'У неё нет пальто́.')).toBe(true)
  })
})

describe('phraseCorrectBagOfWords', () => {
  it('accepts any reordering of the same words (#267)', () => {
    expect(phraseCorrectBagOfWords('today the weather is good', 'The weather is good today.')).toBe(
      true,
    )
    expect(phraseCorrectBagOfWords('the air is clean in the city', 'The air in the city is clean.')).toBe(
      true,
    )
  })
  it('still rejects an answer missing a word', () => {
    expect(phraseCorrectBagOfWords('the weather is good', 'The weather is good today.')).toBe(false)
  })
  it('still rejects an answer with an extra word', () => {
    expect(phraseCorrectBagOfWords('the weather is very good today', 'The weather is good today.')).toBe(
      false,
    )
  })
  it('still rejects a wrong word even if the count matches', () => {
    expect(phraseCorrectBagOfWords('the weather is bad today', 'The weather is good today.')).toBe(false)
  })
  it('rejects an empty answer', () => {
    expect(phraseCorrectBagOfWords('', 'дом')).toBe(false)
  })
  it('ignores article choice and folds punctuation/case/stress/ё-е regardless of order', () => {
    expect(phraseCorrectBagOfWords('THE CAT eats a fish', 'a fish eats the cat')).toBe(true)
    expect(phraseCorrectBagOfWords('cat eats dog', 'The cat eats the fish.')).toBe(false)
  })
  it('accepts a match against any of several allowed renderings', () => {
    const targets = ['In summer the grass is green.', 'The grass is green in summer.']
    expect(phraseCorrectBagOfWords('green summer the grass in is', targets)).toBe(true)
  })
})

describe('assessedWordCorrect', () => {
  // Target phrase "Я иду́ в шко́лу." with the assessed word школа (form: школу).
  it('is true when the assessed word is spelled right despite a slip elsewhere', () => {
    expect(assessedWordCorrect('я иду в школу', ['школу'])).toBe(true)
    // Wrong elsewhere ("ыду") but the word школу is still present and correct.
    expect(assessedWordCorrect('я ыду в школу', ['школу'])).toBe(true)
  })
  it('is false when the slip is in the assessed word itself', () => {
    expect(assessedWordCorrect('я иду в школе', ['школу'])).toBe(false)
    expect(assessedWordCorrect('я иду в', ['школу'])).toBe(false)
  })
  it('folds stress and ё/е in the answer (target tokens arrive normalised)', () => {
    // wordTokensInPhrase already folds ё→е and strips stress, so target tokens
    // are normalised; only the learner's answer needs folding here.
    expect(assessedWordCorrect('у неё нет пальто́', ['нее'])).toBe(true)
    expect(assessedWordCorrect('у нее нет пальто', ['нее'])).toBe(true)
  })
  it('requires every occurrence of a repeated word to be right', () => {
    expect(assessedWordCorrect('дом и дом', ['дом', 'дом'])).toBe(true)
    expect(assessedWordCorrect('дом и дам', ['дом', 'дом'])).toBe(false)
  })
  it('returns null when there are no target tokens to check', () => {
    expect(assessedWordCorrect('что угодно', [])).toBe(null)
    expect(assessedWordCorrect('что угодно', undefined)).toBe(null)
  })
})

describe('nextChar', () => {
  const target = 'Я иду́ в шко́лу.'
  it('returns the first expected letter when nothing is typed', () => {
    expect(nextChar(target, '')).toBe('я')
  })
  it('returns a space at a word boundary', () => {
    expect(nextChar(target, 'я')).toBe(' ')
  })
  it('returns the next letter mid-word', () => {
    expect(nextChar(target, 'я иду в шк')).toBe('о')
  })
  it('returns empty once complete', () => {
    expect(nextChar('дом', 'дом')).toBe('')
  })
  it('walks the learner through ё rather than folding it to е', () => {
    expect(nextChar('всё', 'вс')).toBe('ё')
  })
})

describe('hintKeys', () => {
  it('includes the correct next letter plus the requested decoys', () => {
    const keys = hintKeys('п', RU_LETTERS, 2, seededRng(3))
    expect(keys).toHaveLength(3)
    expect(keys).toContain('п')
    expect(new Set(keys).size).toBe(3)
  })
  it('defaults to five decoys (six keys lit)', () => {
    const keys = hintKeys('п', RU_LETTERS, undefined, seededRng(3))
    expect(keys).toHaveLength(6)
    expect(keys).toContain('п')
    expect(new Set(keys).size).toBe(6)
  })
  it('draws decoys from the requested alphabet plus the space', () => {
    const keys = hintKeys('a', EN_LETTERS, 2, seededRng(5))
    for (const k of keys) expect([...EN_LETTERS, ' ']).toContain(k)
  })
  it('treats the space as a normal key, decoyed by letters at a word boundary', () => {
    const keys = hintKeys(' ', RU_LETTERS, 4, seededRng(7))
    expect(keys).toHaveLength(5)
    expect(keys).toContain(' ')
    // The four decoys are real letters, never another space.
    expect(keys.filter((k) => k === ' ')).toHaveLength(1)
    for (const k of keys.filter((k) => k !== ' ')) expect(RU_LETTERS).toContain(k)
  })
  it('offers the space as a candidate decoy when a letter is next', () => {
    // Across many draws the space turns up among the decoys for a letter target,
    // proving it is in the candidate pool rather than special-cased out.
    const seen = new Set()
    for (let s = 0; s < 50; s++) for (const k of hintKeys('п', RU_LETTERS, 4, seededRng(s))) seen.add(k)
    expect(seen.has(' ')).toBe(true)
  })
  it('returns nothing once the phrase is complete', () => {
    expect(hintKeys('', RU_LETTERS)).toEqual([])
  })
})

describe('spellingDiff / spellingDistance', () => {
  const types = (typed, answer) => spellingDiff(typed, answer).map((c) => c.type)

  it('marks every character ok for a correct spelling', () => {
    expect(types('дом', 'дом')).toEqual(['ok', 'ok', 'ok'])
    expect(spellingDistance('дом', 'дом')).toBe(0)
  })
  it('flags a substituted letter without revealing the correct one', () => {
    const cells = spellingDiff('дам', 'дом')
    expect(cells.map((c) => c.type)).toEqual(['ok', 'wrong', 'ok'])
    // The wrong cell shows what the learner typed, not the answer letter.
    expect(cells[1].char).toBe('а')
    expect(spellingDistance('дам', 'дом')).toBe(1)
  })
  it('inserts a gap where a letter is missing', () => {
    expect(types('дм', 'дом')).toEqual(['ok', 'gap', 'ok'])
    expect(spellingDistance('дм', 'дом')).toBe(1)
  })
  it('flags an extra typed letter as wrong', () => {
    // One of the two identical о's is the extra one — either alignment is valid.
    const cells = types('доом', 'дом')
    expect(cells).toHaveLength(4)
    expect(cells.filter((t) => t === 'wrong')).toHaveLength(1)
    expect(cells.filter((t) => t === 'ok')).toHaveLength(3)
    expect(spellingDistance('доом', 'дом')).toBe(1)
  })
  it('folds ё/е and case so neither counts as a spelling error', () => {
    expect(spellingDistance('ВСЕ', 'всё')).toBe(0)
    expect(types('ВСЕ', 'всё')).toEqual(['ok', 'ok', 'ok'])
  })
})

describe('phraseFeedback', () => {
  it('bands a single-word slip by Levenshtein similarity', () => {
    // 1 edit in автомобиль (10 letters) → 90% → "Not quite".
    expect(phraseFeedback('автамобиль', 'автомобиль').message).toBe('Not quite')
    expect(phraseFeedback('автамобиль', 'автомобиль').tier).toBe('notQuite')
  })
  it('says "Almost correct" for a near-perfect answer', () => {
    // 1 slip (школе for школу) in a 25-char phrase → ~96% → "Almost correct".
    const fb = phraseFeedback('я иду в школе каждый день', 'я иду в школу каждый день')
    expect(fb.message).toBe('Almost correct')
    expect(fb.tier).toBe('almost')
  })
  it('says "Good try" for a roughly-three-quarters answer', () => {
    // "спаси" for "спасибо": 2 letters dropped from 7 → ~71% → "Good try".
    const fb = phraseFeedback('спаси', 'спасибо')
    expect(fb.message).toBe('Good try')
    expect(fb.tier).toBe('goodTry')
  })
  it('says "Incorrect" for an answer nowhere near', () => {
    const fb = phraseFeedback('нет', 'я иду в школу')
    expect(fb.message).toBe('Incorrect')
    expect(fb.tier).toBe('incorrect')
  })
  it('flags the right words in the wrong order and offers a reorder', () => {
    const fb = phraseFeedback('в школу я иду', 'я иду в школу')
    expect(fb.message).toBe('Right words, wrong order')
    expect(fb.reorder).toBe(true)
    // Chips are the learner's own tokens, ready to rearrange.
    expect(fb.chips.sort()).toEqual(['в', 'иду', 'школу', 'я'])
  })
  it('does not call a respelling a reorder', () => {
    // Same order, one word misspelt — not a reorder.
    const fb = phraseFeedback('я иду в школе', 'я иду в школу')
    expect(fb.reorder).toBe(false)
  })
  it('names a single missing word', () => {
    // Dropped "в"; the rest present and in order.
    const fb = phraseFeedback('я иду школу', 'я иду в школу')
    expect(fb.message).toBe('One word missing')
    expect(fb.reorder).toBe(false)
  })
  it('names several missing words', () => {
    const fb = phraseFeedback('я иду', 'я иду в школу')
    expect(fb.message).toBe('Two words missing')
  })
  it('counts a misspelt-but-recognisable word as present, not missing', () => {
    // "школе" for "школу" is one slip — the word is there, so nothing is missing.
    const fb = phraseFeedback('я иду в школе', 'я иду в школу')
    expect(fb.message).not.toMatch(/missing/)
  })
  it('does not report missing when the learner typed a wrong word in its place', () => {
    // "домой" replaces "в школу" wholesale — an error, not a clean omission.
    const fb = phraseFeedback('я иду домой', 'я иду в школу')
    expect(fb.message).not.toMatch(/missing/)
  })
  it('accepts the closest of several renderings for the band', () => {
    const fb = phraseFeedback('the weather is good', ['nice weather', 'the weather is good today'])
    // Closest rendering is "the weather is good today" (one word missing).
    expect(fb.message).toBe('One word missing')
  })
})

describe('listeningTokens', () => {
  it('lowercases and strips surrounding punctuation, keeping contractions', () => {
    expect(listeningTokens("Hello, don't go!")).toEqual(['hello', "don't", 'go'])
  })
  it('strips Russian stress marks', () => {
    expect(listeningTokens('Я иду́ домо́й')).toEqual(['я', 'иду', 'домой'])
  })
  it('returns an empty array for blank input', () => {
    expect(listeningTokens('   ')).toEqual([])
  })
})

describe('listeningWordPool', () => {
  it('collects a deduplicated pool of words across phrases', () => {
    const pool = listeningWordPool([{ en: 'I go home' }, { en: 'You go away' }])
    expect(pool).toContain('go')
    expect(pool.filter((w) => w === 'go')).toHaveLength(1)
    expect(new Set(pool).size).toBe(pool.length)
  })
})

describe('buildAssemblyBank', () => {
  it('contains all target tokens and rounds total size to ~2.5× phrase length', () => {
    const pool = ['the dog runs fast', 'she reads a book', 'we eat lunch']
    const bank = buildAssemblyBank('I go home', pool, 2.5, seededRng(1))
    const texts = bank.map((t) => t.text)
    for (const w of ['I', 'go', 'home']) expect(texts).toContain(w)
    // 3 words × 1.5 = 4.5 → rounds to 5 decoys → 8 total
    expect(bank.filter((t) => !t.decoy)).toHaveLength(3)
    expect(bank.filter((t) => t.decoy)).toHaveLength(5)
    expect(bank).toHaveLength(8)
  })
  it('never includes a decoy that appears in the target phrase (case-insensitive)', () => {
    const pool = ['go to school', 'home is nice']
    const bank = buildAssemblyBank('I go home', pool, 2.5, seededRng(2))
    const decoyTexts = bank.filter((t) => t.decoy).map((t) => t.text.toLowerCase())
    expect(decoyTexts).not.toContain('go')
    expect(decoyTexts).not.toContain('home')
    expect(decoyTexts).not.toContain('i')
  })
  it('gives every tile a unique id', () => {
    const pool = ['she runs fast', 'he eats lunch']
    const bank = buildAssemblyBank('I go home', pool, 2.5, seededRng(3))
    expect(new Set(bank.map((t) => t.id)).size).toBe(bank.length)
  })
  it('clamps decoys to the available pool when pool is small', () => {
    const pool = ['one two'] // only 2 unique non-target words
    const bank = buildAssemblyBank('I go home', pool, 2.5, seededRng(4))
    expect(bank.filter((t) => t.decoy)).toHaveLength(2)
    expect(bank).toHaveLength(5)
  })
  it('returns just the target tokens when pool is empty', () => {
    const bank = buildAssemblyBank('I go home', [], 2.5, seededRng(5))
    expect(bank.filter((t) => !t.decoy)).toHaveLength(3)
    expect(bank.filter((t) => t.decoy)).toHaveLength(0)
    expect(bank).toHaveLength(3)
  })
})

describe('buildListeningBank', () => {
  it('contains every target word plus the requested number of decoys', () => {
    const pool = ['cat', 'dog', 'fish', 'bird', 'tree']
    const bank = buildListeningBank('I see a dog', pool, 3, seededRng(7))
    const texts = bank.map((t) => t.text)
    for (const w of ['i', 'see', 'a', 'dog']) expect(texts).toContain(w)
    expect(bank.filter((t) => t.decoy)).toHaveLength(3)
    expect(bank).toHaveLength(7) // 4 words + 3 decoys
  })
  it('never uses a decoy that already appears in the phrase', () => {
    const pool = ['dog', 'cat'] // 'dog' is in the phrase and must be skipped
    const bank = buildListeningBank('the dog', pool, 3, seededRng(1))
    const decoys = bank.filter((t) => t.decoy).map((t) => t.text)
    expect(decoys).not.toContain('dog')
    expect(decoys).toEqual(['cat']) // only eligible decoy
  })
  it('gives every tile a unique id', () => {
    const bank = buildListeningBank('a b c', ['x', 'y'], 2, seededRng(2))
    expect(new Set(bank.map((t) => t.id)).size).toBe(bank.length)
  })
  it('creates a separate tile for each occurrence of a repeated word', () => {
    const bank = buildListeningBank('the cat sat on the mat', [], 0, seededRng(1))
    const theTiles = bank.filter((t) => t.text === 'the')
    expect(theTiles).toHaveLength(2)
    expect(new Set(theTiles.map((t) => t.id)).size).toBe(2)
    expect(bank).toHaveLength(6) // six words, two of which are 'the'
  })
})
