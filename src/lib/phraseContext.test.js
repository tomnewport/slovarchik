import { describe, it, expect } from 'vitest'
import {
  indexPhrases,
  buildSelectSteps,
  buildFromPhrase,
  buildContextExercise,
  buildContextSet,
  canBuildContext,
  buildAspectDrill,
  canBuildAspectDrill,
  ASPECT_DRILL_ITEMS,
} from './phraseContext.js'

const sobaka = { key: 'собака=dog', pos: 'noun', headword: 'соба́ка', ru: 'собака' }
const dumat = { key: 'думать=to think', pos: 'verb', headword: 'ду́мать', ru: 'думать' }
const dumatFuture = {
  id: 'budu-dumat',
  ru: 'Я бу́ду ду́мать об э́том.',
  en: 'I will think about it.',
  target: { key: 'думать=to think', token: 2, tense: 'future', person: '1sg', rule: 'verb-future' },
}

// A verb linked to its aspect partner (as built by vocabBuild.linkAspectPairs)
// gets a choose-the-aspect step before spelling.
const skazat = {
  key: 'сказать=to say', pos: 'verb', headword: 'сказа́ть', ru: 'сказать', aspect: 'pf',
  aspectPair: { key: 'говорить=to speak', ru: 'говори́ть', aspect: 'impf', gloss: 'to speak' },
}
const skazatPhrase = {
  id: 'on-skazal', ru: 'Он сказа́л пра́вду.', en: 'He said the truth.',
  target: { key: 'сказать=to say', token: 2, tense: 'past', person: 'past_m', rule: 'verb-past' },
}
const impPhrase = {
  id: 'skazhite', ru: 'Скажи́те, пожа́луйста, где вокза́л?', en: 'Tell me please, where is the station?',
  target: { key: 'сказать=to say', token: 1, tense: 'imperative', person: 'imp_pl', rule: 'verb-imperative' },
}
// adjective with a full declension grid (a few cells suffice for decoys)
const noviy = {
  key: 'новый=new', pos: 'adjective', headword: 'но́вый', ru: 'новый',
  extra: { declension: {
    m_nom: 'но́вый', m_gen: 'но́вого', f_nom: 'но́вая', f_acc: 'но́вую', f_gen: 'но́вой',
    n_nom: 'но́вое', pl_nom: 'но́вые', pl_gen: 'но́вых', pl_ins: 'но́выми',
  } },
}
const adjPhrase = {
  id: 'novuyu-knigu', ru: 'Я чита́ю но́вую кни́гу.', en: 'I am reading a new book.',
  target: { key: 'новый=new', token: 3, case: 'acc', number: 'sg', gender: 'f', rule: 'adj-agreement' },
}

// personal pronoun (flat by case, no gender) and a possessive (declines by
// gender·case like an adjective)
const ya = { key: 'я=I', pos: 'pronoun', headword: 'я', ru: 'я' }
const moy = {
  key: 'мой=my', pos: 'pronoun', headword: 'мой', ru: 'мой',
  extra: { declension: { m_nom: 'мой', f_nom: 'моя́', f_acc: 'мою́', n_nom: 'моё', pl_nom: 'мои́' } },
}
const yaPhrase = {
  id: 'zhdet-menya', ru: 'Он ждёт меня́ у вхо́да.', en: 'He is waiting for me at the entrance.',
  target: { key: 'я=I', token: 3, case: 'acc', number: 'sg', rule: 'pronoun-personal' },
}
const moyPhrase = {
  id: 'moya-sestra', ru: 'Моя́ сестра́ живёт в Пари́же.', en: 'My sister lives in Paris.',
  target: { key: 'мой=my', token: 1, case: 'nom', number: 'sg', gender: 'f', rule: 'pronoun-possessive' },
}

const accPhrase = {
  id: 'vizhu-sobaku',
  ru: 'Я ви́жу соба́ку.',
  en: 'I see the dog.',
  subject: 'animals',
  target: { key: 'собака=dog', token: 3, case: 'acc', number: 'sg', rule: 'noun-acc-fem-a' },
}
const verbPhrase = {
  id: 'ya-dumayu',
  ru: 'Я ду́маю о тебе́.',
  en: 'I am thinking about you.',
  target: { key: 'думать=to think', token: 2, tense: 'present', person: '1sg' },
}

const rules = {
  'noun-acc-fem-a': { title: 'Accusative singular feminine -а', formula: '-а → -у' },
}

describe('indexPhrases', () => {
  it('groups phrases by target key', () => {
    const byKey = indexPhrases([accPhrase, verbPhrase])
    expect(byKey.get('собака=dog')).toHaveLength(1)
    expect(byKey.get('думать=to think')).toHaveLength(1)
    expect(byKey.get('missing')).toBeUndefined()
  })
})

describe('buildSelectSteps', () => {
  it('returns case then number for a noun (one correct option each)', () => {
    const steps = buildSelectSteps(accPhrase.target, sobaka)
    expect(steps.map((s) => s.kind)).toEqual(['case', 'number'])
    const [caseStep, numberStep] = steps
    expect(caseStep.options).toHaveLength(6)
    expect(caseStep.options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'acc' })])
    expect(numberStep.options.map((o) => o.id)).toEqual(['sg', 'pl'])
    expect(numberStep.options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'sg' })])
  })
  it('offers Locative as a seventh case option only for nouns that have one', () => {
    const les = { key: 'лес=forest', pos: 'noun', headword: 'лес', forms: { sg: { nom: 'лес', loc: 'лесу́' } } }
    const locTarget = { case: 'loc', number: 'sg', token: 2 }
    const [caseStep] = buildSelectSteps(locTarget, les)
    expect(caseStep.options.map((o) => o.id)).toEqual(['nom', 'gen', 'dat', 'acc', 'ins', 'pre', 'loc'])
    expect(caseStep.options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'loc' })])
    // A noun without a locative form still gets the plain six-case step.
    expect(buildSelectSteps(accPhrase.target, sobaka)[0].options).toHaveLength(6)
  })
  it('returns no selection steps for a verb without an aspect partner', () => {
    expect(buildSelectSteps(verbPhrase.target, dumat)).toEqual([])
  })
  it('returns a choose-the-aspect step for a verb with an aspect partner', () => {
    const steps = buildSelectSteps(skazatPhrase.target, skazat)
    expect(steps.map((s) => s.kind)).toEqual(['aspect'])
    const [aspect] = steps
    // Both infinitives offered, imperfective first; the phrase's owner wins.
    expect(aspect.options.map((o) => o.label)).toEqual(['говори́ть', 'сказа́ть'])
    expect(aspect.options.map((o) => o.id)).toEqual(['impf', 'pf'])
    expect(aspect.options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ label: 'сказа́ть' }),
    ])
    for (const o of aspect.options) expect(o.hint).toMatch(/imperfective|perfective/)
  })
  it('returns case then gender + number for an adjective', () => {
    const steps = buildSelectSteps(adjPhrase.target, noviy)
    expect(steps.map((s) => s.kind)).toEqual(['case', 'gender'])
    const genderStep = steps[1]
    expect(genderStep.options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'f', label: 'Feminine' }),
    ])
    // only genders the word actually declines for are offered, each once
    const ids = genderStep.options.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('f')
  })
  it('returns case only for a personal pronoun (number is fixed by the lemma)', () => {
    const steps = buildSelectSteps(yaPhrase.target, ya)
    expect(steps.map((s) => s.kind)).toEqual(['case'])
  })
})

describe('buildFromPhrase', () => {
  it('blanks the target token to the lemma and reads the answer off the token', () => {
    const ex = buildFromPhrase(accPhrase, sobaka, { rules })
    expect(ex.targetIndex).toBe(2)
    expect(ex.tokens).toEqual(['Я', 'ви́жу', 'соба́ку.'])
    expect(ex.lemma).toBe('соба́ка') // dictionary form shown in the slot before answering
    expect(ex.answerAccented).toBe('соба́ку')
    expect(ex.answer).toBe('собаку')
    expect(ex.ru).toBe('Я ви́жу соба́ку.')
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'number'])
    expect(ex.rule).toMatchObject({ id: 'noun-acc-fem-a', formula: '-а → -у' })
  })

  it('handles verbs (no selection steps, person slot label)', () => {
    const ex = buildFromPhrase(verbPhrase, dumat)
    expect(ex.selectSteps).toEqual([])
    expect(ex.lemmaOptions).toBeNull()
    expect(ex.answerAccented).toBe('ду́маю')
    expect(ex.slotLabel).toContain('Present')
  })

  it('treats the finite быть auxiliary as the inflected part of an imperfective future', () => {
    const paired = {
      ...dumat,
      aspect: 'impf',
      aspectPair: { key: 'подумать=to think', ru: 'поду́мать', aspect: 'pf', gloss: 'to think' },
    }
    const ex = buildFromPhrase(dumatFuture, paired)
    expect(ex.targetIndex).toBe(1)
    expect(ex.lemma).toBe('быть')
    expect(ex.answerAccented).toBe('бу́ду')
    expect(ex.slotLabel).toBe('Future · I')
    // A one-token slot cannot offer aspect alternatives with different syntax.
    expect(ex.selectSteps).toEqual([])
    expect(ex.lemmaOptions).toBeNull()
  })

  it('offers both lemmas and the aspect rule for a paired verb', () => {
    const aspectRules = { 'verb-aspect': { title: 'Aspect', formula: 'impf vs pf' } }
    const ex = buildFromPhrase(skazatPhrase, skazat, { rules: aspectRules })
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['aspect'])
    // The slot must not leak which partner is correct before the choice.
    expect(ex.lemmaOptions).toEqual(['говори́ть', 'сказа́ть'])
    expect(ex.lemma).toBe('сказа́ть')
    expect(ex.answerAccented).toBe('сказа́л')
    expect(ex.aspectRule).toMatchObject({ id: 'verb-aspect', title: 'Aspect' })
  })

  it('labels an imperative slot', () => {
    const ex = buildFromPhrase(impPhrase, skazat)
    expect(ex.answerAccented).toBe('Скажи́те')
    expect(ex.answer).toBe('скажите')
    expect(ex.slotLabel).toBe('Imperative · вы (command)')
    expect(ex.aspectRule).toBeNull() // no rules map supplied
  })

  it('builds case + gender steps for an adjective', () => {
    const ex = buildFromPhrase(adjPhrase, noviy)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'gender'])
    expect(ex.answerAccented).toBe('но́вую')
    expect(ex.slotLabel).toBe('Accusative · Feminine')
  })

  it('returns null for an out-of-range token index', () => {
    expect(buildFromPhrase({ ...accPhrase, target: { ...accPhrase.target, token: 9 } }, sobaka)).toBeNull()
  })

  it('builds a case-only step for a personal pronoun', () => {
    const ex = buildFromPhrase(yaPhrase, ya)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case'])
    expect(ex.answer).toBe('меня')
    // End-stressed form keeps its stress mark (мен-я́, accent on the last letter).
    expect(ex.answerAccented).toBe('меня́')
    expect(ex.slotLabel).toContain('Accusative')
  })

  it('builds case + gender steps for a possessive pronoun', () => {
    const ex = buildFromPhrase(moyPhrase, moy)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'gender'])
    expect(ex.answer).toBe('моя')
    expect(ex.slotLabel).toBe('Nominative · Feminine')
  })
})

describe('buildContextExercise / canBuildContext', () => {
  const phrasesByKey = indexPhrases([accPhrase, verbPhrase])
  it('builds from the indexed phrase', () => {
    const ex = buildContextExercise(sobaka, { phrasesByKey, rules, rng: () => 0 })
    expect(ex.answerAccented).toBe('соба́ку')
  })
  it('reports availability', () => {
    expect(canBuildContext(sobaka, { phrasesByKey })).toBe(true)
    expect(canBuildContext({ key: 'нет=no' }, { phrasesByKey })).toBe(false)
  })
})

describe('buildContextSet', () => {
  // The impf partner of skazat, linked back the other way (vocabBuild links
  // aspect pairs bidirectionally).
  const govorit = {
    key: 'говорить=to speak', pos: 'verb', headword: 'говори́ть', ru: 'говорить', aspect: 'impf',
    aspectPair: { key: 'сказать=to say', ru: 'сказа́ть', aspect: 'pf', gloss: 'to say' },
  }
  const govoritPhrase = {
    id: 'on-govorit', ru: 'Он говори́т по-ру́сски.', en: 'He speaks Russian.',
    target: { key: 'говорить=to speak', token: 2, tense: 'present', person: '3sg' },
  }
  const genPhrase = {
    id: 'net-sobaki', ru: 'У меня́ нет соба́ки.', en: "I don't have a dog.",
    target: { key: 'собака=dog', token: 4, case: 'gen', number: 'sg', rule: 'noun-acc-fem-a' },
  }

  it('bundles several distinct sentences of the same word', () => {
    const byKey = indexPhrases([accPhrase, genPhrase, verbPhrase])
    const set = buildContextSet(sobaka, { phrasesByKey: byKey, rules, rng: () => 0 })
    expect(set).toHaveLength(2)
    expect(new Set(set.map((it) => it.ru)).size).toBe(2)
    for (const it of set) expect(it.targets).toEqual(['собака=dog'])
  })

  it('caps the set at `items` sentences', () => {
    const byKey = indexPhrases([accPhrase, genPhrase])
    const set = buildContextSet(sobaka, { phrasesByKey: byKey, rules, rng: () => 0, items: 1 })
    expect(set).toHaveLength(1)
  })

  it("extends a paired verb's set with the partner's sentences, each owning its item", () => {
    const byKey = indexPhrases([skazatPhrase, impPhrase, govoritPhrase])
    const set = buildContextSet(skazat, {
      phrasesByKey: byKey, rng: () => 0, items: 3, partner: govorit,
    })
    expect(set).toHaveLength(3)
    const byOwner = Object.groupBy(set, (it) => it.targets[0])
    expect(byOwner['сказать=to say']).toHaveLength(2)
    expect(byOwner['говорить=to speak']).toHaveLength(1)
    // The partner's item is built around the partner: its lemma is the
    // partner's infinitive and its aspect step is answered by the partner.
    const partnerItem = byOwner['говорить=to speak'][0]
    expect(partnerItem.lemma).toBe('говори́ть')
    const aspect = partnerItem.selectSteps.find((s) => s.kind === 'aspect')
    expect(aspect.options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'impf' }),
    ])
  })

  it('drops sentences whose English is authored on both sides of the pair', () => {
    // Same English on both sides — cannot discriminate the aspect.
    const clash = { ...govoritPhrase, id: 'clash', en: skazatPhrase.en }
    const byKey = indexPhrases([skazatPhrase, impPhrase, clash])
    const set = buildContextSet(skazat, {
      phrasesByKey: byKey, rng: () => 0, items: 3, partner: govorit,
    })
    // The clashing own sentence and the partner sentence both go; the
    // imperative sentence remains.
    expect(set.map((it) => it.ru)).toEqual([impPhrase.ru])
  })

  it('keeps the set own-only when the exclusion would empty the own side', () => {
    const clash = { ...govoritPhrase, id: 'clash', en: skazatPhrase.en }
    const byKey = indexPhrases([skazatPhrase, clash])
    const set = buildContextSet(skazat, {
      phrasesByKey: byKey, rng: () => 0, items: 3, partner: govorit,
    })
    expect(set.map((it) => it.targets[0])).toEqual(['сказать=to say'])
  })

  it('ignores a partner that is not the linked aspect partner', () => {
    const byKey = indexPhrases([accPhrase, verbPhrase])
    const set = buildContextSet(sobaka, {
      phrasesByKey: byKey, rules, rng: () => 0, partner: dumat,
    })
    expect(set.map((it) => it.targets[0])).toEqual(['собака=dog'])
  })
})

describe('exception weighting', () => {
  // Two phrases for one word: one regular, one flagged as an exception.
  const regular = {
    id: 'reg', ru: 'У меня́ нет соба́ки.', en: "I don't have a dog.",
    target: { key: 'собака=dog', token: 3, case: 'gen', number: 'sg', rule: 'noun-gen-sg' },
  }
  const exc = {
    id: 'exc', ru: 'Я ви́жу соба́ку.', en: 'I see the dog.',
    target: { key: 'собака=dog', token: 3, case: 'acc', number: 'sg', rule: 'noun-acc-animate' },
  }
  const excRules = {
    'noun-gen-sg': { title: 'Genitive singular' },
    'noun-acc-animate': { title: 'Animate accusative', exception: true },
  }
  const byKey = indexPhrases([regular, exc])

  it('flags the exception on the descriptor', () => {
    expect(buildFromPhrase(exc, sobaka, { rules: excRules }).exception).toBe(true)
    expect(buildFromPhrase(regular, sobaka, { rules: excRules }).exception).toBe(false)
  })

  it('draws the exception more often than the regular phrase', () => {
    let excCount = 0
    let seed = 1
    const rng = () => { // deterministic LCG, well-spread in [0,1)
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 1000; i++) {
      const ex = buildContextExercise(sobaka, { phrasesByKey: byKey, rules: excRules, rng })
      if (ex.exception) excCount++
    }
    // weight 4 vs 1 → ~80% exception. Assert a clear majority (not exact).
    expect(excCount).toBeGreaterThan(650)
    expect(excCount).toBeLessThan(1000) // regular still appears sometimes
  })
})

describe('buildAspectDrill / canBuildAspectDrill', () => {
  // The pf verb (сказа́ть) with usage sentences on both sides of its pair. The
  // pick stage needs no annotations, only ru/en usage phrases keyed by owner;
  // the spelling stage draws from the annotated phrases (phrasesByKey).
  const phrasesByKey = indexPhrases([skazatPhrase])
  const ownUsage = [
    { ru: 'Он сказа́л пра́вду.', en: 'He said the truth.', source: 'сказать=to say' },
    { ru: 'Скажи́те, пожа́луйста, где вокза́л?', en: 'Tell me please, where is the station?', source: 'сказать=to say' },
    { ru: 'Она́ ска́жет всё за́втра.', en: 'She will say everything tomorrow.', source: 'сказать=to say' },
  ]
  const partnerUsage = [
    { ru: 'Он говори́т по-ру́сски.', en: 'He speaks Russian.', source: 'говорить=to speak' },
    { ru: 'Мы говори́ли весь ве́чер.', en: 'We were talking all evening.', source: 'говорить=to speak' },
    { ru: 'Не говори́ так гро́мко.', en: "Don't talk so loudly.", source: 'говорить=to speak' },
  ]
  const phrasesBySource = new Map([
    ['сказать=to say', ownUsage],
    ['говорить=to speak', partnerUsage],
  ])
  const drillRules = {
    'verb-past': { title: 'Past tense' },
    'verb-aspect': { title: 'Aspect: imperfective or perfective?' },
  }
  const ctx = { phrasesByKey, phrasesBySource, rules: drillRules, rng: () => 0 }

  it('reports availability only for paired verbs with enough sentences', () => {
    expect(canBuildAspectDrill(skazat, ctx)).toBe(true)
    // No aspect partner → no drill.
    expect(canBuildAspectDrill(dumat, ctx)).toBe(false)
    // Not a verb.
    expect(canBuildAspectDrill(sobaka, ctx)).toBe(false)
    // No annotated phrase to spell.
    expect(canBuildAspectDrill(skazat, { ...ctx, phrasesByKey: new Map() })).toBe(false)
    // Too few sentences overall (own side reserved one for spelling).
    expect(
      canBuildAspectDrill(skazat, {
        ...ctx,
        phrasesBySource: new Map([
          ['сказать=to say', ownUsage.slice(0, 2)],
          ['говорить=to speak', partnerUsage.slice(0, 1)],
        ]),
      }),
    ).toBe(false)
  })

  it('builds items from both partners, answered by the owning verb aspect', () => {
    const drill = buildAspectDrill(skazat, ctx)
    expect(drill.kind).toBe('aspect-drill')
    expect(drill.targets).toEqual(['сказать=to say'])
    // Options are the two infinitives, imperfective first, with usage cues.
    expect(drill.options.map((o) => o.id)).toEqual(['impf', 'pf'])
    expect(drill.options.map((o) => o.label)).toEqual(['говори́ть', 'сказа́ть'])
    expect(drill.options[0].hint).toContain('imperfective')
    // Every item is answered by the aspect of the verb that owns its sentence.
    const ownRu = new Set(ownUsage.map((p) => p.ru))
    for (const item of drill.items) {
      expect(item.answer).toBe(ownRu.has(item.ru) ? 'pf' : 'impf')
      expect(item.en).toBeTruthy()
    }
    // Both aspects are represented.
    expect(new Set(drill.items.map((i) => i.answer))).toEqual(new Set(['impf', 'pf']))
  })

  it('never shows the spelling sentence among the picks', () => {
    const drill = buildAspectDrill(skazat, ctx)
    // The only annotated phrase is Он сказа́л пра́вду — it must be the spelling
    // stage, and must not leak into the pick list.
    expect(drill.spell.ru).toBe('Он сказа́л пра́вду.')
    expect(drill.items.map((i) => i.ru)).not.toContain(drill.spell.ru)
  })

  it('strips the aspect step from the spelling stage but keeps the aspect rule', () => {
    const drill = buildAspectDrill(skazat, ctx)
    expect(drill.spell.selectSteps).toEqual([])
    expect(drill.spell.lemmaOptions).toBeNull()
    // The generic aspect explanation is still offered after spelling.
    expect(drill.spell.aspectRule).toEqual(expect.objectContaining({ id: 'verb-aspect' }))
    expect(drill.aspectRule).toEqual(expect.objectContaining({ id: 'verb-aspect' }))
  })

  it('caps the pick list at the requested number of items', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ru: `Фра́за но́мер ${i}.`, en: `Phrase number ${i}.`, source: 'говорить=to speak',
    }))
    const drill = buildAspectDrill(skazat, {
      ...ctx,
      phrasesBySource: new Map([
        ['сказать=to say', ownUsage],
        ['говорить=to speak', many],
      ]),
    })
    expect(drill.items.length).toBe(ASPECT_DRILL_ITEMS)
    // Balanced: the short own side contributes everything it has (minus the
    // spelling sentence), the partner fills the rest.
    expect(drill.items.filter((i) => i.answer === 'pf').length).toBe(2)
    expect(drill.items.filter((i) => i.answer === 'impf').length).toBe(4)
  })

  it('returns null when the drill cannot be built', () => {
    expect(buildAspectDrill(dumat, ctx)).toBeNull()
  })
})
