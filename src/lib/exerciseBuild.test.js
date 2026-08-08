import { describe, it, expect } from 'vitest'
import { buildExercises, makeVisualReplacement, makeReplacementPicker, buildCombinedFlashcard, PRACTICE_KIND, MATCH_PAIRS, MIN_ENCOUNTERS_FOR_SPELLING, MIN_WORDS_FOR_SPELLING, CONTEXT_SET_ITEMS } from './exerciseBuild.js'
import { CONTRAST_DRILL_ITEMS, CONTRAST_DRILL_MIN_ITEMS } from './phraseContext.js'
import { shapePhrases, shapeVocab } from './vocabBuild.js'
import { buildParadigm } from './paradigm.js'
import { normToken } from './phraseHint.js'
import { phraseTokens } from './phrases.js'
import { loadFixtureWords, loadFixtureContextPhrases, loadFixtureRules } from '../test/fixtures.js'

function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

const words = loadFixtureWords()
const phrases = shapePhrases(words)
const contextPhrases = loadFixtureContextPhrases()
const rules = loadFixtureRules()

/** Word keys from the fixture that have a usable inflection paradigm. */
const inflectableKeys = words.filter((w) => buildParadigm(w) != null).map((w) => w.key)
/** Words that carry a phrase-completion (context) drill — i.e. have a phrase. */
const contextKeys = words.filter((w) => contextPhrases.has(w.key)).map((w) => w.key)

// One practice per catalogue entry, each with an empty pool (so the builder
// tops up from the whole vocabulary).
function practice(practiceType, overrides = {}) {
  const dims = {
    'match-vocab': 'identification',
    'listen-match': 'hearing',
    'translate-phrase': 'identification',
    'listen-translate': 'hearing',
    'spell-word': 'usage',
    'spell-phrase': 'usage',
    dictation: 'hearing',
    'repeat-word': 'speaking',
    'repeat-phrase': 'speaking',
    'inflect-bank': 'identification',
    'inflect-keyboard': 'usage',
    'inflect-context': 'context',
  }
  const content = practiceType.includes('phrase') || practiceType === 'translate-phrase' || practiceType === 'dictation' || practiceType === 'listen-translate'
    ? 'phrase'
    : practiceType.startsWith('inflect')
      ? 'inflection'
      : 'word'
  return {
    practiceType,
    dimension: dims[practiceType],
    level: practiceType.startsWith('inflect') ? 'mastery' : 'learning',
    content,
    bucket: 'current',
    exercises: 3,
    pool: [],
    ...overrides,
  }
}

function build(practices, seed = 1) {
  return buildExercises({ practices }, { words, phrases, contextPhrases, rules, rng: seededRng(seed) })
}

describe('buildExercises', () => {
  it('maps every practice type to a renderable kind', () => {
    for (const type of Object.keys(PRACTICE_KIND)) {
      // Mastery inflect exercises require pool words (no top-up outside the batch).
      const overrides =
        type === 'inflect-context'
          ? { pool: contextKeys.slice(0, 5) }
          : type.startsWith('inflect')
            ? { pool: inflectableKeys.slice(0, 5) }
            : {}
      const ex = build([practice(type, overrides)])
      expect(ex.length).toBeGreaterThan(0)
      expect(ex.every((e) => e.kind === PRACTICE_KIND[type])).toBe(true)
    }
  })

  it('gives every exercise a unique id, targets, dimension and level', () => {
    const ex = build([practice('spell-word'), practice('translate-phrase')])
    expect(new Set(ex.map((e) => e.id)).size).toBe(ex.length)
    for (const e of ex) {
      expect(e.targets.length).toBeGreaterThan(0)
      expect(e.dimension).toBeTruthy()
      expect(['learning', 'mastery']).toContain(e.level)
      expect(typeof e.practiceIndex).toBe('number')
    }
  })

  it('builds a single matching board of up to MATCH_PAIRS pairs', () => {
    const ex = build([practice('match-vocab')])
    expect(ex).toHaveLength(1)
    expect(ex[0].kind).toBe('match')
    expect(ex[0].pairs.length).toBeLessThanOrEqual(MATCH_PAIRS)
    expect(ex[0].pairs.length).toBe(ex[0].targets.length)
    expect(ex[0].pairs[0]).toHaveProperty('ru')
    expect(ex[0].pairs[0]).toHaveProperty('en')
  })

  it('flags hearing practices as audio (heard, not seen)', () => {
    expect(build([practice('listen-match')])[0].audio).toBe(true)
    expect(build([practice('dictation')])[0].audio).toBe(true)
    expect(build([practice('spell-word')])[0].audio).toBe(false)
  })

  it('produces up to `exercises` items for word/phrase practices', () => {
    const ex = build([practice('spell-word', { exercises: 4 })])
    expect(ex.length).toBeLessThanOrEqual(4)
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.every((e) => e.kind === 'type' && e.ru && e.en)).toBe(true)
  })

  it('only builds inflection exercises for words that have a paradigm', () => {
    // Mastery exercises require pool words — no top-up from outside the batch.
    const pool = inflectableKeys.slice(0, 5)
    const ex = build([practice('inflect-bank', { exercises: 5, pool })])
    expect(ex.length).toBeGreaterThan(0)
    for (const e of ex) {
      expect(e.kind).toBe('inflect')
      expect(e.mode).toBe('bank')
      expect(e.wordKey).toBeTruthy()
    }
    const exKb = build([practice('inflect-keyboard', { pool: inflectableKeys.slice(0, 3) })])
    expect(exKb[0].mode).toBe('keyboard')
  })

  it('mastery inflect exercises never include words outside the pool', () => {
    const pool = inflectableKeys.slice(0, 3)
    const poolSet = new Set(pool)
    // Request more exercises than pool words; without top-up the result stays
    // within the pool.
    const ex = build([practice('inflect-bank', { exercises: 10, pool })])
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.length).toBeLessThanOrEqual(pool.length)
    for (const e of ex) expect(poolSet.has(e.targets[0])).toBe(true)
  })

  it('preserves the practice index across a multi-practice session', () => {
    const ex = build([practice('spell-word'), practice('match-vocab'), practice('repeat-word')])
    expect(new Set(ex.map((e) => e.practiceIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('prefers pool words when a pool is supplied', () => {
    const poolKey = words[0].key
    const ex = build([practice('spell-word', { exercises: 1, pool: [poolKey] })])
    expect(ex[0].targets).toContain(poolKey)
  })

  describe('spelling encounter prerequisite', () => {
    it('skips words with too few identification encounters for spell-word', () => {
      // Make exactly MIN_WORDS_FOR_SPELLING words eligible so the pool-size gate
      // is satisfied, but all other words are locked out.
      const eligibleKeys = new Set(words.slice(0, MIN_WORDS_FOR_SPELLING).map((w) => w.key))
      const encounterCount = (key) => (eligibleKeys.has(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
      for (const e of ex) expect(eligibleKeys.has(e.targets[0])).toBe(true)
    })

    it('produces no spelling exercises when no word has enough encounters', () => {
      const encounterCount = () => 0
      const ex = buildExercises(
        { practices: [practice('spell-word'), practice('spell-phrase'), practice('dictation')] },
        { words, phrases, rng: seededRng(2), encounterCount },
      )
      expect(ex).toHaveLength(0)
    })

    it('does not filter non-spelling exercises by encounter count', () => {
      const encounterCount = () => 0
      const ex = buildExercises(
        { practices: [practice('match-vocab'), practice('translate-phrase')] },
        { words, phrases, rng: seededRng(3), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
    })

    it('applies no encounter filter when encounterCount is not supplied', () => {
      const ex = build([practice('spell-word')])
      expect(ex.length).toBeGreaterThan(0)
    })

    it('skips spell-word when fewer than MIN_WORDS_FOR_SPELLING words qualify', () => {
      // Only MIN_WORDS_FOR_SPELLING - 1 words are eligible → spelling is skipped.
      const eligibleKeys = new Set(words.slice(0, MIN_WORDS_FOR_SPELLING - 1).map((w) => w.key))
      const encounterCount = (key) => (eligibleKeys.has(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex).toHaveLength(0)
    })

    it('allows spelling once MIN_WORDS_FOR_SPELLING words qualify', () => {
      const eligibleKeys = words.slice(0, MIN_WORDS_FOR_SPELLING).map((w) => w.key)
      const encounterCount = (key) => (eligibleKeys.includes(key) ? MIN_ENCOUNTERS_FOR_SPELLING : 0)
      const ex = buildExercises(
        { practices: [practice('spell-word', { exercises: 5 })] },
        { words, phrases, rng: seededRng(1), encounterCount },
      )
      expect(ex.length).toBeGreaterThan(0)
    })
  })

  describe('phrase-spelling assessed-word tokens', () => {
    it('tags spell-phrase exercises with the source word forms found in the phrase', () => {
      const ex = build([practice('spell-phrase', { exercises: 8 })])
      expect(ex.length).toBeGreaterThan(0)
      // At least one descriptor should locate its source word inside the phrase.
      const tagged = ex.filter((e) => e.targetTokens?.length)
      expect(tagged.length).toBeGreaterThan(0)
      for (const e of tagged) {
        const inPhrase = new Set(phraseTokens(e.ru).map(normToken))
        for (const t of e.targetTokens) expect(inPhrase.has(t)).toBe(true)
      }
    })

    it('does not tag non-spelling phrase exercises (translate-phrase)', () => {
      const ex = build([practice('translate-phrase', { exercises: 5 })])
      expect(ex.length).toBeGreaterThan(0)
      for (const e of ex) expect(e.targetTokens).toBeUndefined()
    })
  })

  it('builds speak exercises for any eligible word', () => {
    const ex = build([practice('repeat-word')])
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.every((e) => e.kind === 'speak')).toBe(true)
  })
})

describe('context sentence sets', () => {
  const wordByKey = new Map(words.map((w) => [w.key, w]))
  // A paired verb that yields a genuine two-member context set: both sides are
  // annotated AND each side keeps at least one sentence whose English is unique
  // to it (identical English can't discriminate the aspect, so buildContextSet
  // drops such sentences from both — see its dedup-by-English logic).
  const enKey = (p) => String(p?.en ?? '').trim().toLowerCase()
  const paired = words.find((w) => {
    if (w.pos !== 'verb' || !w.aspectPair) return false
    const own = contextPhrases.get(w.key)
    const partner = contextPhrases.get(w.aspectPair.key)
    if (!own?.length || !partner?.length) return false
    const ownEn = new Set(own.map(enKey))
    const partnerEn = new Set(partner.map(enKey))
    return own.some((p) => !partnerEn.has(enKey(p))) && partner.some((p) => !ownEn.has(enKey(p)))
  })

  it('drills a single lexical item per set: one word, or its aspect pair', () => {
    const pool = contextKeys.slice(0, 8)
    const ex = build([practice('inflect-context', { exercises: 3, items: CONTEXT_SET_ITEMS, pool })])
    expect(ex.length).toBeGreaterThan(0)
    for (const set of ex) {
      expect(set.kind).toBe('phrase-fix')
      expect(set.items.length).toBeGreaterThan(0)
      expect(set.items.length).toBeLessThanOrEqual(CONTEXT_SET_ITEMS)
      // Distinct sentences, every one drilling the same word or its partner.
      expect(new Set(set.items.map((it) => it.ru)).size).toBe(set.items.length)
      const keys = [...new Set(set.items.map((it) => it.targets[0]))]
      expect(keys.length).toBeLessThanOrEqual(2)
      if (keys.length === 2) {
        expect(wordByKey.get(keys[0])?.aspectPair?.key).toBe(keys[1])
      }
      // The set's targets are the deduplicated union of its items' targets.
      expect(set.targets).toEqual(keys)
      for (const it of set.items) {
        expect(it.tokens.length).toBeGreaterThan(0)
        expect(it.answer).toBeTruthy()
      }
    }
  })

  it("bundles both members' sentences with per-member targets when the pair is in the batch", () => {
    const pool = [paired.key, paired.aspectPair.key]
    const ex = build([practice('inflect-context', { exercises: 1, items: CONTEXT_SET_ITEMS, pool })])
    expect(ex).toHaveLength(1)
    const keys = new Set(ex[0].items.map((it) => it.targets[0]))
    expect(keys).toEqual(new Set(pool))
    expect(new Set(ex[0].targets)).toEqual(new Set(pool))
  })

  it('reports partner sentences against the drawn word when the partner is outside the batch', () => {
    const pool = [paired.key]
    const ex = build([practice('inflect-context', { exercises: 1, items: CONTEXT_SET_ITEMS, pool })])
    expect(ex).toHaveLength(1)
    // The partner's sentences still appear (the pair is one lexical item)…
    expect(ex[0].items.length).toBeGreaterThanOrEqual(2)
    // …but a mastery attempt is only ever recorded for the batch word.
    for (const it of ex[0].items) expect(it.targets).toEqual([paired.key])
    expect(ex[0].targets).toEqual([paired.key])
  })

  it('never widens a mastery set beyond the pool', () => {
    const pool = contextKeys.slice(0, 2)
    const ex = build([practice('inflect-context', { exercises: 2, items: CONTEXT_SET_ITEMS, pool })])
    expect(ex.length).toBeGreaterThan(0)
    for (const set of ex) for (const it of set.items) expect(pool).toContain(it.targets[0])
  })
})

describe('verb contrast drill (usage mastery)', () => {
  const pairedVerbKeys = words
    .filter((w) => w.pos === 'verb' && w.aspectPair)
    .map((w) => w.key)

  it('emits the contrast drill instead of the table for paired verbs', () => {
    const pool = pairedVerbKeys.slice(0, 5)
    const ex = build([practice('inflect-keyboard', { exercises: 5, pool })])
    expect(ex.length).toBeGreaterThan(0)
    const drills = ex.filter((e) => e.kind === 'verb-contrast')
    expect(drills.length).toBeGreaterThan(0)
    for (const d of drills) {
      expect(d.dimension).toBe('usage')
      expect(d.contrast).toBe('aspect')
      expect(d.level).toBe('mastery')
      expect(pool).toContain(d.targets[0])
      expect(d.items.length).toBeGreaterThanOrEqual(CONTRAST_DRILL_MIN_ITEMS)
      expect(d.items.length).toBeLessThanOrEqual(CONTRAST_DRILL_ITEMS)
      expect(d.options.map((o) => o.id)).toEqual(['impf', 'pf'])
      // The spelling stage is ready to embed: no aspect step, answer resolved,
      // and its sentence is not leaked among the picks.
      expect(d.spell.selectSteps).toEqual([])
      expect(d.spell.answer).toBeTruthy()
      expect(d.items.map((i) => i.ru)).not.toContain(d.spell.ru)
    }
  })

  it('emits the drill on the motion contrast for a verb of motion', () => {
    // ходи́ть has no aspect partner — its pair is the determinate идти́, so the
    // pick stage is the directional one (#538).
    const pool = ['ходить=to walk']
    const ex = build([practice('inflect-keyboard', { exercises: 1, pool })])
    const [drill] = ex.filter((e) => e.kind === 'verb-contrast')
    expect(drill).toBeTruthy()
    expect(drill.contrast).toBe('motion')
    expect(drill.options.map((o) => o.id)).toEqual(['det', 'indet'])
    expect(drill.options.map((o) => o.label)).toEqual(['идти́', 'ходи́ть'])
    expect(new Set(drill.items.map((i) => i.answer))).toEqual(new Set(['det', 'indet']))
    expect(drill.contrastRule?.id).toBe('verb-motion-pair')
  })

  it('keeps the typed table for unpaired verbs and for inflect-bank', () => {
    const unpaired = words
      .filter((w) => w.pos === 'verb' && !w.aspectPair && !w.motionPair && buildParadigm(w))
      .map((w) => w.key)
    const ex = build([practice('inflect-keyboard', { exercises: 3, pool: unpaired.slice(0, 3) })])
    expect(ex.length).toBeGreaterThan(0)
    for (const e of ex) expect(e.kind).toBe('inflect')
    // The identification-mastery table (word bank) is untouched even for pairs.
    const bank = build([practice('inflect-bank', { exercises: 3, pool: pairedVerbKeys.slice(0, 3) })])
    expect(bank.length).toBeGreaterThan(0)
    for (const e of bank) expect(e.kind).toBe('inflect')
  })
})

describe('mid-lesson spacing', () => {
  it('spreads repeated draws across the pool instead of drilling one word', () => {
    // Three spell-word practices sharing a small pool: without session-wide
    // spacing the worst-understood word would be front-biased into every
    // practice. Tiered usage forces the draws to spread evenly instead.
    const pool = words.slice(0, 6).map((w) => w.key)
    const practices = [
      practice('spell-word', { exercises: 5, pool }),
      practice('spell-word', { exercises: 5, pool }),
      practice('spell-word', { exercises: 5, pool }),
    ]
    const ex = buildExercises({ practices }, { words, phrases, rng: seededRng(7) })
    const counts = {}
    for (const e of ex) counts[e.targets[0]] = (counts[e.targets[0]] ?? 0) + 1
    const vals = Object.values(counts)
    // 15 draws over 6 words → an even 3/3/3/2/2/2 spread (never the same word 5×).
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1)
    expect(Math.max(...vals)).toBeLessThanOrEqual(3)
  })

  it('spreads thin top-up fillers too, not just pool words', () => {
    // Empty pools → everything comes from the top-up. Two matching boards must
    // not both surface the same handful of low-CEFR words.
    const synth = (i) => ({ key: `w${i}=${i}`, ru: `w${i}`, english: [`${i}`], pos: 'noun', cefr: 'A1' })
    const synthWords = Array.from({ length: 14 }, (_, i) => synth(i))
    const ex = buildExercises(
      { practices: [practice('match-vocab'), practice('match-vocab')] },
      { words: synthWords, phrases: [], rng: seededRng(3) },
    )
    const counts = {}
    for (const e of ex) for (const t of e.targets) counts[t] = (counts[t] ?? 0) + 1
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2)
  })
})

describe('makeReplacementPicker', () => {
  const vocabById = new Map([
    ['a=a', { ru: 'А', en: ['a'], note: 'first' }],
    ['b=b', { ru: 'Б', en: ['b'] }],
  ])

  it('draws fresh priority words for replacements, not the skipped word', () => {
    const picker = makeReplacementPicker({
      wordKeys: ['a=a', 'b=b'],
      vocabById,
      exclude: new Set(['a=a']), // already covered this session
    })
    const skipped = { kind: 'speak', content: 'word', targets: ['z=z'], ru: 'Я', en: 'z', practiceIndex: 0 }
    const rep = makeVisualReplacement(skipped, 0, picker)
    expect(rep.targets).toEqual(['b=b']) // fresh priority, not skipped z=z
    expect(rep.ru).toBe('Б')
    expect(rep.dimension).toBe('identification')
  })

  it('cycles through priority words round-robin across a backfill', () => {
    const picker = makeReplacementPicker({ wordKeys: ['a=a', 'b=b'], vocabById })
    expect(picker.word().key).toBe('a=a')
    expect(picker.word().key).toBe('b=b')
    expect(picker.word().key).toBe('a=a') // wraps, never stuck on one word
  })

  it('falls back to the skipped content when the priority pool is empty', () => {
    const picker = makeReplacementPicker({ wordKeys: [], vocabById })
    const skipped = { kind: 'speak', content: 'word', targets: ['z=z'], ru: 'Я', en: 'z', practiceIndex: 0 }
    const rep = makeVisualReplacement(skipped, 0, picker)
    expect(rep.targets).toEqual(['z=z'])
  })
})

describe('makeVisualReplacement', () => {
  const phraseEx = {
    id: 'ex1',
    practiceIndex: 2,
    practiceType: 'repeat-phrase',
    dimension: 'speaking',
    level: 'learning',
    content: 'phrase',
    bucket: 'current',
    audio: false,
    kind: 'speak',
    targets: ['source-key'],
    ru: 'Привет мир',
    en: 'Hello world',
  }

  const wordEx = {
    id: 'ex2',
    practiceIndex: 1,
    practiceType: 'repeat-word',
    dimension: 'speaking',
    level: 'mastery',
    content: 'word',
    bucket: 'current',
    audio: false,
    kind: 'speak',
    targets: ['word-key'],
    ru: 'яблоко',
    en: 'apple',
    note: 'fruit',
  }

  it('returns a wordbank exercise for a phrase', () => {
    const rep = makeVisualReplacement(phraseEx, 0)
    expect(rep).not.toBeNull()
    expect(rep.kind).toBe('wordbank')
    expect(rep.practiceType).toBe('translate-phrase')
    expect(rep.content).toBe('phrase')
    expect(rep.ru).toBe('Привет мир')
    expect(rep.en).toBe('Hello world')
  })

  it('returns a type exercise for a word', () => {
    const rep = makeVisualReplacement(wordEx, 0)
    expect(rep).not.toBeNull()
    expect(rep.kind).toBe('type')
    expect(rep.practiceType).toBe('spell-word')
    expect(rep.content).toBe('word')
    expect(rep.ru).toBe('яблоко')
    expect(rep.en).toBe('apple')
    expect(rep.note).toBe('fruit')
  })

  it('always has audio: false', () => {
    expect(makeVisualReplacement(phraseEx, 0).audio).toBe(false)
    expect(makeVisualReplacement(wordEx, 1).audio).toBe(false)
  })

  it('preserves practiceIndex from the skipped exercise', () => {
    expect(makeVisualReplacement(phraseEx, 0).practiceIndex).toBe(2)
    expect(makeVisualReplacement(wordEx, 0).practiceIndex).toBe(1)
  })

  it('uses seq to generate a unique id', () => {
    expect(makeVisualReplacement(phraseEx, 0).id).toBe('vis0')
    expect(makeVisualReplacement(phraseEx, 7).id).toBe('vis7')
  })

  it('preserves targets from the skipped exercise', () => {
    expect(makeVisualReplacement(phraseEx, 0).targets).toEqual(['source-key'])
    expect(makeVisualReplacement(wordEx, 0).targets).toEqual(['word-key'])
  })

  it('expands a match exercise into individual type exercises', () => {
    const matchEx = {
      id: 'ex1',
      kind: 'match',
      practiceIndex: 1,
      dimension: 'hearing',
      level: 'learning',
      content: 'word',
      bucket: 'current',
      pairs: [
        { key: 'кот', ru: 'кот', en: 'cat' },
        { key: 'собака', ru: 'собака', en: 'dog' },
      ],
      targets: ['кот', 'собака'],
    }
    const reps = makeVisualReplacement(matchEx, 3)
    expect(Array.isArray(reps)).toBe(true)
    expect(reps).toHaveLength(2)
    expect(reps[0]).toMatchObject({ kind: 'type', ru: 'кот', en: 'cat', id: 'vis3_0', dimension: 'identification', audio: false })
    expect(reps[1]).toMatchObject({ kind: 'type', ru: 'собака', en: 'dog', id: 'vis3_1' })
    expect(reps[0].targets).toEqual(['кот'])
    expect(reps[1].targets).toEqual(['собака'])
    expect(reps.every((r) => r.practiceIndex === 1)).toBe(true)
    expect(reps.every((r) => r.level === 'learning')).toBe(true)
  })

  it('returns null when ru is missing', () => {
    expect(makeVisualReplacement({ en: 'hello' }, 0)).toBeNull()
  })

  it('returns null when en is missing', () => {
    expect(makeVisualReplacement({ ru: 'привет' }, 0)).toBeNull()
  })

  it('returns null for null input', () => {
    expect(makeVisualReplacement(null, 0)).toBeNull()
  })

  it('defaults content to phrase when not specified', () => {
    const rep = makeVisualReplacement({ ru: 'Привет мир', en: 'Hello world' }, 0)
    expect(rep.kind).toBe('wordbank')
  })
})

describe('CEFR-aware top-up', () => {
  const cefrByKey = new Map(words.map((w) => [w.key, w.cefr]))

  it('fills a thin pool with the lowest level only — no advanced words for a beginner', () => {
    // Empty pool → the whole vocabulary is the top-up source. A brand-new
    // learner (empty at-risk / untested buckets) must never be shown B1/B2/C1
    // words while A1 words remain to draw from.
    const ex = build([practice('match-vocab')])
    expect(ex).toHaveLength(1)
    const levels = ex[0].targets.map((k) => cefrByKey.get(k))
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.every((l) => l === 'A1')).toBe(true)
  })

  it('only spills into the next level once the lower level is exhausted', () => {
    const synth = (i, cefr) => ({ key: `w${i}=${i}`, ru: `w${i}`, english: `${i}`, pos: 'noun', cefr })
    const synthWords = [
      ...Array.from({ length: 3 }, (_, i) => synth(i, 'A1')),
      ...Array.from({ length: 20 }, (_, i) => synth(100 + i, 'B1')),
      ...Array.from({ length: 20 }, (_, i) => synth(200 + i, 'B2')),
    ]
    const cefrOf = new Map(synthWords.map((w) => [w.key, w.cefr]))

    const ex = buildExercises(
      { practices: [practice('match-vocab')] },
      { words: synthWords, phrases: [], rng: seededRng(1) },
    )
    const levels = ex[0].targets.map((k) => cefrOf.get(k))
    // All three A1 words are used, the rest come from B1, and B2 is never
    // touched while B1 can still fill the gap (one level up only, when exhausted).
    expect(levels.filter((l) => l === 'A1')).toHaveLength(3)
    expect(levels).toContain('B1')
    expect(levels).not.toContain('B2')
  })
})

describe('flashcards draw one combined pool (#472)', () => {
  const synth = (i) => ({ key: `w${i}=m${i}`, ru: `w${i}`, english: `m${i}`, pos: 'noun', cefr: 'A1' })

  it('a match board mixes current, at-risk and due words regardless of its bucket', () => {
    const synthWords = [synth(1), synth(2), synth(3), synth(4)]
    const session = {
      practices: [practice('match-vocab', { bucket: 'atRisk' })],
      pools: { current: ['w1=m1', 'w2=m2'], atRisk: ['w3=m3'], untested: ['w4=m4'] },
    }
    const ex = buildExercises(session, { words: synthWords, phrases: [], rng: seededRng(1) })
    expect(ex).toHaveLength(1)
    // The at-risk-bucket board still draws current-batch and due words — one pool.
    expect(ex[0].targets.slice().sort()).toEqual(['w1=m1', 'w2=m2', 'w3=m3', 'w4=m4'])
  })

  it('attaches the whole-dictionary autocomplete pool to every match board', () => {
    const synthWords = [synth(1), synth(2), synth(3)]
    const session = {
      practices: [practice('match-vocab')],
      pools: { current: ['w1=m1'], atRisk: [], untested: [] },
    }
    const ex = buildExercises(session, { words: synthWords, phrases: [], rng: seededRng(1) })
    expect(Array.isArray(ex[0].options)).toBe(true)
    expect(ex[0].options.length).toBe(3)
    expect(ex[0].options[0]).toHaveProperty('label')
    // Pairs carry a disambiguated label too, for grading a picked option.
    expect(ex[0].pairs[0]).toHaveProperty('label')
  })
})

describe('buildCombinedFlashcard (#472)', () => {
  const synth = (i) => ({ key: `w${i}=m${i}`, ru: `w${i}`, english: `m${i}`, pos: 'noun', cefr: 'A1' })
  const vocabById = new Map(
    shapeVocab(Array.from({ length: 20 }, (_, i) => synth(i))).map((v) => [v.id, v]),
  )

  it('includes every wrong word, then tops up to MATCH_PAIRS with the weakest correct', () => {
    const wrongKeys = ['w0=m0', 'w1=m1']
    const topUpKeys = Array.from({ length: 15 }, (_, i) => `w${i + 2}=m${i + 2}`)
    const ex = buildCombinedFlashcard({ wrongKeys, topUpKeys, vocabById, id: 'r1' })
    expect(ex.kind).toBe('match')
    expect(ex.targets.length).toBe(MATCH_PAIRS)
    // Wrong words are always present; top-up fills the rest in the given order.
    expect(ex.targets).toContain('w0=m0')
    expect(ex.targets).toContain('w1=m1')
    expect(ex.targets).toContain('w2=m2') // first top-up word
    expect(ex.repeat).toBe(true)
  })

  it('grows past MATCH_PAIRS when more than that were missed', () => {
    const wrongKeys = Array.from({ length: 15 }, (_, i) => `w${i}=m${i}`)
    const ex = buildCombinedFlashcard({ wrongKeys, topUpKeys: [], vocabById, id: 'r2' })
    expect(ex.targets.length).toBe(15)
  })

  it('de-duplicates and ignores unknown keys', () => {
    const ex = buildCombinedFlashcard({
      wrongKeys: ['w0=m0', 'w0=m0', 'nope=x'],
      topUpKeys: ['w0=m0', 'w1=m1'],
      vocabById,
      id: 'r3',
    })
    expect(ex.targets).toEqual(['w0=m0', 'w1=m1'])
  })

  it('returns null when fewer than two words resolve', () => {
    expect(buildCombinedFlashcard({ wrongKeys: ['w0=m0'], topUpKeys: [], vocabById })).toBe(null)
    expect(buildCombinedFlashcard({ wrongKeys: ['nope=x'], topUpKeys: [], vocabById })).toBe(null)
  })
})
