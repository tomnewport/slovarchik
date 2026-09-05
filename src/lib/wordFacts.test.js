import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'

import { buildWords, shapeVocab } from './vocabBuild.js'
import {
  wordFacts,
  factParts,
  relatedWords,
  confusionNote,
  factIssues,
  regionalVariant,
  FACT_KINDS,
  NUMERAL_LABEL,
} from './wordFacts.js'

// buildWords takes parsed docs; these tests author inline YAML, so parse first.
const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))
const byKeyOf = (words) => new Map(words.map((w) => [w.key, w]))
const find = (words, key) => words.find((w) => w.key === key)

const verbs = `
words:
  "водить=to lead":
    cefr_level: B1
    accented: води́ть
    aspect: impf
    en_gb: { standard: to lead }
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    aspect: impf
    en_gb: { standard: to ring (of a bell) }
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    aspect: impf
    en_gb: { standard: to call (on the telephone) }
    confusable_with:
      - key: "звенеть=to ring"
        why: "Nearly the same sound; звони́ть is to phone someone, звене́ть is a bell ringing."
  "переводить=to translate":
    cefr_level: B1
    accented: переводи́ть
    aspect: impf
    pair: "перевести=to translate"
    en_gb: { standard: to translate }
    facts:
      - kind: memory
        text: "A translator leads a sentence across a border."
      - kind: build
        text: "Literally to lead across."
        parts:
          - { ru: "пере-", en: "across, over, re-" }
          - { ru: "вод", en: "lead (root of водить)" }
          - { ru: "-и́ть", en: "verb ending" }
      - kind: root
        text: "Same root as водить (to lead)."
        see: ["водить=to lead"]
  "перевести=to translate":
    cefr_level: B1
    accented: перевести́
    aspect: pf
    pair: "переводить=to translate"
    en_gb: { standard: to translate }
`

describe('facts: normalisation', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])
  const translate = find(words, 'переводить=to translate')

  it('keeps every authored fact, with its parts and see keys', () => {
    expect(translate.facts).toHaveLength(3)
    const build = translate.facts.find((f) => f.kind === 'build')
    expect(build.parts.map((p) => p.ru)).toEqual(['пере-', 'вод', '-и́ть'])
    expect(build.parts[0].en).toBe('across, over, re-')
  })

  it('leaves a word that authors nothing with empty lists', () => {
    const lead = find(words, 'водить=to lead')
    expect(lead.facts).toEqual([])
    expect(lead.confusableWith).toEqual([])
    expect(lead.confusables).toEqual([])
  })

  it('drops a fact with an unknown kind or no text', () => {
    const [w] = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: etymology, text: "not a kind" }
      - { kind: note, text: "   " }
      - { kind: note, text: "A short, everyday word for «here»." }
`,
      },
    ])
    expect(w.facts.map((f) => f.text)).toEqual(['A short, everyday word for «here».'])
  })

  it('ignores parts on a kind that is not build', () => {
    const [w] = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - kind: note
        text: "A note."
        parts: [{ ru: "ту", en: "nope" }]
`,
      },
    ])
    expect(w.facts[0].parts).toEqual([])
  })
})

describe('facts: link resolution', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])
  const translate = find(words, 'переводить=to translate')

  it('resolves see: into a full link', () => {
    const root = translate.facts.find((f) => f.kind === 'root')
    expect(root.see).toEqual([
      { key: 'водить=to lead', ru: 'води́ть', en: 'to lead', note: '' },
    ])
  })

  it('drops a dangling or self-referential see key', () => {
    const [w] = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: root, text: "…", see: ["нет такого=nope", "тут=here"] }
`,
      },
    ])
    expect(w.facts[0].see).toEqual([])
  })
})

describe('confusable_with', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])

  it('resolves the authored link with its why', () => {
    const call = find(words, 'звонить=to call')
    expect(call.confusables).toEqual([
      {
        key: 'звенеть=to ring',
        ru: 'звене́ть',
        en: 'to ring',
        note: 'of a bell',
        why: 'Nearly the same sound; звони́ть is to phone someone, звене́ть is a bell ringing.',
      },
    ])
  })

  it('mirrors the link onto the other word, why and all', () => {
    const ring = find(words, 'звенеть=to ring')
    expect(ring.confusables.map((c) => c.key)).toEqual(['звонить=to call'])
    expect(ring.confusables[0].why).toContain('Nearly the same sound')
  })

  it('keeps the near side’s why when both ends author one', () => {
    const words2 = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb: { standard: to ring }
    confusable_with: [{ key: "звонить=to call", why: "from звенеть" }]
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    confusable_with: [{ key: "звенеть=to ring", why: "from звонить" }]
`,
      },
    ])
    expect(find(words2, 'звонить=to call').confusables[0].why).toBe('from звонить')
    expect(find(words2, 'звенеть=to ring').confusables[0].why).toBe('from звенеть')
  })

  it('drops a dangling key, a self-link and a duplicate', () => {
    const [w] = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    confusable_with:
      - { key: "нет такого=nope" }
      - { key: "тут=here" }
      - { key: "нет такого=nope" }
`,
      },
    ])
    expect(w.confusables).toEqual([])
  })
})

describe('wordFacts', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])

  it('orders facts build → root → origin → memory → note', () => {
    const ordered = wordFacts(find(words, 'переводить=to translate'))
    expect(ordered.map((f) => f.kind)).toEqual(['build', 'root', 'memory'])
  })

  it('is empty — never undefined — for a word with no facts', () => {
    expect(wordFacts(find(words, 'водить=to lead'))).toEqual([])
    expect(wordFacts(null)).toEqual([])
  })

  it('keeps authoring order within a kind', () => {
    const [w] = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: note, text: "first" }
      - { kind: build, text: "a build" }
      - { kind: note, text: "second" }
`,
      },
    ])
    expect(wordFacts(w).map((f) => f.text)).toEqual(['a build', 'first', 'second'])
  })

  it('exposes the closed kind set', () => {
    expect(FACT_KINDS).toEqual(['build', 'root', 'origin', 'region', 'memory', 'note'])
  })
})

describe('factParts', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])
  const build = wordFacts(find(words, 'переводить=to translate'))[0]

  it('joins the morphemes back into the word, hyphens dropped', () => {
    expect(factParts(build).joined).toBe('переводи́ть')
  })

  it('spells the breakdown out for a screen reader', () => {
    const { label } = factParts(build)
    expect(label).toContain('переводи́ть:')
    expect(label).toContain('пере- — across, over, re-')
  })

  it('is empty for a fact with no breakdown', () => {
    expect(factParts({ kind: 'note', text: 'x' })).toEqual({ parts: [], joined: '', label: '' })
    expect(factParts(null).parts).toEqual([])
  })
})

describe('relatedWords', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])
  const byKey = byKeyOf(words)

  it('merges derived and authored relations in one list', () => {
    const related = relatedWords(find(words, 'переводить=to translate'), byKey)
    expect(related.map((r) => [r.relation, r.key])).toEqual([
      ['aspect', 'перевести=to translate'],
      ['root', 'водить=to lead'],
    ])
  })

  it('carries the partner’s headword and gloss', () => {
    const [pair] = relatedWords(find(words, 'переводить=to translate'), byKey)
    expect(pair.ru).toBe('перевести́')
    expect(pair.en).toBe('to translate')
  })

  it('reports an authored confusable with its why', () => {
    const related = relatedWords(find(words, 'звонить=to call'), byKey)
    expect(related.map((r) => r.relation)).toEqual(['confusable'])
    expect(related[0].why).toContain('bell ringing')
  })

  it('prefers the stronger relation when a word is reachable twice', () => {
    // The aspect pair also shares the base gloss "to translate", so it is an
    // ambiguousEn sibling too — it must still be reported once, as `aspect`.
    const translate = find(words, 'переводить=to translate')
    expect(translate.ambiguousEn.map((a) => a.ru)).toContain('перевести́')
    const related = relatedWords(translate, byKey)
    expect(related.filter((r) => r.ru === 'перевести́')).toHaveLength(1)
    expect(related.find((r) => r.ru === 'перевести́').relation).toBe('aspect')
  })

  it('resolves a heteronym’s key from its spelling', () => {
    const stress = fromYaml([
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
    const related = relatedWords(find(stress, 'замок=castle'), byKeyOf(stress))
    expect(related).toEqual([
      {
        key: 'замок=lock',
        ru: 'замо́к',
        en: 'lock',
        note: '',
        why: '',
        relation: 'heteronym',
      },
    ])
  })

  it('works without a word map, leaving unkeyed relations unresolved', () => {
    const related = relatedWords(find(words, 'переводить=to translate'))
    expect(related.map((r) => r.relation)).toEqual(['aspect', 'root'])
  })

  it('reads a shapeVocab projection too, gloss list and all', () => {
    // The drills hold shaped words (`en` is the accepted-answer list, not a
    // single gloss), and #588 asks them the same question the panels do.
    const sew = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "шить=to sew":
    cefr_level: B1
    accented: шить
    aspect: impf
    en_gb: { standard: to sew }
  "сшить=to sew":
    cefr_level: B1
    accented: сшить
    aspect: pf
    en_gb: { standard: to sew }
`,
      },
    ])
    const shaped = shapeVocab(sew).find((v) => v.id === 'шить=to sew')
    expect(relatedWords(shaped)).toEqual([
      { key: null, ru: 'сшить', en: 'to sew', note: '', why: '', relation: 'same-meaning' },
    ])
  })

  it('is empty for a word with no relations at all', () => {
    expect(relatedWords(find(words, 'водить=to lead'), byKey)).toEqual([])
    expect(relatedWords(null)).toEqual([])
  })
})

describe('relatedWords: the adverb ← adjective pair (#628)', () => {
  const manner = fromYaml([
    {
      pos: 'adverb',
      text: `
words:
  "быстро=quickly":
    cefr_level: A1
    accented: бы́стро
    en_gb: { standard: quickly }
`,
    },
    {
      pos: 'adjective',
      text: `
words:
  "быстрый=fast":
    cefr_level: A1
    accented: бы́стрый
    en_gb: { standard: fast }
`,
    },
  ])
  const byKey = byKeyOf(manner)

  it('reports the pair from the adverb', () => {
    const related = relatedWords(find(manner, 'быстро=quickly'), byKey)
    expect(related.map((r) => [r.relation, r.ru])).toEqual([['manner', 'бы́стрый']])
  })

  it('reports it from the adjective too', () => {
    const related = relatedWords(find(manner, 'быстрый=fast'), byKey)
    expect(related.map((r) => [r.relation, r.ru])).toEqual([['manner', 'бы́стро']])
  })

  it('is a derived link, so authoring it as a confusable fails the guard', () => {
    // The shortlist used to offer пло́хо / плохо́й as a pair to keep apart. It
    // is one word in two parts of speech, and saying otherwise teaches a trap
    // that is not there.
    const authored = fromYaml([
      {
        pos: 'adverb',
        text: `
words:
  "плохо=badly":
    cefr_level: A1
    accented: пло́хо
    en_gb: { standard: badly }
    confusable_with: [{ key: "плохой=bad", why: They look alike. }]
`,
      },
      {
        pos: 'adjective',
        text: `
words:
  "плохой=bad":
    cefr_level: A1
    accented: плохо́й
    en_gb: { standard: bad }
`,
      },
    ])
    const issues = factIssues(authored)
    expect(issues.map((i) => i.message)).toContain(
      '"плохой=bad" is already linked automatically — don\'t author it',
    )
  })
})

describe('relatedWords: numeral families (#629)', () => {
  const nums = fromYaml([
    {
      pos: 'numeral',
      text: `
words:
  "девять=nine":
    cefr_level: A1
    type: cardinal
    value: 9
    accented: де́вять
    en_gb: { standard: nine }
  "девятый=ninth":
    cefr_level: A1
    type: ordinal
    value: 9
    accented: девя́тый
    en_gb: { standard: ninth }
  "девятнадцать=nineteen":
    cefr_level: A1
    type: cardinal
    value: 19
    accented: девятна́дцать
    en_gb: { standard: nineteen }
`,
    },
  ])
  const byKey = byKeyOf(nums)

  it('gives the unit its family, each row saying which way round it goes', () => {
    const rows = relatedWords(find(nums, 'девять=nine'), byKey)
    expect(rows.map((r) => [r.ru, r.via, r.role])).toEqual([
      ['девя́тый', 'ordinal', 'derived'],
      ['девятна́дцать', 'teen', 'derived'],
    ])
  })

  it('reads the other way from a member of the family', () => {
    const [row] = relatedWords(find(nums, 'девятнадцать=nineteen'), byKey)
    expect(row).toMatchObject({ relation: 'numeral', ru: 'де́вять', via: 'teen', role: 'base' })
  })

  it('has wording for every direction it can report', () => {
    // The panel, the intro card and the correction messages share one phrasing,
    // so a gap here is a row that renders as "the same family" and says nothing.
    for (const via of ['ordinal', 'teen', 'tens', 'hundreds']) {
      for (const role of ['base', 'derived']) {
        expect(NUMERAL_LABEL[`${via}:${role}`]).toBeTruthy()
      }
    }
  })
})

describe('confusionNote', () => {
  const words = fromYaml([{ pos: 'verb', text: verbs }])
  const byKey = byKeyOf(words)

  it('prefers the authored why', () => {
    const call = find(words, 'звонить=to call')
    const [ring] = relatedWords(call, byKey)
    expect(confusionNote(call, ring)).toEqual({
      text: 'Nearly the same sound; звони́ть is to phone someone, звене́ть is a bell ringing.',
      source: 'why',
    })
  })

  it('falls back to contrasting the two distinguishing notes', () => {
    // The pair that needs explaining most: near-identical spelling, glosses too
    // close to separate them. Neither word authors a `why` here — the notes the
    // corpus already carries do the work.
    const sound = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call (to phone someone) }
    confusable_with: [{ key: "звенеть=to ring" }]
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb: { standard: to ring (of a bell) }
`,
      },
    ])
    const call = find(sound, 'звонить=to call')
    const [ring] = relatedWords(call, byKeyOf(sound))
    expect(confusionNote(call, ring)).toEqual({
      text: 'звони́ть — to phone someone; звене́ть — of a bell',
      source: 'contrast',
    })
  })

  it('explains a derived relation too, which can carry no why at all', () => {
    const sew = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "шить=to sew":
    cefr_level: B1
    accented: шить
    aspect: impf
    pair: "сшить=to sew"
    en_gb: { standard: to sew }
  "сшить=to sew":
    cefr_level: B1
    accented: сшить
    aspect: pf
    pair: "шить=to sew"
    en_gb:
      standard: to sew (one garment run up start to finish)
`,
      },
    ])
    const impf = find(sew, 'шить=to sew')
    const [pf] = relatedWords(impf, byKeyOf(sew))
    expect(pf.relation).toBe('aspect')
    expect(confusionNote(impf, pf)).toEqual({
      text: 'сшить — one garment run up start to finish',
      source: 'note',
    })
  })

  it('says nothing when the corpus has nothing to say', () => {
    const lead = find(words, 'водить=to lead')
    expect(confusionNote(lead, { ru: 'вести́', en: 'to lead' })).toEqual({ text: '', source: '' })
    expect(confusionNote(null, null)).toEqual({ text: '', source: '' })
  })
})

describe('region facts (#636)', () => {
  // The corpus teaches the dictionary standard, so the variant is a gloss-only
  // stub: told about, never drilled.
  const bread = `
words:
  "булка=white loaf":
    cefr_level: A2
    learn: false
    accented: бу́лка
    en_gb: { standard: white loaf (elsewhere, a sweet bun) }
    facts:
      - kind: region
        where: St Petersburg
        text: "In St Petersburg a бу́лка is white bread; elsewhere it is a sweet bun."
        see: ["хлеб=bread"]
  "хлеб=bread":
    cefr_level: A1
    accented: хлеб
    en_gb: { standard: bread }
    facts:
      - kind: region
        where: St Petersburg
        text: "In St Petersburg хлеб leans rye and the white loaf is a бу́лка."
        see: ["булка=white loaf"]
`
  const words = fromYaml([{ pos: 'noun', text: bread }])
  const byKey = byKeyOf(words)
  const bread_ = find(words, 'хлеб=bread')

  it('keeps the place beside the prose', () => {
    expect(wordFacts(bread_)[0]).toMatchObject({ kind: 'region', where: 'St Petersburg' })
  })

  it('relates the two as region, not as a bare see-also', () => {
    expect(relatedWords(bread_, byKey)).toMatchObject([
      { key: 'булка=white loaf', relation: 'region', where: 'St Petersburg' },
    ])
  })

  it('names the place a variant belongs to, from the word being asked for', () => {
    expect(regionalVariant(bread_, 'булка=white loaf')).toBe('St Petersburg')
  })

  it('says nothing about an unrelated word, or about no word at all', () => {
    expect(regionalVariant(bread_, 'булочная=bakery')).toBe('')
    expect(regionalVariant(bread_, '')).toBe('')
  })

  it('leaves the variant out of the curriculum', () => {
    expect(shapeVocab(words).map((w) => w.id)).toEqual(['хлеб=bread'])
  })
})

describe('factIssues', () => {
  const issuesFor = (text, pos = 'adverb') => factIssues(fromYaml([{ pos, text }]))
  const messages = (issues) => issues.map((i) => i.message)

  it('passes a well-formed corpus', () => {
    expect(factIssues(fromYaml([{ pos: 'verb', text: verbs }]))).toEqual([])
  })

  it('flags an unknown kind and a missing text', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: etymology, text: "wrong kind" }
      - { kind: note }
`)
    expect(messages(issues)).toEqual([
      expect.stringContaining('kind "etymology" is not one of'),
      'text is required',
    ])
  })

  it('flags parts on a non-build fact and a part missing its gloss', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: note, text: "…", parts: [{ ru: "ту" }] }
`)
    expect(messages(issues)).toEqual([
      expect.stringContaining('parts is build-only'),
      'en is required',
    ])
  })

  it('flags a breakdown that does not spell out the headword', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - kind: build
        text: "…"
        parts: [{ ru: "пере-", en: "across" }, { ru: "вод", en: "lead" }]
`)
    expect(messages(issues)).toEqual([expect.stringContaining('does not spell out тут')])
  })

  it('asks for the stress to be marked when the parts join into the whole word', () => {
    const issues = issuesFor(
      `
words:
  "назад=back":
    cefr_level: A1
    accented: наза́д
    en_gb: { standard: back }
    facts:
      - kind: build
        text: "..."
        parts: [{ ru: "на-", en: "onto" }, { ru: "зад", en: "the rear" }]
`,
      'adverb',
    )
    expect(messages(issues)).toEqual([expect.stringContaining('the parts spell "назад"')])
  })

  it('is satisfied once the stressed part carries its mark', () => {
    const issues = issuesFor(
      `
words:
  "назад=back":
    cefr_level: A1
    accented: наза́д
    en_gb: { standard: back }
    facts:
      - kind: build
        text: "..."
        parts: [{ ru: "на-", en: "onto" }, { ru: "за́д", en: "the rear" }]
`,
      'adverb',
    )
    expect(issues).toEqual([])
  })

  it('allows a consonant alternation inside the headword', () => {
    // писа́ть → пишу́: the root surfaces as пиш-, so an exact join would fail
    // where a subsequence of the *headword’s* morphemes still holds.
    const issues = issuesFor(
      `
words:
  "писать=to write":
    cefr_level: A2
    accented: писа́ть
    en_gb: { standard: to write }
    facts:
      - kind: build
        text: "…"
        parts: [{ ru: "пис", en: "write" }, { ru: "-а́ть", en: "verb ending" }]
`,
      'verb',
    )
    expect(issues).toEqual([])
  })

  it('flags a dangling, self-referential or duplicated see key', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: root, text: "…", see: ["тут=here"] }
      - { kind: root, text: "…", see: ["нет такого=nope"] }
`)
    expect(messages(issues)).toEqual(['a word cannot see itself', '"нет такого=nope" is not a word'])
  })

  it('flags a region fact with no place, and a where on any other kind', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: region, text: "They say it differently up north." }
      - { kind: note, text: "…", where: "Moscow" }
`)
    expect(messages(issues)).toEqual([
      'a region fact needs a where (the place it is about)',
      'where is region-only, not "note"',
    ])
  })

  it('flags a regional pairing claimed from only one end', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: region, where: "the north", text: "Up north they say the other one.", see: ["здесь=here"] }
  "здесь=here":
    cefr_level: A1
    accented: здесь
    en_gb: { standard: here (in this place) }
`)
    expect(messages(issues)).toEqual(['"здесь=here" has no region fact linking back'])
  })

  it('accepts the pairing once the other end claims it too', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts:
      - { kind: region, where: "the north", text: "Up north they say the other one.", see: ["здесь=here"] }
  "здесь=here":
    cefr_level: A1
    accented: здесь
    en_gb: { standard: here (in this place) }
    facts:
      - { kind: region, where: "the north", text: "The northern word; тут is the one to give.", see: ["тут=here"] }
`)
    expect(issues).toEqual([])
  })

  it('flags a confusable that re-states a derivable link', () => {
    const issues = factIssues(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "переводить=to translate":
    cefr_level: B1
    accented: переводи́ть
    aspect: impf
    pair: "перевести=to translate"
    en_gb: { standard: to translate }
    confusable_with: [{ key: "перевести=to translate" }]
  "перевести=to translate":
    cefr_level: B1
    accented: перевести́
    aspect: pf
    pair: "переводить=to translate"
    en_gb: { standard: to translate }
`,
        },
      ]),
    )
    expect(messages(issues)).toEqual([
      expect.stringContaining('is already linked automatically'),
    ])
  })

  it('flags a confusable that re-states a heteronym link', () => {
    const issues = factIssues(
      fromYaml([
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
    confusable_with: [{ key: "замок=lock" }]
  "замок=lock":
    cefr_level: B1
    accented: замо́к
    gender: m
    animacy: i
    en_gb: { standard: lock }
`,
        },
      ]),
    )
    expect(messages(issues)).toEqual([
      expect.stringContaining('is already linked automatically'),
    ])
  })

  it('flags a confusable that re-states a same-gloss (ambiguousEn) link', () => {
    const issues = factIssues(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "шить=to sew":
    cefr_level: B1
    accented: шить
    aspect: impf
    en_gb: { standard: to sew }
    confusable_with: [{ key: "сшить=to sew" }]
  "сшить=to sew":
    cefr_level: B1
    accented: сшить
    aspect: pf
    en_gb: { standard: to sew }
`,
        },
      ]),
    )
    expect(messages(issues)).toEqual([
      expect.stringContaining('is already linked automatically'),
    ])
  })

  it('requires a why when nothing else tells the two words apart', () => {
    const issues = factIssues(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call }
    confusable_with: [{ key: "перезвонить=to call back" }]
  "перезвонить=to call back":
    cefr_level: B2
    accented: перезвони́ть
    en_gb: { standard: to call back }
`,
        },
      ]),
    )
    expect(messages(issues)).toEqual([
      expect.stringContaining('nothing tells "перезвонить=to call back" apart'),
    ])
  })

  it('accepts the same pair once either side carries a note', () => {
    const issues = factIssues(
      fromYaml([
        {
          pos: 'verb',
          text: `
words:
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb: { standard: to call (to phone someone) }
    confusable_with: [{ key: "звенеть=to ring" }]
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb: { standard: to ring (of a bell) }
`,
        },
      ]),
    )
    expect(issues).toEqual([])
  })

  it('flags a dangling, self-referential, duplicated or keyless confusable', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    confusable_with:
      - { why: "no key" }
      - { key: "тут=here" }
      - { key: "нет такого=nope" }
      - { key: "нет такого=nope" }
`)
    expect(messages(issues)).toEqual([
      'each entry needs a key',
      'a word cannot be confusable with itself',
      '"нет такого=nope" is not a word',
      '"нет такого=nope" is listed twice',
    ])
  })

  it('flags a field authored as something other than a list', () => {
    const issues = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts: "a string"
    confusable_with: "another string"
`)
    expect(messages(issues)).toEqual(['facts must be a list', 'confusable_with must be a list'])
  })

  it('flags a confusable link that only exists on one side', () => {
    // linkFacts mirrors every pair, so this can only come from a regression in
    // it — which is exactly what the guard is here to catch.
    const words = [
      { key: 'a=one', headword: 'a', facts: [], confusables: [{ key: 'b=two' }], extra: {} },
      { key: 'b=two', headword: 'b', facts: [], confusables: [], extra: {} },
    ]
    expect(factIssues(words)).toEqual([
      { key: 'a=one', field: 'confusables', message: '"b=two" does not link back' },
    ])
  })

  it('names the word and the field of every problem', () => {
    const [issue] = issuesFor(`
words:
  "тут=here":
    cefr_level: A1
    accented: тут
    en_gb: { standard: here }
    facts: [{ kind: note }]
`)
    expect(issue).toEqual({ key: 'тут=here', field: 'facts[0]', message: 'text is required' })
  })
})
