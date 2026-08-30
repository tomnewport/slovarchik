import { describe, it, expect } from 'vitest'

import {
  normToken,
  normTokenStress,
  wordForms,
  wordTokensInPhrase,
  buildFormIndex,
  phraseHintTokens,
} from './phraseHint.js'
import { loadFixtureWords } from '../test/fixtures.js'

describe('normToken', () => {
  it('strips stress, punctuation and case and folds ё→е', () => {
    expect(normToken('Абза́ц.')).toBe('абзац')
    expect(normToken('всё,')).toBe('все')
    expect(normToken('«дом»')).toBe('дом')
  })

  it('returns an empty string for tokens with no letters', () => {
    expect(normToken('—')).toBe('')
    expect(normToken('123')).toBe('')
    expect(normToken('')).toBe('')
  })
})

describe('normTokenStress', () => {
  it('keeps the stress mark, distinguishing heteronyms', () => {
    expect(normTokenStress('по́лке')).not.toBe(normTokenStress('полке́'))
    expect(normTokenStress('стоя́т')).not.toBe(normTokenStress('сто́ят'))
    // otherwise behaves like normToken: lowercased, ё→е, punctuation dropped
    expect(normTokenStress('Всё,')).toBe(normTokenStress('все'))
    expect(normTokenStress('«по́лке».')).toBe(normTokenStress('по́лке'))
  })
})

describe('wordForms', () => {
  it('indexes the headword, bare key form and every inflected form', () => {
    const noun = {
      key: 'абзац=paragraph',
      headword: 'абза́ц',
      ru: 'абзац',
      meaning: 'paragraph',
      forms: { sg: { nom: 'абза́ц', pre: 'абза́це' }, pl: { nom: 'абза́цы' } },
      extra: { declension: { sg_ins: 'абза́цем' } },
    }
    const forms = wordForms(noun)
    expect(forms.has('абзац')).toBe(true) // headword / bare
    expect(forms.has('абзаце')).toBe(true) // prepositional sg
    expect(forms.has('абзацы')).toBe(true) // nominative pl
    expect(forms.has('абзацем')).toBe(true) // from raw declension
  })

  it('pulls verb conjugation and past forms from the raw record', () => {
    const verb = {
      key: 'арестовать=to arrest',
      headword: 'арестова́ть',
      ru: 'арестовать',
      meaning: 'to arrest',
      forms: {},
      extra: {
        accented: 'арестова́ть',
        conjugation: { future: { '3sg': 'аресту́ет' }, past_f: 'арестова́ла' },
      },
    }
    const forms = wordForms(verb)
    expect(forms.has('арестует')).toBe(true)
    expect(forms.has('арестовала')).toBe(true)
  })

  it('does not index the component words of a multi-word form (#155)', () => {
    // The year «две ты́сячи» must not leak «две»/«ты́сячи» as standalone glosses.
    const year = {
      key: 'две тысячи=2000',
      headword: 'две ты́сячи',
      ru: 'две тысячи',
      meaning: '2000',
      forms: {},
      extra: { type: 'year', accented: 'две ты́сячи' },
    }
    const forms = wordForms(year)
    expect(forms.has('две')).toBe(false)
    expect(forms.has('тысячи')).toBe(false)
  })

  it('derives the n-prefixed forms of third-person personal pronouns', () => {
    const on = {
      pos: 'pronoun',
      headword: 'он',
      ru: 'он',
      meaning: 'he',
      forms: {},
      extra: { type: 'pers', forms: { gen: 'его́', dat: 'ему́', ins: 'им', pre: 'нём' } },
    }
    const forms = wordForms(on)
    expect(forms.has('него')).toBe(true) // genitive/accusative after a preposition
    expect(forms.has('нему')).toBe(true) // dative
    expect(forms.has('ним')).toBe(true) // instrumental
  })
})

describe('wordTokensInPhrase', () => {
  const noun = {
    key: 'абзац=paragraph',
    headword: 'абза́ц',
    ru: 'абзац',
    meaning: 'paragraph',
    forms: { sg: { nom: 'абза́ц', pre: 'абза́це' }, pl: { nom: 'абза́цы' } },
    extra: { declension: { sg_ins: 'абза́цем' } },
  }

  it('finds the normalised tokens of a phrase that are forms of the word', () => {
    expect(wordTokensInPhrase('в пе́рвом абза́це.', noun)).toEqual(['абзаце'])
  })

  it('returns an entry per occurrence when the word repeats', () => {
    expect(wordTokensInPhrase('абза́ц за абза́цем', noun)).toEqual(['абзац', 'абзацем'])
  })

  it('returns an empty array when the word does not appear', () => {
    expect(wordTokensInPhrase('я иду домой', noun)).toEqual([])
  })
})

describe('buildFormIndex', () => {
  it('maps inflected surface forms back to their dictionary entry', () => {
    const index = buildFormIndex(loadFixtureWords())
    const hit = index.get(normToken('абза́це')) // prepositional singular
    expect(hit).toBeTruthy()
    expect(hit.key).toBe('абзац=paragraph')
    expect(hit.en).toBe('paragraph')
  })

  it('skips entries with no English gloss to show', () => {
    const index = buildFormIndex([{ key: 'x', headword: 'икс', ru: 'икс', meaning: '' }])
    expect(index.size).toBe(0)
  })

  it('glosses feminine «две» as "two", not the year (#155)', () => {
    const index = buildFormIndex(loadFixtureWords())
    expect(index.get(normToken('две'))?.en).toBe('two')
  })

  it('glosses n-prefixed pronoun forms from the bundled vocab', () => {
    const index = buildFormIndex(loadFixtureWords())
    expect(index.get(normToken('него'))?.en).toBe('he')
    expect(index.get(normToken('неё'))?.en).toBe('she')
  })

  it('stacks every dictionary sense of a homograph onto one hint (#568)', () => {
    // «есть» is both the infinitive "to eat" and the existential "there is"
    // («У ва́ших сосе́дей есть соба́ка»). One gloss would be wrong half the time.
    const index = buildFormIndex(loadFixtureWords())
    const hit = index.get(normToken('есть'))
    expect(hit.senses.map((s) => s.key)).toEqual(['есть=to eat', 'есть=there is'])
    expect(hit.en).toBe('to eat / there is')
    // The entry's own key stays the learnable one, so a drill that must not give
    // its own answer away still recognises the word it is assessing.
    expect(hit.key).toBe('есть=to eat')
  })

  it('orders a homograph’s senses independently of vocab load order', () => {
    const castle = { key: 'замок=castle', headword: 'за́мок', ru: 'замок', meaning: 'castle' }
    const lock = { key: 'замок=lock', headword: 'замо́к', ru: 'замок', meaning: 'lock' }
    for (const list of [[castle, lock], [lock, castle]]) {
      expect(buildFormIndex(list).get(normToken('замок')).en).toBe('castle / lock')
    }
  })

  it('does not repeat a sense two entries happen to share', () => {
    const task = { key: 'задание=task', headword: 'зада́ние', ru: 'задание', meaning: 'task' }
    const job = { key: 'задание=job', headword: 'зада́ние', ru: 'задание', meaning: 'task' }
    expect(buildFormIndex([task, job]).get(normToken('задание')).en).toBe('task')
  })

  it('does not stack a mere inflected-form collision as a second sense', () => {
    // «дорого́й» is the adjective's dictionary form and the instrumental of
    // «доро́га» — a coincidence of endings, not a second meaning of the word.
    const road = {
      key: 'дорога=road',
      headword: 'доро́га',
      ru: 'дорога',
      meaning: 'road',
      extra: { declension: { sg_ins: 'дорого́й' } },
    }
    const expensive = {
      key: 'дорогой=expensive',
      headword: 'дорого́й',
      ru: 'дорогой',
      meaning: 'expensive',
      extra: { forms: { m: 'дорого́й' } },
    }
    expect(buildFormIndex([road, expensive]).get(normToken('дорого́й')).en).toBe('expensive')
  })

  it('combines heteronym glosses for forms that are ambiguous after stress-stripping (#198)', () => {
    // стоить (to cost) has 3sg сто́ит; стоять (to stand) has 3sg стои́т.
    // After stress-stripping both normalise to "стоит", so the hint should show both.
    const cost = {
      key: 'стоить=to cost',
      headword: 'сто́ить',
      ru: 'стоить',
      meaning: 'to cost',
      heteronyms: [
        { ru: 'сто́ит', gloss: 'it costs' },
        { ru: 'стои́т', gloss: 'it stands' },
      ],
      extra: { conjugation: { present: { '3sg': 'сто́ит' } } },
    }
    const stand = {
      key: 'стоять=to stand',
      headword: 'стоя́ть',
      ru: 'стоять',
      meaning: 'to stand',
      heteronyms: [
        { ru: 'стои́т', gloss: 'it stands' },
        { ru: 'сто́ит', gloss: 'it costs' },
      ],
      extra: { conjugation: { present: { '3sg': 'стои́т' } } },
    }
    const index = buildFormIndex([cost, stand])
    const gloss = index.get(normToken('стои́т'))?.en
    expect(gloss).toContain('it costs')
    expect(gloss).toContain('it stands')
  })

  it('disambiguates stress-distinguished heteronyms when the token carries stress', () => {
    // «по́лке» is the prepositional of «по́лка» (shelf); «полке́» is the
    // prepositional of «полк» (regiment). Stress-stripped they collide, so the
    // stress-aware companion index must pick the right one.
    const regiment = {
      key: 'полк=regiment',
      headword: 'полк',
      ru: 'полк',
      meaning: 'regiment',
      extra: { declension: { sg_pre: 'полке́' } },
    }
    const shelf = {
      key: 'полка=shelf',
      headword: 'по́лка',
      ru: 'полка',
      meaning: 'shelf',
      forms: { sg: { pre: 'по́лке', dat: 'по́лке' } },
    }
    const index = buildFormIndex([regiment, shelf])
    // Stress-stripped lookup is unchanged (alphabetically first lemma wins).
    expect(index.get(normToken('полке'))?.en).toBe('regiment')
    // Stress-aware lookup resolves each surface form to its own word.
    expect(index.stressIndex.get(normTokenStress('по́лке'))?.en).toBe('shelf')
    expect(index.stressIndex.get(normTokenStress('полке́'))?.en).toBe('regiment')
  })

  it('prefers the word whose dictionary form is the token over an oblique form (#173)', () => {
    // «дорого́й» is the adjective "expensive" (its headword) but also the
    // instrumental of the noun «доро́га» "road". The lemma must win.
    const road = {
      key: 'дорога=road',
      headword: 'доро́га',
      ru: 'дорога',
      meaning: 'road',
      extra: { declension: { sg_ins: 'дорого́й' } },
    }
    const expensive = {
      key: 'дорогой=expensive',
      headword: 'дорого́й',
      ru: 'дорогой',
      meaning: 'expensive',
      extra: { forms: { m: 'дорого́й', f: 'дорога́я' } },
    }
    const index = buildFormIndex([road, expensive])
    expect(index.get(normToken('дорого́й'))?.en).toBe('expensive')
  })

  // A gloss-only stub is keyed on the surface form it glosses, not on a lemma,
  // so it claims that form in pass 1 as though it were a headword — and the real
  // word that also spells it there could only ever reach pass 2, where it was
  // refused. «закро́й» glossed as "close" and dead-ended (#574).
  const closeStub = {
    key: 'закрой=close',
    headword: 'закро́й',
    ru: 'закрой',
    meaning: 'close',
    learnable: false,
  }
  const closeVerb = {
    key: 'закрыть=to close',
    headword: 'закры́ть',
    ru: 'закрыть',
    meaning: 'to close',
    extra: { conjugation: { imperative: { sg: 'закро́й', pl: 'закро́йте' } } },
  }

  it('lets a learnable lemma join a form only gloss-only stubs hold (#574)', () => {
    const hit = buildFormIndex([closeStub, closeVerb]).get(normToken('закро́й'))
    expect(hit.en).toBe('close / to close')
    expect(hit.senses.map((s) => s.key)).toEqual(['закрой=close', 'закрыть=to close'])
  })

  it('keeps a stub’s own sense when its gloss is not the lemma’s (#574)', () => {
    // «заде́ржанный» is a noun, "detainee" — a sense «задержа́ть» "to detain"
    // would lose. Stacking adds the route back to the verb without dropping it.
    const stub = {
      key: 'задержанный=detainee',
      headword: 'заде́ржанный',
      ru: 'задержанный',
      meaning: 'detainee',
      learnable: false,
    }
    const verb = {
      key: 'задержать=to detain',
      headword: 'задержа́ть',
      ru: 'задержать',
      meaning: 'to detain',
      participles: { past_pass: 'заде́ржанный' },
    }
    expect(buildFormIndex([stub, verb]).get(normToken('заде́ржанный')).en).toBe(
      'detainee / to detain',
    )
  })

  it('does not let one gloss-only entry join another’s form (#574)', () => {
    // Only a lemma the learner can actually be drilling earns the extra sense;
    // between two stubs an oblique collision is the coincidence it always was.
    const brightly = {
      key: 'светло=brightly',
      headword: 'светло́',
      ru: 'светло',
      meaning: 'brightly',
      learnable: false,
    }
    const light = {
      key: 'светлый=light',
      headword: 'све́тлый',
      ru: 'светлый',
      meaning: 'light',
      learnable: false,
      extra: { forms: { m: 'све́тлый', n: 'светло́' } },
    }
    expect(buildFormIndex([brightly, light]).get(normToken('светло́')).en).toBe('brightly')
  })

  it('still refuses an oblique collision once a learnable word holds the form (#574)', () => {
    // The stub is no longer the only holder here: «замо́к» "lock" claimed the form
    // in pass 1 too, so the oblique of «замо́чек» stays the coincidence it is.
    const stub = {
      key: 'замок=padlock',
      headword: 'замо́к',
      ru: 'замок',
      meaning: 'padlock',
      learnable: false,
    }
    const lock = { key: 'замок=lock', headword: 'замо́к', ru: 'замок', meaning: 'lock' }
    const little = {
      key: 'замочек=little lock',
      headword: 'замо́чек',
      ru: 'замочек',
      meaning: 'little lock',
      extra: { declension: { sg_gen: 'замо́к' } },
    }
    const hit = buildFormIndex([stub, lock, little]).get(normToken('замо́к'))
    expect(hit.senses.map((s) => s.key)).toEqual(['замок=lock', 'замок=padlock'])
    expect(hit.en).toBe('lock / padlock')
  })
})

describe('the bundled vocabulary’s hint index', () => {
  // Every form of a learnable word must reach that word. A gloss-only stub keyed
  // on the same surface form used to swallow it whole (#574): 362 forms — mostly
  // imperatives, plus the stored participles and gerunds that made it visible —
  // hinted as a stub gloss with no route back to their lemma.
  //
  // The one thing that may still hold a form alone is a stub whose gloss already
  // says what the lemma means («пирожки» "pies" for пирожо́к "pie"): nothing is
  // hidden from the learner there, and `senseGloss` would only read "pies / pie".
  it('never leaves a learnable word’s form dead-ending in a stub gloss (#574)', () => {
    const words = loadFixtureWords()
    const byKey = new Map(words.map((w) => [w.key, w]))
    const index = buildFormIndex(words)
    const isStub = (key) => byKey.get(key)?.learnable === false

    const shadowed = []
    for (const w of words) {
      if (w.learnable === false) continue
      const en = w.meaning || w.en
      for (const form of wordForms(w)) {
        const entry = index.get(form)
        if (!entry || entry.senses.some((s) => !isStub(s.key))) continue
        if (!entry.en.includes(en)) shadowed.push(`${form} → «${entry.en}» hides ${w.key}`)
      }
    }
    expect(shadowed, `shadowed forms:\n${shadowed.slice(0, 25).join('\n')}`).toEqual([])
  })

  it('routes a stored imperative, participle and gerund back to its verb (#574)', () => {
    const index = buildFormIndex(loadFixtureWords())
    expect(index.get(normToken('возьми́')).en).toBe('take / to take')
    expect(index.get(normToken('пла́чущего')).en).toBe('crying / to cry')
    expect(index.get(normToken('подумав')).en).toBe('having thought / to think')
    // …without dropping the nominalised glosses a bulk retirement would have lost.
    expect(index.get(normToken('кома́ндующий')).en).toBe('commander / to command')
    expect(index.get(normToken('при́нято')).en).toBe('it is customary / to accept')
  })
})

describe('phraseHintTokens', () => {
  it('tags known words with a hint and preserves the raw token for display', () => {
    const index = buildFormIndex(loadFixtureWords())
    const tokens = phraseHintTokens('В э́том абза́це две оши́бки.', index)

    const абзаце = tokens.find((t) => t.text === 'абза́це')
    expect(абзаце.hint?.key).toBe('абзац=paragraph')
    expect(абзаце.text).toBe('абза́це') // stress + form kept for display
  })

  it('leaves unknown tokens without a hint', () => {
    const index = buildFormIndex(loadFixtureWords())
    const [first] = phraseHintTokens('к錯誤 zzz', index)
    expect(first.hint).toBeNull()
  })

  it('picks the stress-matching heteronym for a stressed phrase token', () => {
    const shelf = {
      key: 'полка=shelf',
      headword: 'по́лка',
      ru: 'полка',
      meaning: 'shelf',
      forms: { sg: { pre: 'по́лке' } },
    }
    const regiment = {
      key: 'полк=regiment',
      headword: 'полк',
      ru: 'полк',
      meaning: 'regiment',
      extra: { declension: { sg_pre: 'полке́' } },
    }
    const index = buildFormIndex([shelf, regiment])
    const tokens = phraseHintTokens('На по́лке стоя́т буты́лки.', index)
    expect(tokens.find((t) => t.text === 'по́лке').hint?.en).toBe('shelf')
  })
})

describe('participle forms (#564)', () => {
  // A verb stores only each participle's NOMINATIVE; the oblique cells are
  // derived, so tapping «пла́чущего» in a phrase resolves to пла́кать rather than
  // to a glossary stub — the disconnect #564 is about.
  const plakat = {
    key: 'плакать=to cry',
    pos: 'verb',
    ru: 'плакать',
    headword: 'пла́кать',
    meaning: 'to cry',
    participles: { act_pres: 'пла́чущий' },
    gerund: 'пла́ча',
    extra: { conjugation: { present: { '3sg': 'пла́чет' } } },
  }

  it('indexes the stored nominative, the derived grid and the gerund', () => {
    const forms = wordForms(plakat)
    expect(forms.has('плачущий')).toBe(true)
    expect(forms.has('плачущего')).toBe(true) // derived
    expect(forms.has('плачущими')).toBe(true) // derived
    expect(forms.has('плача')).toBe(true) // the gerund
    expect(forms.has('плачет')).toBe(true) // still the finite cells
  })

  it('indexes the short passive cells', () => {
    const prochitat = {
      key: 'прочитать=to read',
      pos: 'verb',
      ru: 'прочитать',
      headword: 'прочита́ть',
      meaning: 'to read',
      participles: { pass_short: { m: 'прочи́тан', f: 'прочи́тана' } },
      extra: {},
    }
    const forms = wordForms(prochitat)
    expect(forms.has('прочитан')).toBe(true)
    expect(forms.has('прочитана')).toBe(true)
  })

  it('resolves an oblique participle back to its verb', () => {
    const index = buildFormIndex([plakat])
    expect(index.get(normToken('пла́чущего'))).toMatchObject({
      key: 'плакать=to cry',
      ru: 'пла́кать',
    })
  })
})
