import { describe, it, expect } from 'vitest'
import {
  indexPhrases,
  buildSelectSteps,
  buildFromPhrase,
  buildContextExercise,
  buildContextSet,
  canBuildContext,
  buildContrastDrill,
  canBuildContrastDrill,
  verbContrast,
  CONTRAST_DRILL_ITEMS,
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
  it('spans several tokens for a multi-word lemma (answer joins the window)', () => {
    const shokolad = { key: 'горячий шоколад=hot chocolate', pos: 'noun', headword: 'горя́чий шокола́д' }
    const phrase = {
      id: 'gs', ru: 'Нет ничего́ лу́чше горя́чего шокола́да зимо́й.', en: '',
      target: { key: 'горячий шоколад=hot chocolate', token: 4, span: 2, case: 'gen', number: 'sg' },
    }
    const ex = buildFromPhrase(phrase, shokolad)
    expect(ex.span).toBe(2)
    expect(ex.targetIndex).toBe(3)
    expect(ex.answerAccented).toBe('горя́чего шокола́да')
    expect(ex.lemma).toBe('горя́чий шокола́д')
  })
  it('returns a short-form gender step for a short (predicate) adjective', () => {
    const zakrytyi = {
      key: 'закрытый=closed', pos: 'adjective',
      short: { m: 'закры́т', f: 'закры́та', n: 'закры́то', pl: 'закры́ты' },
    }
    const steps = buildSelectSteps({ degree: 'short', gender: 'f', token: 3 }, zakrytyi)
    expect(steps.map((s) => s.kind)).toEqual(['gender'])
    expect(steps[0].options.map((o) => o.id)).toEqual(['m', 'n', 'f', 'pl'])
    expect(steps[0].options.filter((o) => o.correct)).toEqual([expect.objectContaining({ id: 'f' })])
  })
  it('returns a degree step only for a comparative — the form is invariable', () => {
    const tihiy = {
      key: 'тихий=quiet', pos: 'adjective', headword: 'ти́хий',
      extra: { forms: { comparative: 'ти́ше' } },
    }
    const steps = buildSelectSteps({ degree: 'comparative', token: 2 }, tihiy)
    expect(steps.map((s) => s.kind)).toEqual(['degree'])
    expect(steps[0].options.map((o) => o.id)).toEqual(['positive', 'comparative', 'superlative'])
    expect(steps[0].options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'comparative' }),
    ])
  })
  it('never offers the superlative on an adverb — «са́мый» modifies adjectives', () => {
    const tiho = {
      key: 'тихо=quietly', pos: 'adverb', headword: 'ти́хо',
      extra: { forms: { comparative: 'ти́ше' } },
    }
    const [degree] = buildSelectSteps({ degree: 'comparative', token: 2 }, tiho)
    expect(degree.options.map((o) => o.id)).toEqual(['positive', 'comparative'])
  })
  it('adds case and gender after the degree for a superlative — са́мый agrees', () => {
    const steps = buildSelectSteps(
      { degree: 'superlative', case: 'nom', gender: 'f', token: 2, span: 2 },
      noviy,
    )
    expect(steps.map((s) => s.kind)).toEqual(['degree', 'case', 'gender'])
  })
  it('returns a choose-the-aspect step for a verb with an aspect partner', () => {
    const steps = buildSelectSteps(skazatPhrase.target, skazat)
    expect(steps.map((s) => s.kind)).toEqual(['contrast'])
    expect(steps.map((s) => s.dimension)).toEqual(['aspect'])
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

  // #592: a rule may name the sibling it is only intelligible against — the
  // genitive after два against the genitive after мно́го — and the word that
  // decides between them is never the one being highlighted.
  describe('the sibling rule a `contrast:` names', () => {
    const twoRules = {
      'noun-count-gen-sg': { title: 'After two, three, four', contrast: 'noun-count-gen-pl' },
      'noun-count-gen-pl': { title: 'After five, and after много', contrast: 'noun-count-gen-sg' },
    }
    const counted = { ...accPhrase, target: { ...accPhrase.target, rule: 'noun-count-gen-sg' } }

    it('resolves it beside the rule that applies', () => {
      const ex = buildFromPhrase(counted, sobaka, { rules: twoRules })
      expect(ex.rule).toMatchObject({ id: 'noun-count-gen-sg' })
      expect(ex.siblingRule).toMatchObject({
        id: 'noun-count-gen-pl',
        title: 'After five, and after много',
      })
    })

    it('is null for a rule that names none', () => {
      expect(buildFromPhrase(accPhrase, sobaka, { rules }).siblingRule).toBeNull()
    })

    // A dangling id is an authoring typo. It resolves to nothing rather than
    // rendering an empty block — the data test is what catches it.
    it('is null when the sibling does not exist', () => {
      const dangling = { 'noun-count-gen-sg': { title: 'x', contrast: 'nope' } }
      expect(buildFromPhrase(counted, sobaka, { rules: dangling }).siblingRule).toBeNull()
    })
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
    const contrastRules = { 'verb-aspect': { title: 'Aspect', formula: 'impf vs pf' } }
    const ex = buildFromPhrase(skazatPhrase, skazat, { rules: contrastRules })
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['contrast'])
    // The slot must not leak which partner is correct before the choice.
    expect(ex.lemmaOptions).toEqual(['говори́ть', 'сказа́ть'])
    expect(ex.lemma).toBe('сказа́ть')
    expect(ex.answerAccented).toBe('сказа́л')
    expect(ex.contrastRule).toMatchObject({ id: 'verb-aspect', title: 'Aspect' })
  })

  it('labels an imperative slot', () => {
    const ex = buildFromPhrase(impPhrase, skazat)
    expect(ex.answerAccented).toBe('Скажи́те')
    expect(ex.answer).toBe('скажите')
    expect(ex.slotLabel).toBe('Imperative · вы (command)')
    expect(ex.contrastRule).toBeNull() // no rules map supplied
  })

  it('builds case + gender steps for an adjective', () => {
    const ex = buildFromPhrase(adjPhrase, noviy)
    expect(ex.selectSteps.map((s) => s.kind)).toEqual(['case', 'gender'])
    expect(ex.answerAccented).toBe('но́вую')
    expect(ex.slotLabel).toBe('Accusative · Feminine')
  })

  it('labels a comparative slot and reads the invariable form off the sentence', () => {
    const tihiy = {
      key: 'тихий=quiet', pos: 'adjective', headword: 'ти́хий',
      extra: { forms: { comparative: 'ти́ше' } },
    }
    const ex = buildFromPhrase(
      {
        id: 'q', ru: 'В библиоте́ке ти́ше, чем в кафе́.', en: '',
        target: { key: 'тихий=quiet', token: 3, degree: 'comparative' },
      },
      tihiy,
    )
    expect(ex.lemma).toBe('ти́хий') // the slot shows the dictionary form to build from
    expect(ex.answerAccented).toBe('ти́ше')
    expect(ex.slotLabel).toBe('Comparative')
  })

  it('spans са́мый + the adjective for a superlative, and labels the agreement', () => {
    const ex = buildFromPhrase(
      {
        id: 's', ru: 'Э́то са́мая но́вая кни́га.', en: '',
        target: { key: 'новый=new', token: 2, span: 2, degree: 'superlative', case: 'nom', gender: 'f' },
      },
      noviy,
    )
    expect(ex.answerAccented).toBe('са́мая но́вая')
    expect(ex.slotLabel).toBe('Superlative · Nominative · Feminine')
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

// The rule oracle's view of a slot (#646): enough to tell a broken RULE from an
// ending that simply isn't known yet. It needs a real paradigm, so this noun
// carries its forms — the bare `sobaka` above deliberately has none.
describe('ruleContext', () => {
  const sahar = {
    key: 'сахар=sugar',
    pos: 'noun',
    headword: 'са́хар',
    ru: 'сахар',
    animate: false,
    forms: {
      sg: {
        nom: 'са́хар',
        gen: 'са́хара',
        dat: 'са́хару',
        acc: 'са́хар',
        ins: 'са́харом',
        pre: 'са́харе',
      },
    },
  }
  const bezSahara = {
    id: 'bez-sahara',
    ru: 'Я пью ко́фе без са́хара.',
    en: 'I drink coffee without sugar.',
    target: { key: 'сахар=sugar', token: 5, case: 'gen', number: 'sg', rule: 'noun-gen-sg' },
  }

  it('carries the paradigm, the wanted slot and where it sits', () => {
    const ex = buildFromPhrase(bezSahara, sahar, { rules })
    expect(ex.ruleContext).toMatchObject({
      wantCase: 'gen',
      wantCol: 'sg',
      animate: false,
      pos: 'noun',
      targetIndex: 4,
    })
    expect(ex.ruleContext.paradigm.cells.length).toBeGreaterThan(0)
    expect(ex.ruleContext.tokens).toEqual(ex.tokens)
  })

  it('is null for a word with no paradigm to reason about', () => {
    expect(buildFromPhrase(accPhrase, sobaka, { rules }).ruleContext).toBeNull()
  })

  it('is null for a slot with no case — a participle or a gerund', () => {
    const gerund = {
      id: 'dumaya',
      ru: 'Ду́мая об э́том, я молчу́.',
      en: 'Thinking about it, I stay silent.',
      target: { key: 'думать=to think', token: 1, form: 'gerund' },
    }
    expect(buildFromPhrase(gerund, dumat, { rules })?.ruleContext ?? null).toBeNull()
  })

  it('asks for the animate-accusative row when an adjective agrees with one', () => {
    const horoshiy = {
      key: 'хороший=good',
      pos: 'adjective',
      headword: 'хоро́ший',
      ru: 'хороший',
      extra: {
        declension: {
          m_nom: 'хоро́ший',
          m_gen: 'хоро́шего',
          m_acc: 'хоро́ший',
          f_nom: 'хоро́шая',
          f_acc: 'хоро́шую',
        },
      },
    }
    const phrase = {
      id: 'vizhu-horoshego-druga',
      ru: 'Я ви́жу хоро́шего дру́га.',
      en: 'I see a good friend.',
      target: {
        key: 'хороший=good',
        token: 3,
        case: 'acc',
        gender: 'm',
        animate: true,
        rule: 'adj-acc-animate',
      },
    }
    const ex = buildFromPhrase(phrase, horoshiy, { rules })
    expect(ex.ruleContext).toMatchObject({
      wantCase: 'acc_anim',
      wantCol: 'm',
      animate: null,
      pos: 'adjective',
    })
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
    const aspect = partnerItem.selectSteps.find((s) => s.kind === 'contrast')
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

describe('buildContrastDrill / canBuildContrastDrill', () => {
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
    expect(canBuildContrastDrill(skazat, ctx)).toBe(true)
    // No aspect partner → no drill.
    expect(canBuildContrastDrill(dumat, ctx)).toBe(false)
    // Not a verb.
    expect(canBuildContrastDrill(sobaka, ctx)).toBe(false)
    // No annotated phrase to spell.
    expect(canBuildContrastDrill(skazat, { ...ctx, phrasesByKey: new Map() })).toBe(false)
    // Too few sentences overall (own side reserved one for spelling).
    expect(
      canBuildContrastDrill(skazat, {
        ...ctx,
        phrasesBySource: new Map([
          ['сказать=to say', ownUsage.slice(0, 2)],
          ['говорить=to speak', partnerUsage.slice(0, 1)],
        ]),
      }),
    ).toBe(false)
  })

  it('builds items from both partners, answered by the owning verb aspect', () => {
    const drill = buildContrastDrill(skazat, ctx)
    expect(drill.kind).toBe('verb-contrast')
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
    const drill = buildContrastDrill(skazat, ctx)
    // The only annotated phrase is Он сказа́л пра́вду — it must be the spelling
    // stage, and must not leak into the pick list.
    expect(drill.spell.ru).toBe('Он сказа́л пра́вду.')
    expect(drill.items.map((i) => i.ru)).not.toContain(drill.spell.ru)
  })

  it('strips the aspect step from the spelling stage but keeps the aspect rule', () => {
    const drill = buildContrastDrill(skazat, ctx)
    expect(drill.spell.selectSteps).toEqual([])
    expect(drill.spell.lemmaOptions).toBeNull()
    // The generic aspect explanation is still offered after spelling.
    expect(drill.spell.contrastRule).toEqual(expect.objectContaining({ id: 'verb-aspect' }))
    expect(drill.contrastRule).toEqual(expect.objectContaining({ id: 'verb-aspect' }))
  })

  it('caps the pick list at the requested number of items', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ru: `Фра́за но́мер ${i}.`, en: `Phrase number ${i}.`, source: 'говорить=to speak',
    }))
    const drill = buildContrastDrill(skazat, {
      ...ctx,
      phrasesBySource: new Map([
        ['сказать=to say', ownUsage],
        ['говорить=to speak', many],
      ]),
    })
    expect(drill.items.length).toBe(CONTRAST_DRILL_ITEMS)
    // Balanced: the short own side contributes everything it has (minus the
    // spelling sentence), the partner fills the rest.
    expect(drill.items.filter((i) => i.answer === 'pf').length).toBe(2)
    expect(drill.items.filter((i) => i.answer === 'impf').length).toBe(4)
  })

  it('returns null when the drill cannot be built', () => {
    expect(buildContrastDrill(dumat, ctx)).toBeNull()
  })
})

// --- The motion contrast (#538) --------------------------------------------
//
// A verb of motion pairs with the *other imperfective* of its pair, so the
// contrast is direction rather than aspect. ходи́ть is the indeterminate member
// and — like most indeterminates — has no aspect partner at all, so the pair
// step it gets is the directional one.
const khodit = {
  key: 'ходить=to walk', pos: 'verb', headword: 'ходи́ть', ru: 'ходить', aspect: 'impf',
  motion: 'indet',
  motionPair: { key: 'идти=to go', ru: 'идти́', aspect: 'impf', motion: 'det', gloss: 'to go' },
}
// идти́ carries BOTH links: the perfective пойти́ and the indeterminate ходи́ть.
const idti = {
  key: 'идти=to go', pos: 'verb', headword: 'идти́', ru: 'идти', aspect: 'impf', motion: 'det',
  aspectPair: { key: 'пойти=to go', ru: 'пойти́', aspect: 'pf', motion: null, gloss: 'to go' },
  motionPair: { key: 'ходить=to walk', ru: 'ходи́ть', aspect: 'impf', motion: 'indet', gloss: 'to walk' },
}
const khoditPhrase = {
  id: 'hozhu-v-shkolu', ru: 'Я хожу́ в шко́лу ка́ждый день.', en: 'I go to school every day.',
  target: { key: 'ходить=to walk', token: 2, tense: 'present', person: '1sg', rule: 'verb-present' },
}

describe('verbContrast', () => {
  it('picks the motion contrast for a verb of motion with no aspect partner', () => {
    expect(verbContrast(khodit)?.dimension).toBe('motion')
  })

  it('prefers aspect when a verb carries both links', () => {
    // идти́ ↔ пойти́ (aspect) and идти́ ↔ ходи́ть (direction). Aspect is the
    // contrast every other verb drills, so it stays primary; the directional
    // one is still taught from ходи́ть's side.
    expect(verbContrast(idti)?.dimension).toBe('aspect')
  })

  it('is null for an unpaired verb and for anything that is not a verb', () => {
    expect(verbContrast(dumat)).toBeNull()
    expect(verbContrast(sobaka)).toBeNull()
    expect(verbContrast(null)).toBeNull()
  })
})

describe('the motion contrast step and drill', () => {
  const ownUsage = [
    { ru: 'Я хожу́ в шко́лу ка́ждый день.', en: 'I go to school every day.', source: 'ходить=to walk' },
    { ru: 'Он ча́сто хо́дит в бассе́йн.', en: 'He often goes to the swimming pool.', source: 'ходить=to walk' },
    { ru: 'Ребёнок уже́ хо́дит.', en: 'The child can already walk.', source: 'ходить=to walk' },
  ]
  const partnerUsage = [
    { ru: 'Я иду́ в шко́лу.', en: 'I am on my way to school.', source: 'идти=to go' },
    { ru: 'Куда́ ты идёшь?', en: 'Where are you going?', source: 'идти=to go' },
  ]
  const ctx = {
    phrasesByKey: indexPhrases([khoditPhrase]),
    phrasesBySource: new Map([
      ['ходить=to walk', ownUsage],
      ['идти=to go', partnerUsage],
    ]),
    rules: {
      'verb-present': { title: 'Present tense' },
      'verb-motion-pair': { title: 'Verbs of motion: one direction or not?' },
    },
    rng: () => 0,
  }

  it('offers the two imperfectives, determinate first, with directional cues', () => {
    const [step] = buildSelectSteps(khoditPhrase.target, khodit)
    expect(step.kind).toBe('contrast')
    expect(step.dimension).toBe('motion')
    // Named "direction" in the feedback line — "contrast" means nothing to a learner.
    expect(step.label).toBe('direction')
    expect(step.options.map((o) => o.id)).toEqual(['det', 'indet'])
    expect(step.options.map((o) => o.label)).toEqual(['идти́', 'ходи́ть'])
    expect(step.options.find((o) => o.correct).label).toBe('ходи́ть')
    expect(step.options[0].hint).toContain('one trip')
    expect(step.options[1].hint).toContain('habitual')
  })

  it('builds a drill answered by the direction of each sentence’s owner', () => {
    const drill = buildContrastDrill(khodit, ctx)
    expect(drill.kind).toBe('verb-contrast')
    expect(drill.contrast).toBe('motion')
    expect(drill.targets).toEqual(['ходить=to walk'])
    expect(drill.options.map((o) => o.id)).toEqual(['det', 'indet'])
    const ownRu = new Set(ownUsage.map((p) => p.ru))
    for (const item of drill.items) {
      expect(item.answer).toBe(ownRu.has(item.ru) ? 'indet' : 'det')
    }
    expect(new Set(drill.items.map((i) => i.answer))).toEqual(new Set(['det', 'indet']))
    // The directional rule explains it, not the aspect one.
    expect(drill.contrastRule.id).toBe('verb-motion-pair')
    expect(drill.spell.contrastRule.id).toBe('verb-motion-pair')
  })

  it('hides which partner is correct behind both lemmas until the pick', () => {
    const ex = buildFromPhrase(khoditPhrase, khodit, { rules: ctx.rules })
    expect(ex.lemmaOptions).toEqual(['идти́', 'ходи́ть'])
    expect(ex.contrastRule.id).toBe('verb-motion-pair')
  })
})

describe('non-finite forms (participles and gerunds)', () => {
  // A transitive perfective storing the whole set, and an imperfective storing
  // only the two forms it can build (#564).
  const prochitat = {
    key: 'прочитать=to read',
    pos: 'verb',
    headword: 'прочита́ть',
    meaning: 'to read',
    aspect: 'pf',
    participles: {
      act_past: 'прочита́вший',
      pass_past: 'прочи́танный',
      pass_short: { m: 'прочи́тан', f: 'прочи́тана', n: 'прочи́тано', pl: 'прочи́таны' },
    },
    gerund: 'прочита́в',
    extra: {},
  }
  const plakat = {
    key: 'плакать=to cry',
    pos: 'verb',
    headword: 'пла́кать',
    meaning: 'to cry',
    aspect: 'impf',
    participles: { act_pres: 'пла́чущий' },
    gerund: 'пла́ча',
    extra: {},
  }

  it('asks which form first, then nothing else for the invariable gerund', () => {
    const steps = buildSelectSteps({ form: 'gerund', token: 4 }, prochitat)
    expect(steps.map((s) => s.kind)).toEqual(['form'])
    expect(steps[0].prompt).toBe('Which form of the verb does the sentence need?')
    expect(steps[0].options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'gerund' }),
    ])
  })

  it('offers only the forms the verb\'s aspect can build', () => {
    // пла́кать is imperfective, so no past passive can ever be right for it.
    const [step] = buildSelectSteps({ form: 'act_pres', token: 2 }, plakat)
    expect(step.options.map((o) => o.id)).toEqual(['act_pres', 'act_past', 'pass_pres', 'gerund'])
    // прочита́ть stores four slots already, so there is nothing to pad with.
    const [pf] = buildSelectSteps({ form: 'gerund', token: 4 }, prochitat)
    expect(pf.options.map((o) => o.id)).toEqual(['act_past', 'pass_past', 'pass_short', 'gerund'])
  })

  it('pads a thinly stored verb up to a real choice', () => {
    // услы́шать stores its gerund and nothing else, so a stored-only step would
    // ask a question with a single answer. The distractors are the other slots
    // a transitive perfective can build.
    const uslyshat = {
      key: 'услышать=to hear',
      pos: 'verb',
      headword: 'услы́шать',
      meaning: 'to hear',
      aspect: 'pf',
      gerund: 'услы́шав',
      extra: {},
    }
    const [step] = buildSelectSteps({ form: 'gerund', token: 1 }, uslyshat)
    expect(step.options.map((o) => o.id)).toEqual([
      'act_past',
      'pass_past',
      'pass_short',
      'gerund',
    ])
    expect(step.options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'gerund' }),
    ])
  })

  it('pads with no passive for a verb whose object is not accusative', () => {
    // кома́ндовать takes the instrumental, so it has no object to promote and
    // no passive of either tense — those would be options that cannot be right.
    const komandovat = {
      key: 'командовать=to command',
      pos: 'verb',
      headword: 'кома́ндовать',
      meaning: 'to command',
      aspect: 'impf',
      participles: { act_pres: 'кома́ндующий' },
      governs: [{ prep: null, case: 'ins' }],
      extra: {},
    }
    const [step] = buildSelectSteps({ form: 'act_pres', token: 2 }, komandovat)
    expect(step.options.map((o) => o.id)).toEqual(['act_pres', 'act_past', 'gerund'])
  })

  it('still offers the annotated form when the verb stores nothing for it', () => {
    const [step] = buildSelectSteps({ form: 'pass_pres', token: 2 }, plakat)
    expect(step.options.map((o) => o.id)).toContain('pass_pres')
  })

  it('drops a step that has only one option to offer', () => {
    // No aspect on the record, so nothing can be ruled in to pad with: the step
    // would be a single button, which grades nothing.
    const thin = { key: 'x=y', pos: 'verb', headword: 'х', gerund: 'х', extra: {} }
    expect(buildSelectSteps({ form: 'gerund', token: 1 }, thin)).toEqual([])
  })

  it('follows the short passive with its gender / number agreement', () => {
    const steps = buildSelectSteps({ form: 'pass_short', gender: 'f', token: 3 }, prochitat)
    expect(steps.map((s) => s.kind)).toEqual(['form', 'gender'])
    expect(steps[1].options.map((o) => o.id)).toEqual(['m', 'n', 'f', 'pl'])
    expect(steps[1].options.filter((o) => o.correct)).toEqual([
      expect.objectContaining({ id: 'f' }),
    ])
  })

  it('adds the case step only for a long participle in an oblique case', () => {
    const nom = buildSelectSteps({ form: 'act_pres', gender: 'm', token: 2 }, plakat)
    expect(nom.map((s) => s.kind)).toEqual(['form', 'gender'])
    const oblique = buildSelectSteps(
      { form: 'act_pres', case: 'acc', gender: 'm', animate: true, token: 3 },
      plakat,
    )
    expect(oblique.map((s) => s.kind)).toEqual(['form', 'case', 'gender'])
  })

  it('labels the slot by the form, with any agreement after it', () => {
    const label = (target, word) =>
      buildFromPhrase(
        { id: 'x', ru: 'Она́ успока́ивала пла́чущего ребёнка.', en: '', target },
        word,
      ).slotLabel
    expect(label({ form: 'gerund', token: 2 }, prochitat)).toBe('Gerund')
    expect(label({ form: 'pass_short', gender: 'f', token: 2 }, prochitat)).toBe(
      'Short passive participle · Feminine',
    )
    expect(label({ form: 'act_pres', gender: 'm', token: 2 }, plakat)).toBe(
      'Present active participle · Masculine',
    )
    expect(
      label({ form: 'act_pres', case: 'acc', gender: 'm', animate: true, token: 3 }, plakat),
    ).toBe('Present active participle · Accusative · Masculine')
  })

  it('takes the answer straight off the sentence, as every other slot does', () => {
    const ex = buildFromPhrase(
      {
        id: 'p',
        ru: 'Она́ успока́ивала пла́чущего ребёнка.',
        en: 'She was comforting the crying child.',
        target: { key: plakat.key, token: 3, form: 'act_pres', case: 'acc', gender: 'm', animate: true },
      },
      plakat,
    )
    expect(ex.answerAccented).toBe('пла́чущего')
    expect(ex.lemma).toBe('пла́кать')
  })
})
