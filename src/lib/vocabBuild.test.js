import { describe, it, expect } from 'vitest'
import {
  parseKey,
  buildWords,
  shapeVocab,
  vocabDisplay,
  shapePhrases,
  shapeNouns,
  shapeContextPhrases,
  learnableWords,
  partsOfSpeech,
} from './vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'
import { factIssues } from './wordFacts.js'
import yaml from 'js-yaml'

// buildWords now takes parsed docs (the runtime feeds it build-generated JSON);
// these tests author inline YAML, so parse it here before handing it over.
const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

describe('parseKey', () => {
  it('splits a russian=english natural key', () => {
    expect(parseKey('ворота=gate')).toEqual({ ru: 'ворота', en: 'gate' })
  })
  it('only splits on the first "="', () => {
    expect(parseKey('a=b=c')).toEqual({ ru: 'a', en: 'b=c' })
  })
})

describe('buildWords (with a small inline file)', () => {
  const text = `
words:
  "ворота=gate":
    cefr_level: B2
    number: ["pl"]
    en_gb:
      standard: gate (a doorlike structure outside a house)
    declension:
      pl_nom: воро́та
      pl_gen: воро́т
      pl_dat: воро́там
      pl_acc: воро́та
      pl_ins: воро́тами
      pl_pre: воро́тах
`
  const [gate] = fromYaml([{ pos: 'noun', text }])

  it('nests flat declension keys and tracks present numbers', () => {
    expect(gate.numbers).toEqual(['pl'])
    expect(gate.forms.sg).toBeUndefined()
    expect(gate.forms.pl.gen).toBe('воро́т')
  })
  it('splits the meaning into a short gloss and a bracketed note', () => {
    expect(gate.meaning).toBe('gate')
    expect(gate.meaningNote).toContain('doorlike')
    expect(gate.english).toContain('gate')
  })
  it('leaves formNotes empty when the noun declares no declension_notes', () => {
    expect(gate.formNotes).toEqual({})
  })
})

describe('declension_notes (per-cell tooltips)', () => {
  const text = `
words:
  "год=year":
    cefr_level: A1
    gender: m
    animacy: i
    en_gb: { standard: year }
    declension:
      sg_nom: год
      sg_gen: го́да
      sg_dat: го́ду
      sg_acc: год
      sg_ins: го́дом
      sg_pre: го́де
      pl_nom: го́ды
      pl_gen: лет
      pl_dat: го́дам
      pl_acc: го́ды
      pl_ins: го́дами
      pl_pre: го́дах
    declension_notes:
      pl_gen: >-
        Suppletive genitive plural: Russian uses лет, not годо́в.
`
  const [god] = fromYaml([{ pos: 'noun', text }])

  it('stores the suppletive form and nests the note under the same cell', () => {
    expect(god.forms.pl.gen).toBe('лет')
    expect(god.formNotes.pl.gen).toMatch(/suppletive/i)
  })
  it('does not annotate cells that have no note', () => {
    expect(god.formNotes.sg).toBeUndefined()
    expect(god.formNotes.pl.nom).toBeUndefined()
  })
})

describe('learn: false (gloss-only entries)', () => {
  const text = `
words:
  "дом=house":
    cefr_level: A1
    gender: m
    animacy: i
    en_gb: { standard: house }
    usage:
      - { ru: Большо́й дом, en_gb: A big house. }
    declension:
      sg_nom: дом
      sg_gen: до́ма
      sg_dat: до́му
      sg_acc: дом
      sg_ins: до́мом
      sg_pre: до́ме
      pl_nom: дома́
      pl_gen: домо́в
      pl_dat: дома́м
      pl_acc: дома́
      pl_ins: дома́ми
      pl_pre: дома́х
  "полдень=noon":
    cefr_level: B1
    gender: m
    animacy: i
    learn: false
    en_gb: { standard: noon }
    usage:
      - { ru: До полу́дня, en_gb: Until noon. }
    declension:
      sg_nom: по́лдень
      sg_gen: полу́дня
      sg_dat: полу́дню
      sg_acc: по́лдень
      sg_ins: полу́днем
      sg_pre: полу́дне
`
  const words = fromYaml([{ pos: 'noun', text }])
  const noon = words.find((w) => w.key === 'полдень=noon')
  const house = words.find((w) => w.key === 'дом=house')

  it('flags the entry not-learnable but keeps it in the word list', () => {
    expect(noon.learnable).toBe(false)
    expect(house.learnable).toBe(true)
    expect(words).toHaveLength(2) // still present — buildFormIndex can hint it
  })

  it('learnableWords drops gloss-only entries', () => {
    expect(learnableWords(words).map((w) => w.key)).toEqual(['дом=house'])
  })

  it('excludes gloss-only entries from every drill', () => {
    expect(shapeVocab(words).map((v) => v.id)).toEqual(['дом=house'])
    expect(shapeNouns(words).map((n) => n.id)).toEqual(['дом=house'])
    // …and their usage examples never enter the phrase bank.
    const phraseRu = shapePhrases(words).map((p) => p.ru)
    expect(phraseRu).toContain('Большо́й дом')
    expect(phraseRu).not.toContain('До полу́дня')
  })
})

describe('verb government (`governs:`)', () => {
  const text = `
words:
  "звонить=to call":
    cefr_level: A1
    accented: звони́ть
    aspect: impf
    governs: dat
    en_gb: { standard: to call }
  "зависеть=to depend on":
    cefr_level: B1
    accented: зави́сеть
    aspect: impf
    governs: { prep: от, case: gen }
    en_gb: { standard: to depend on }
  "отвечать=to answer":
    cefr_level: A1
    accented: отвеча́ть
    aspect: impf
    governs: [dat, { prep: на, case: acc }]
    en_gb: { standard: to answer }
  "читать=to read":
    cefr_level: A1
    accented: чита́ть
    aspect: impf
    en_gb: { standard: to read }
`
  const byKey = new Map(fromYaml([{ pos: 'verb', text }]).map((w) => [w.key, w]))

  it('normalises every authored shape to a list of frames', () => {
    expect(byKey.get('звонить=to call').governs).toEqual([{ prep: null, case: 'dat' }])
    expect(byKey.get('зависеть=to depend on').governs).toEqual([{ prep: 'от', case: 'gen' }])
    expect(byKey.get('отвечать=to answer').governs).toEqual([
      { prep: null, case: 'dat' },
      { prep: 'на', case: 'acc' },
    ])
  })

  it('leaves an ordinary accusative verb ungoverned', () => {
    expect(byKey.get('читать=to read').governs).toBeNull()
  })

  it('carries the frames onto the shaped vocab word', () => {
    const shaped = shapeVocab([...byKey.values()])
    const zvonit = shaped.find((v) => v.id === 'звонить=to call')
    expect(zvonit.governs).toEqual([{ prep: null, case: 'dat' }])
    expect(shaped.find((v) => v.id === 'читать=to read').governs).toBeNull()
  })

  it('is verb-only — a preposition keeps its own `governs` in `extra`', () => {
    const prepText = `
words:
  "в=in":
    cefr_level: A1
    accented: в
    governs: ["acc", "pre"]
    en_gb: { standard: in }
`
    const [v] = fromYaml([{ pos: 'preposition', text: prepText }])
    expect(v.governs).toBeNull()
    expect(v.extra.governs).toEqual(['acc', 'pre'])
  })
})

describe('heteronyms', () => {
  it('auto-links same-spelling headwords that differ only in stress', () => {
    const text = `
words:
  "замок=lock":
    cefr_level: A2
    accented: замо́к
    en_gb:
      standard: lock
    declension:
      sg_nom: замо́к
  "замок=castle":
    cefr_level: A2
    accented: за́мок
    en_gb:
      standard: castle
    declension:
      sg_nom: за́мок
`
    const words = fromYaml([{ pos: 'noun', text }])
    const lock = words.find((w) => w.key === 'замок=lock')
    expect(lock.heteronyms).toEqual([
      { ru: 'замо́к', gloss: 'lock' },
      { ru: 'за́мок', gloss: 'castle' },
    ])
  })

  it('does not link headwords that share both spelling and stress', () => {
    const text = `
words:
  "коса=plait":
    cefr_level: B1
    accented: коса́
    en_gb:
      standard: plait
    declension:
      sg_nom: коса́
  "коса=scythe":
    cefr_level: B1
    accented: коса́
    en_gb:
      standard: scythe
    declension:
      sg_nom: коса́
`
    const words = fromYaml([{ pos: 'noun', text }])
    for (const w of words) expect(w.heteronyms).toEqual([])
  })

  it('falls back to an empty gloss rather than "undefined" when a meaning is missing', () => {
    const text = `
words:
  "замок=lock":
    cefr_level: A2
    accented: замо́к
    declension:
      sg_nom: замо́к
  "замок=castle":
    cefr_level: A2
    accented: за́мок
    declension:
      sg_nom: за́мок
`
    const words = fromYaml([{ pos: 'noun', text }])
    for (const w of words) {
      for (const h of w.heteronyms) expect(h.gloss).not.toContain('undefined')
    }
  })

  it('honours an explicit heteronyms annotation over auto-detection', () => {
    const text = `
words:
  "стоить=to cost":
    cefr_level: A2
    accented: сто́ить
    heteronyms:
      - ru: сто́ит
        gloss: it costs
      - ru: стои́т
        gloss: it stands
    en_gb:
      standard: to cost
`
    const [cost] = fromYaml([{ pos: 'verb', text }])
    expect(cost.heteronyms).toEqual([
      { ru: 'сто́ит', gloss: 'it costs' },
      { ru: 'стои́т', gloss: 'it stands' },
    ])
    expect(shapeVocab([cost])[0].heteronyms).toEqual(cost.heteronyms)
  })
})

describe('ambiguousEn', () => {
  const text = `
words:
  "дочка=daughter":
    cefr_level: A1
    en_gb:
      standard: daughter (an informal term)
  "дочь=daughter":
    cefr_level: A1
    en_gb:
      standard: daughter (a female child)
  "дом=house":
    cefr_level: A1
    en_gb:
      standard: house
`
  const words = fromYaml([{ pos: 'noun', text }])

  it('marks words that share a base English meaning', () => {
    const dochka = words.find((w) => w.key === 'дочка=daughter')
    const doch = words.find((w) => w.key === 'дочь=daughter')
    expect(dochka.ambiguousEn).toHaveLength(1)
    expect(dochka.ambiguousEn[0].ru).toBe('дочь')
    expect(doch.ambiguousEn).toHaveLength(1)
    expect(doch.ambiguousEn[0].ru).toBe('дочка')
  })

  it('leaves non-colliding words with an empty ambiguousEn', () => {
    const house = words.find((w) => w.key === 'дом=house')
    expect(house.ambiguousEn).toEqual([])
  })

  it('carries the sibling disambiguating note', () => {
    const dochka = words.find((w) => w.key === 'дочка=daughter')
    expect(dochka.ambiguousEn[0].note).toBe('a female child')
  })

  it('shapeVocab exposes ambiguousEn as an array on every word', () => {
    const shaped = shapeVocab(words)
    for (const w of shaped) expect(Array.isArray(w.ambiguousEn)).toBe(true)
    const dochka = shaped.find((w) => w.id === 'дочка=daughter')
    expect(dochka.ambiguousEn).toHaveLength(1)
  })

  it('does not include non-learnable words in collision groups', () => {
    const gloss = `
words:
  "шить=to sew":
    cefr_level: A2
    en_gb:
      standard: to sew
  "шить2=to sew":
    learn: false
    cefr_level: A2
    en_gb:
      standard: to sew
`
    const ws = fromYaml([{ pos: 'verb', text: gloss }])
    const sew = ws.find((w) => w.key === 'шить=to sew')
    expect(sew.ambiguousEn).toEqual([])
  })
})

describe('aspect pairs', () => {
  const text = `
words:
  "говорить=to speak":
    cefr_level: A1
    accented: говори́ть
    aspect: impf
    pair: "сказать=to say"
    en_gb:
      standard: to speak (to talk, produce speech)
  "сказать=to say":
    cefr_level: A1
    accented: сказа́ть
    aspect: pf
    pair: "говорить=to speak"
    en_gb:
      standard: to say (to utter words, on one occasion)
  "жить=to live":
    cefr_level: A1
    accented: жить
    aspect: impf
    en_gb:
      standard: to live
  "висеть=to hang":
    cefr_level: A2
    accented: висе́ть
    aspect: impf
    pair: "нет=такого"
    en_gb:
      standard: to hang
`
  const words = fromYaml([{ pos: 'verb', text }])
  const govorit = words.find((w) => w.key === 'говорить=to speak')
  const skazat = words.find((w) => w.key === 'сказать=to say')

  it('resolves reciprocal pair links with headword, aspect and gloss', () => {
    expect(govorit.aspect).toBe('impf')
    expect(govorit.aspectPair).toEqual({
      key: 'сказать=to say',
      ru: 'сказа́ть',
      motion: null,
      aspect: 'pf',
      gloss: 'to say',
    })
    expect(skazat.aspectPair).toMatchObject({ key: 'говорить=to speak', ru: 'говори́ть', aspect: 'impf' })
  })

  it('leaves unpaired verbs and dangling keys unlinked', () => {
    expect(words.find((w) => w.key === 'жить=to live').aspectPair).toBeNull()
    expect(words.find((w) => w.key === 'висеть=to hang').aspectPair).toBeNull()
  })

  it('shapeVocab exposes aspect and aspectPair', () => {
    const shaped = shapeVocab(words)
    const g = shaped.find((v) => v.id === 'говорить=to speak')
    expect(g.aspect).toBe('impf')
    expect(g.aspectPair).toMatchObject({ ru: 'сказа́ть', aspect: 'pf' })
    expect(shaped.find((v) => v.id === 'жить=to live').aspectPair).toBeNull()
  })
})

describe('motion pairs', () => {
  // Both members are imperfective, so the link cannot ride on `pair:` — it has
  // its own field and carries the det/indet side of each partner (#538).
  const text = `
words:
  "идти=to go":
    cefr_level: A1
    accented: идти́
    aspect: impf
    motion: det
    motion_pair: "ходить=to walk"
    pair: "пойти=to go"
    en_gb:
      standard: to go (on foot, in one direction)
  "ходить=to walk":
    cefr_level: A1
    accented: ходи́ть
    aspect: impf
    motion: indet
    motion_pair: "идти=to go"
    en_gb:
      standard: to walk (habitually)
  "пойти=to go":
    cefr_level: A1
    accented: пойти́
    aspect: pf
    pair: "идти=to go"
    en_gb:
      standard: to go (to set off)
`
  const words = fromYaml([{ pos: 'verb', text }])
  const idti = words.find((w) => w.key === 'идти=to go')
  const khodit = words.find((w) => w.key === 'ходить=to walk')

  it('resolves the reciprocal link with the partner’s direction', () => {
    expect(idti.motion).toBe('det')
    expect(idti.motionPair).toEqual({
      key: 'ходить=to walk',
      ru: 'ходи́ть',
      aspect: 'impf',
      motion: 'indet',
      gloss: 'to walk',
    })
    expect(khodit.motionPair).toMatchObject({ key: 'идти=to go', ru: 'идти́', motion: 'det' })
  })

  it('is independent of the aspect link — a verb can carry both', () => {
    expect(idti.aspectPair).toMatchObject({ key: 'пойти=to go', aspect: 'pf' })
    // …and the indeterminate member typically has no aspect partner at all.
    expect(khodit.aspectPair).toBeNull()
    expect(words.find((w) => w.key === 'пойти=to go').motionPair).toBeNull()
  })

  it('shapeVocab exposes motion and motionPair', () => {
    const shaped = shapeVocab(words)
    const k = shaped.find((v) => v.id === 'ходить=to walk')
    expect(k.motion).toBe('indet')
    expect(k.motionPair).toMatchObject({ ru: 'идти́', motion: 'det' })
    expect(shaped.find((v) => v.id === 'пойти=to go').motionPair).toBeNull()
  })
})

describe('the adverb ← adjective pair (#628)', () => {
  const adverb = (key, accented, level = 'A1') => `
  "${key}":
    cefr_level: ${level}
    accented: ${accented}
    en_gb: { standard: ${key.split('=')[1]} }`
  const adjective = (key, accented, level = 'A1') => `
  "${key}":
    cefr_level: ${level}
    accented: ${accented}
    en_gb: { standard: ${key.split('=')[1]} }`

  const words = fromYaml([
    {
      pos: 'adverb',
      text: `words:${adverb('быстро=quickly', 'бы́стро')}${adverb('легко=easily', 'легко́')}${adverb('можно=possible', 'мо́жно')}${adverb('плохо=badly', 'пло́хо')}`,
    },
    {
      pos: 'adjective',
      text: `words:${adjective('быстрый=fast', 'бы́стрый')}${adjective('лёгкий=light', 'лёгкий')}${adjective('плохой=bad', 'плохо́й')}`,
    },
  ])
  const at = (key) => words.find((w) => w.key === key)

  it('links the adverb to the adjective it is made from', () => {
    expect(at('быстро=quickly').mannerPair).toMatchObject({
      key: 'быстрый=fast',
      ru: 'бы́стрый',
      gloss: 'fast',
    })
  })

  it('links back, so the adjective offers the adverb too', () => {
    expect(at('быстрый=fast').mannerPair).toMatchObject({ key: 'быстро=quickly', ru: 'бы́стро' })
  })

  it('sees through a stress that moves, and through ё', () => {
    // пло́хо / плохо́й differ in where the stress sits; легко́ / лёгкий in the
    // vowel itself. Both are the same word, and neither matches on the letters
    // as written.
    expect(at('плохо=badly').mannerPair?.key).toBe('плохой=bad')
    expect(at('легко=easily').mannerPair?.key).toBe('лёгкий=light')
  })

  it('leaves a predicative with no adjective behind it alone', () => {
    // мо́жно ends in -о like the rest and is not made from anything. A link
    // here would teach a relationship that does not exist (#614).
    expect(at('можно=possible').mannerPair).toBeNull()
  })

  it('will not link a gloss-only entry', () => {
    // glossary.yml keys are surface forms, not lemmas — a link into one points
    // the learner at something that is not a headword.
    const stubbed = fromYaml([
      { pos: 'adverb', text: `words:${adverb('тихо=quietly', 'ти́хо')}` },
      {
        pos: 'adjective',
        text: `
words:
  "тихий=quiet":
    cefr_level: A1
    learn: false
    accented: ти́хий
    en_gb: { standard: quiet }
`,
      },
    ])
    expect(stubbed.find((w) => w.key === 'тихо=quietly').mannerPair).toBeNull()
  })

  it('shapeVocab carries the pair through to the drills', () => {
    const shaped = shapeVocab(words)
    expect(shaped.find((v) => v.id === 'быстро=quickly').mannerPair).toMatchObject({
      ru: 'бы́стрый',
    })
    expect(shaped.find((v) => v.id === 'можно=possible').mannerPair).toBeNull()
  })

  it('links both ends of every pair it finds across the real corpus', () => {
    const corpus = loadFixtureWords()
    const byKey = new Map(corpus.map((w) => [w.key, w]))
    const linked = corpus.filter((w) => w.mannerPair)
    expect(linked.length).toBeGreaterThan(100)
    for (const w of linked) {
      const other = byKey.get(w.mannerPair.key)
      expect(other?.mannerPair?.key).toBe(w.key)
      expect(new Set([w.pos, other.pos])).toEqual(new Set(['adverb', 'adjective']))
    }
  })
})

describe('numeral families (#629)', () => {
  const num = (key, accented, type, value, level = 'A1') => `
  "${key}":
    cefr_level: ${level}
    type: ${type}
    value: ${value}
    accented: ${accented}
    en_gb: { standard: ${key.split('=')[1]} }`

  const words = fromYaml([
    {
      pos: 'numeral',
      text: `words:${num('девять=nine', 'де́вять', 'cardinal', 9)}${num('девятый=ninth', 'девя́тый', 'ordinal', 9)}${num('девятнадцать=nineteen', 'девятна́дцать', 'cardinal', 19)}${num('девяносто=ninety', 'девяно́сто', 'cardinal', 90)}${num('четыре=four', 'четы́ре', 'cardinal', 4)}${num('сорок=forty', 'со́рок', 'cardinal', 40)}${num('двое=two together', 'дво́е', 'collective', 2)}`,
    },
  ])
  const at = (key) => words.find((w) => w.key === key)
  const kin = (key) => at(key).numeralKin.map((k) => `${k.ru}:${k.via}:${k.role}`)

  it('gives a unit its whole family', () => {
    expect(kin('девять=nine')).toEqual([
      'девя́тый:ordinal:derived',
      'девятна́дцать:teen:derived',
      'девяно́сто:tens:derived',
    ])
  })

  it('links each member back to the unit it is built on', () => {
    expect(kin('девятый=ninth')).toEqual(['де́вять:ordinal:base'])
    expect(kin('девятнадцать=nineteen')).toEqual(['де́вять:teen:base'])
    expect(kin('девяносто=ninety')).toEqual(['де́вять:tens:base'])
  })

  it('leaves со́рок out: it is not four of anything', () => {
    // The one place the pattern lies. со́рок is a word of its own, and the
    // resemblance is what makes the false link tempting.
    expect(at('сорок=forty').numeralKin).toEqual([])
    expect(kin('четыре=four')).toEqual([])
  })

  it('ignores numerals that are not cardinals or ordinals', () => {
    expect(at('двое=two together').numeralKin).toEqual([])
  })

  it('matches on value, not on letters', () => {
    // пе́рвый is not built out of оди́н — but it is the ordinal of one, which is
    // the true and useful thing to say.
    const suppletive = fromYaml([
      {
        pos: 'numeral',
        text: `words:${num('один=one', 'оди́н', 'cardinal', 1)}${num('первый=first', 'пе́рвый', 'ordinal', 1)}`,
      },
    ])
    expect(suppletive.find((w) => w.key === 'первый=first').numeralKin).toMatchObject([
      { key: 'один=one', via: 'ordinal', role: 'base' },
    ])
  })

  it('shapeVocab carries the family through to the drills', () => {
    expect(shapeVocab(words).find((v) => v.id === 'девятый=ninth').numeralKin).toHaveLength(1)
  })

  it('every link across the real corpus is reciprocal and true', () => {
    const corpus = loadFixtureWords()
    const byKey = new Map(corpus.map((w) => [w.key, w]))
    const linked = corpus.filter((w) => w.numeralKin.length)
    expect(linked.length).toBeGreaterThan(30)
    for (const w of linked) {
      for (const k of w.numeralKin) {
        const other = byKey.get(k.key)
        expect(other?.numeralKin.some((b) => b.key === w.key && b.via === k.via)).toBe(true)
        // The claim each relation makes, checked against the values themselves.
        const mine = w.extra.value
        const theirs = other.extra.value
        const [base, derived] = k.role === 'base' ? [theirs, mine] : [mine, theirs]
        if (k.via === 'ordinal') expect(derived).toBe(base)
        if (k.via === 'teen') expect(derived).toBe(base + 10)
        if (k.via === 'tens') expect(derived).toBe(base * 10)
        if (k.via === 'hundreds') expect(derived).toBe(base * 100)
      }
    }
    expect(byKey.get('сорок=forty').numeralKin).toEqual([])
  })
})

describe('the bundled vocabulary fixtures', () => {
  const words = loadFixtureWords()

  it('loads words for every part of speech', () => {
    for (const pos of partsOfSpeech) {
      const count = words.filter((w) => w.pos === pos).length
      expect(count, `expected words for ${pos}`).toBeGreaterThanOrEqual(9)
    }
  })

  it('has unique natural keys', () => {
    const keys = words.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is sorted alphabetically by Russian (ignoring stress)', () => {
    const ru = words.map((w) => w.ru)
    expect(ru).toEqual([...ru].sort((a, b) => a.localeCompare(b, 'ru')))
  })

  it('gives every word a CEFR level, meaning and accepted answers', () => {
    for (const w of words) {
      expect(w.cefr, w.key).toMatch(/^[ABC][12]$/)
      expect(w.meaning.length, w.key).toBeGreaterThan(0)
      expect(w.english.length, w.key).toBeGreaterThan(0)
    }
  })

  it('shapeVocab exposes display + accepted-answer fields', () => {
    const shaped = shapeVocab(words)
    expect(shaped[0]).toHaveProperty('ru')
    expect(Array.isArray(shaped[0].en)).toBe(true)
  })

  it('shapePhrases flattens usage examples into translatable phrases', () => {
    const ph = shapePhrases(words)
    expect(ph.length).toBeGreaterThan(0)
    for (const p of ph) {
      expect(p.ru.length, p.id).toBeGreaterThan(0)
      expect(p.en.length, p.id).toBeGreaterThan(0)
    }
    // Phrases are deduplicated by their russian=english pair.
    expect(new Set(ph.map((p) => p.id)).size).toBe(ph.length)
    // Every phrase carries an (possibly empty) list of alternate renderings.
    for (const p of ph) expect(Array.isArray(p.enAlt)).toBe(true)
  })

  it('shapePhrases carries en_alt as extra accepted renderings', () => {
    const text = `
words:
  "город=city":
    cefr_level: A1
    accented: го́род
    en_gb: { standard: city (a large town) }
    usage:
      - ru: Э́то большо́й го́род.
        en_gb: This is a big city.
        en_alt:
          - This city is big.
          - ""
`
    const ph = shapePhrases(fromYaml([{ pos: 'noun', text }]))
    expect(ph).toHaveLength(1)
    // Blank entries are dropped; real alternates are kept.
    expect(ph[0].enAlt).toEqual(['This city is big.'])
  })
})

describe('the bundled vocabulary has no case-only duplicate keys', () => {
  // Guards against the class of duplicate fixed in #365: the same proper noun
  // stored twice under a lowercase and a capitalised key (Москва/москва), each
  // with its own independent learning progress. Grading lowercases anyway, so
  // two keys differing only by letter case are always the same word.
  it('no two learnable keys differ only by letter case', () => {
    const byLower = new Map()
    for (const w of learnableWords(loadFixtureWords())) {
      const lower = w.key.toLowerCase()
      if (!byLower.has(lower)) byLower.set(lower, new Set())
      byLower.get(lower).add(w.key)
    }
    const collisions = [...byLower.values()]
      .filter((keys) => keys.size > 1)
      .map((keys) => [...keys].join(' / '))
    expect(collisions).toEqual([])
  })
})

describe('display_number (usually-plural nouns)', () => {
  const build = (extra) =>
    fromYaml([
      {
        pos: 'noun',
        text: `
words:
  "перчатка=glove":
    cefr_level: B1
    gender: f
    animacy: i
    number: ["sg", "pl"]
    ${extra}
    en_gb:
      standard: glove (a covering for the hand)
    declension:
      sg_nom: перча́тка
      sg_gen: перча́тки
      sg_dat: перча́тке
      sg_acc: перча́тку
      sg_ins: перча́ткой
      sg_pre: перча́тке
      pl_nom: перча́тки
      pl_gen: перча́ток
      pl_dat: перча́ткам
      pl_acc: перча́тки
      pl_ins: перча́тками
      pl_pre: перча́тках
`,
      },
    ])

  it('defaults to singular and captures the plural surface form/gloss', () => {
    const [w] = build('en_pl: gloves')
    expect(w.displayNumber).toBe('sg')
    expect(w.displayRuPl).toBe('перча́тки')
    expect(w.displayEnPl).toEqual(['gloves'])
  })

  it('normalises an en_pl list, dropping any parenthetical note', () => {
    const [w] = build('en_pl: [gloves, mittens (fingerless)]')
    expect(w.displayEnPl).toEqual(['gloves', 'mittens'])
  })

  it('shapeVocab carries the display preference through', () => {
    const [v] = shapeVocab(build('display_number: pl\n    en_pl: gloves'))
    expect(v.displayNumber).toBe('pl')
    expect(v.ruPl).toBe('перча́тки')
    expect(v.enPl).toEqual(['gloves'])
    // The shaped singular fields stay the dictionary headword/gloss.
    expect(v.ru).toBe('перча́тка')
    expect(v.en).toContain('glove')
  })

  it('vocabDisplay shows the plural form and gloss when display_number is pl', () => {
    const [v] = shapeVocab(build('display_number: pl\n    en_pl: gloves'))
    expect(vocabDisplay(v)).toEqual({ ru: 'перча́тки', en: ['gloves'], number: 'pl' })
  })

  it('vocabDisplay shows the singular by default', () => {
    const [v] = shapeVocab(build('en_pl: gloves'))
    const d = vocabDisplay(v)
    expect(d.number).toBe('sg')
    expect(d.ru).toBe('перча́тка')
  })

  it('mixed flips between singular and plural on the injected rng', () => {
    const [v] = shapeVocab(build('display_number: mixed\n    en_pl: gloves'))
    expect(vocabDisplay(v, () => 0.1).number).toBe('pl') // < 0.5 → plural
    expect(vocabDisplay(v, () => 0.9).number).toBe('sg') // ≥ 0.5 → singular
  })

  it('falls back to the singular when the plural data is missing', () => {
    // Marked plural but no en_pl authored: never render a blank plural prompt.
    const [v] = shapeVocab(build('display_number: pl'))
    expect(vocabDisplay(v).number).toBe('sg')
  })
})

describe('non-finite verb forms and the participle back-link (#564)', () => {
  const doc = (pos, text) => ({ pos, doc: yaml.load(text) })
  const words = buildWords([
    doc(
      'verb',
      `
words:
  "закрыть=to close":
    accented: закры́ть
    aspect: pf
    en_gb: { standard: to close }
    participles:
      pass_past: закры́тый
      pass_short: { m: закры́т, f: закры́та, n: закры́то, pl: закры́ты }
    gerund: закры́в
    usage:
      - ru: Магази́н закры́т до утра́.
        en_gb: The shop is closed until morning.
        inflect: { token: 2, form: pass_short, gender: m, rule: verb-participle-short }
`,
    ),
    doc(
      'adjective',
      `
words:
  "закрытый=closed":
    accented: закры́тый
    en_gb: { standard: closed }
    from_verb: { key: "закрыть=to close", form: pass_past }
    forms: { m: закры́тый, f: закры́тая, n: закры́тое, pl: закры́тые }
`,
    ),
  ])
  const byKey = new Map(words.map((w) => [w.key, w]))

  it('promotes participles and the gerund onto the record', () => {
    const verb = byKey.get('закрыть=to close')
    expect(verb.participles.pass_past).toBe('закры́тый')
    expect(verb.participles.pass_short.f).toBe('закры́та')
    expect(verb.gerund).toBe('закры́в')
  })

  it('leaves both null for a verb that carries neither', () => {
    const bare = buildWords([doc('verb', 'words:\n  "ждать=to wait": { accented: ждать }')])[0]
    expect(bare.participles).toBeNull()
    expect(bare.gerund).toBeNull()
  })

  it('resolves a lexicalised participle back to its verb', () => {
    expect(byKey.get('закрытый=closed').participleOf).toEqual({
      key: 'закрыть=to close',
      ru: 'закры́ть',
      aspect: 'pf',
      gloss: 'to close',
      form: 'pass_past',
    })
  })

  it('leaves the link null when the verb is absent', () => {
    const orphan = buildWords([
      doc(
        'adjective',
        'words:\n  "бывший=former":\n    accented: бы́вший\n    from_verb: { key: "быть=to be", form: act_past }',
      ),
    ])[0]
    expect(orphan.participleOf).toBeNull()
  })

  it('carries `form:` through to the context phrase target', () => {
    const [phrase] = shapeContextPhrases(words).filter((p) => p.target.form)
    expect(phrase.target).toMatchObject({
      key: 'закрыть=to close',
      form: 'pass_short',
      gender: 'm',
      rule: 'verb-participle-short',
    })
  })

  it('surfaces the link on the shaped vocab word', () => {
    const shaped = shapeVocab(words).find((v) => v.id === 'закрытый=closed')
    expect(shaped.participleOf.key).toBe('закрыть=to close')
  })
})

// ── `facts:` / `confusable_with:` — the corpus guard (#585) ─────────────────
// The logic lives in wordFacts.factIssues (tested there against inline data);
// here it is pointed at the real files. Both fields are optional, so an empty
// corpus passes — this fails only once an authoring slip exists on disk.
describe('the bundled vocabulary’s word facts', () => {
  const words = loadFixtureWords()

  it('authors no malformed, dangling or already-derived fact link', () => {
    const issues = factIssues(words)
    const report = issues.map((i) => `${i.key} ${i.field}: ${i.message}`).join('\n')
    expect(issues, `\n${report}`).toEqual([])
  })

  it('gives every word the two fields, empty where nothing is authored', () => {
    for (const w of words) {
      expect(Array.isArray(w.facts), `${w.key}: facts`).toBe(true)
      expect(Array.isArray(w.confusables), `${w.key}: confusables`).toBe(true)
    }
  })

  it('links every confusable pair from both ends', () => {
    const byKey = new Map(words.map((w) => [w.key, w]))
    for (const w of words) {
      for (const c of w.confusables) {
        const other = byKey.get(c.key)
        expect(other, `${w.key}: confusable "${c.key}" does not exist`).toBeTruthy()
        expect(
          other.confusables.map((b) => b.key),
          `${c.key} does not link back to ${w.key}`,
        ).toContain(w.key)
      }
    }
  })
})
