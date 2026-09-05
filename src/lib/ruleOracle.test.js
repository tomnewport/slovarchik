import { describe, it, expect } from 'vitest'

import {
  SPELLING_RULES,
  SINGLE_CASE_PREPOSITIONS,
  caseRuleMiss,
  governingPreposition,
  ruleMiss,
  ruleReminder,
  spellingRuleMiss,
} from './ruleOracle.js'
import { paradigmFor } from './paradigm.js'
import { loadFixtureWords, loadFixtureRules } from '../test/fixtures.js'

const words = loadFixtureWords()
const rules = loadFixtureRules()
const find = (ru) => words.find((w) => w.headword === ru || w.ru === ru)
const paradigmOf = (ru) => paradigmFor(find(ru), null)

describe('spellingRuleMiss', () => {
  it.each([
    ['кни́гы', 'кни́ги', 'spelling-i-not-y'],
    ['ру́чкы', 'ру́чки', 'spelling-i-not-y'],
    ['ножы́', 'ножи́', 'spelling-i-not-y'],
    ['пишю́', 'пишу́', 'spelling-a-u-not-ya-yu'],
    ['слы́шят', 'слы́шат', 'spelling-a-u-not-ya-yu'],
    ['му́жом', 'му́жем', 'spelling-o-e-after-sibilant'],
    ['ножём', 'ножо́м', 'spelling-o-e-after-sibilant'],
    ['отци́', 'отцы́', 'spelling-y-not-i-after-ts'],
    ['цырк', 'цирк', 'spelling-y-not-i-after-ts'],
  ])('%s for %s breaks %s', (typed, want, ruleId) => {
    expect(spellingRuleMiss(typed, want)?.ruleId).toBe(ruleId)
  })

  it('names the seven-letter rule from the letter BEFORE the slip', () => {
    // The ы/и choice is decided by the к, not by the case being asked for.
    const miss = spellingRuleMiss('ру́чкы', 'ру́чки')
    expect(miss).toMatchObject({ kind: 'spelling', got: 'ы', want: 'и', variant: 'i' })
  })

  it('stays silent when the word is simply the wrong form', () => {
    // A learner who wrote the nominative has not broken a spelling rule.
    expect(spellingRuleMiss('кни́га', 'кни́ги')).toBeNull()
  })

  it('stays silent when a letter is missing or added', () => {
    // Lengths differ, so which letters correspond is a guess — and a guess
    // would name a rule that isn't the one that went wrong.
    expect(spellingRuleMiss('стол', 'столы́')).toBeNull()
    expect(spellingRuleMiss('кни́гии', 'кни́ги')).toBeNull()
  })

  it('stays silent when a slip no rule explains rides along', () => {
    // ы→и after г is the seven-letter rule, but в→ф is nothing: knowing the
    // rule would still not have produced the right answer.
    expect(spellingRuleMiss('кни́фы', 'кни́ги')).toBeNull()
  })

  it('stays silent on the loanwords the eight-letter rule excepts', () => {
    // «парашу́т» for «парашю́т» is the exception biting, not the rule broken —
    // telling the learner to write у for ю would be the opposite of help.
    expect(spellingRuleMiss('парашу́т', 'парашю́т')).toBeNull()
    expect(spellingRuleMiss('жури́', 'жюри́')).toBeNull()
  })

  it('reads the о/е choice off the stress, not off the letters alone', () => {
    // Same two letters, opposite verdicts: stressed the ending is о, unstressed е.
    expect(spellingRuleMiss('ножём', 'ножо́м')?.variant).toBe('stressed')
    expect(spellingRuleMiss('му́жом', 'му́жем')?.variant).toBe('unstressed')
  })

  it('reads ё as stressed, so a root spelled о is the same rule', () => {
    // ё is never unstressed, which is what makes «шол» decidable at all.
    expect(spellingRuleMiss('шол', 'шёл')).toMatchObject({
      ruleId: 'spelling-o-e-after-sibilant',
      variant: 'yo',
    })
  })

  it('stays silent where a stressed е after a sibilant is simply the spelling', () => {
    // «жест» is an unmarked monosyllable, so the vowel is known to be stressed —
    // and a stressed е there is a root that keeps it, not a broken rule.
    expect(spellingRuleMiss('жост', 'жест')).toBeNull()
  })

  it('says the rule generically when nothing marks the stress', () => {
    expect(spellingRuleMiss('мужом', 'мужем')?.variant).toBe('either')
  })

  it('ignores letters no rule is about', () => {
    expect(spellingRuleMiss('хоро́шево', 'хоро́шего')).toBeNull()
    expect(spellingRuleMiss('стал', 'стол')).toBeNull()
  })

  it('needs the trigger letter immediately before the slip', () => {
    // и/ы is only the seven-letter rule when one of the seven precedes it.
    expect(spellingRuleMiss('водый', 'водий')).toBeNull()
  })

  it('takes no view on an empty or missing answer', () => {
    expect(spellingRuleMiss('', 'кни́ги')).toBeNull()
    expect(spellingRuleMiss('кни́ги', '')).toBeNull()
    expect(spellingRuleMiss(undefined, undefined)).toBeNull()
  })
})

describe('governingPreposition', () => {
  it('finds a single-case preposition immediately before the slot', () => {
    expect(governingPreposition(['Я', 'пью', 'ко́фе', 'без', 'са́хара'], 4)).toEqual({
      prep: 'без',
      case: 'gen',
    })
  })

  it('reads through the punctuation attached to the token', () => {
    expect(governingPreposition(['Он', 'ушёл', 'без', 'объясне́ний.'], 3)?.prep).toBe('без')
  })

  it('ignores a preposition that governs more than one case', () => {
    // «в» is accusative for motion and prepositional for location, so "«в»
    // takes the prepositional" would be a half-truth dressed as a rule.
    expect(governingPreposition(['Я', 'живу́', 'в', 'Москве́'], 3)).toBeNull()
  })

  it('only looks at the token immediately before the slot', () => {
    // «на» heads «столе́», not «интере́сная» — walking further back would
    // invent a government that isn't there.
    expect(governingPreposition(['Кни́га', 'на', 'столе́', 'интере́сная'], 3)).toBeNull()
  })

  it('has nothing to say about a slot that opens the sentence', () => {
    expect(governingPreposition(['Кни́га', 'на', 'столе́'], 0)).toBeNull()
    expect(governingPreposition(null, 2)).toBeNull()
  })
})

describe('caseRuleMiss', () => {
  const tokens = ['Я', 'пью', 'ко́фе', 'без', 'са́хара']

  it('names the preposition when another case of the right word was given', () => {
    const miss = caseRuleMiss('са́хар', {
      paradigm: paradigmOf('са́хар'),
      wantCase: 'gen',
      animate: false,
      pos: 'noun',
      tokens,
      targetIndex: 4,
    })
    expect(miss).toMatchObject({ kind: 'case', ruleId: 'prep-gov-gen', prep: 'без' })
  })

  it('stays silent when the answer is no form of the word at all', () => {
    // A misspelling is not a case error, and the drill's own diff says more.
    expect(
      caseRuleMiss('са́хра', {
        paradigm: paradigmOf('са́хар'),
        wantCase: 'gen',
        pos: 'noun',
        tokens,
        targetIndex: 4,
      }),
    ).toBeNull()
  })

  it('stays silent without a governing preposition', () => {
    expect(
      caseRuleMiss('са́хар', {
        paradigm: paradigmOf('са́хар'),
        wantCase: 'gen',
        pos: 'noun',
        tokens: ['Нет', 'са́хара'],
        targetIndex: 1,
      }),
    ).toBeNull()
  })

  it('names animacy when an animate accusative was given the nominative', () => {
    const word = find('брат')
    expect(word.animate).toBe(true)
    const miss = caseRuleMiss(word.headword, {
      paradigm: paradigmFor(word, null),
      wantCase: 'acc',
      animate: true,
      pos: 'noun',
    })
    expect(miss).toMatchObject({ ruleId: 'noun-acc-animate', animate: true })
  })

  it('names animacy when an inanimate accusative was given the genitive', () => {
    const word = find('стол')
    expect(word.animate).toBe(false)
    const gen = paradigmFor(word, null).cells.find((c) => c.row === 'gen' && c.col === 'sg')
    const miss = caseRuleMiss(gen.form, {
      paradigm: paradigmFor(word, null),
      wantCase: 'acc',
      animate: false,
      pos: 'noun',
    })
    expect(miss).toMatchObject({ ruleId: 'noun-acc-animate', animate: false })
  })

  it('takes no view when the answer is already the wanted case', () => {
    const word = find('стол')
    const p = paradigmFor(word, null)
    const acc = p.cells.find((c) => c.row === 'acc' && c.col === 'sg')
    expect(caseRuleMiss(acc.form, { paradigm: p, wantCase: 'acc', animate: false, pos: 'noun' })).toBeNull()
  })

  it('reads the case in the slot\u2019s own column, not across the table', () => {
    // «са́хара» is the genitive singular; asked for the genitive PLURAL of a
    // word that has one, the singular is a NUMBER miss, not a case one.
    const word = find('стол')
    const p = paradigmFor(word, null)
    const genSg = p.cells.find((c) => c.row === 'gen' && c.col === 'sg')
    expect(
      caseRuleMiss(genSg.form, {
        paradigm: p,
        wantCase: 'acc',
        wantCol: 'pl',
        animate: false,
        pos: 'noun',
      }),
    ).toBeNull()
  })

  it('needs a paradigm and a wanted case', () => {
    expect(caseRuleMiss('стол', {})).toBeNull()
    expect(caseRuleMiss('', { paradigm: paradigmOf('стол'), wantCase: 'gen' })).toBeNull()
  })
})

describe('ruleMiss', () => {
  it('prefers the spelling reading — it is checkable on the spot', () => {
    expect(ruleMiss('кни́гы', 'кни́ги', {})?.kind).toBe('spelling')
  })

  it('falls through to the grammar reading', () => {
    expect(
      ruleMiss('са́хар', 'са́хара', {
        paradigm: paradigmOf('са́хар'),
        wantCase: 'gen',
        pos: 'noun',
        tokens: ['ко́фе', 'без', 'са́хара'],
        targetIndex: 2,
      })?.kind,
    ).toBe('case')
  })

  it('has nothing to say about a correct answer', () => {
    expect(ruleMiss('кни́ги', 'кни́ги', {})).toBeNull()
    // Stress and ё are folded for grading, so they are folded here too.
    expect(ruleMiss('книги', 'кни́ги', {})).toBeNull()
  })
})

describe('ruleReminder', () => {
  it('carries the grammar-rules entry for the reveal to expand', () => {
    const hint = ruleReminder(spellingRuleMiss('кни́гы', 'кни́ги'), rules)
    expect(hint.ruleId).toBe('spelling-i-not-y')
    expect(hint.rule.title).toBeTruthy()
    expect(hint.detail).toContain('и')
  })

  it('quotes the preposition — it is already on screen — and the case given', () => {
    const hint = ruleReminder(
      caseRuleMiss('са́хар', {
        paradigm: paradigmOf('са́хар'),
        wantCase: 'gen',
        pos: 'noun',
        tokens: ['ко́фе', 'без', 'са́хара'],
        targetIndex: 2,
      }),
      rules,
    )
    expect(hint.headline).toBe('«без» always takes the genitive')
    expect(hint.detail).toContain('nominative')
  })

  it('works with no rules map — the wording is its own', () => {
    const hint = ruleReminder(spellingRuleMiss('пишю́', 'пишу́'))
    expect(hint.headline).toContain('eight-letter')
    expect(hint.rule).toBeNull()
  })

  it('never spells the answer out', () => {
    // The learner is still trying: a reminder may name letters, cases and the
    // preposition on screen, never the form being asked for.
    for (const [typed, want] of [
      ['кни́гы', 'кни́ги'],
      ['пишю́', 'пишу́'],
      ['му́жом', 'му́жем'],
      ['отци́', 'отцы́'],
      ['цырк', 'цирк'],
    ]) {
      const hint = ruleReminder(spellingRuleMiss(typed, want), rules)
      const said = `${hint.headline} ${hint.detail}`.toLowerCase()
      expect(said, `${hint.ruleId} gave the answer away`).not.toContain(
        want.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
      )
    }
  })

  it('words the animacy reminder from the side the learner was on', () => {
    const animate = ruleReminder(
      { kind: 'case', ruleId: 'noun-acc-animate', wantCase: 'acc', gotCase: 'nom', animate: true },
      rules,
    )
    expect(animate.headline).toContain('animate accusative')
    expect(animate.detail).toContain('copies the genitive')
    expect(animate.detail).toContain('You gave the nominative.')

    const inanimate = ruleReminder(
      { kind: 'case', ruleId: 'noun-acc-animate', wantCase: 'acc', gotCase: 'gen', animate: false },
      rules,
    )
    expect(inanimate.headline).toContain('inanimate accusative')
    expect(inanimate.detail).toContain('copies the nominative')
  })

  it('leaves the case they gave unsaid when it cannot be named', () => {
    const hint = ruleReminder(
      { kind: 'case', ruleId: 'prep-gov-dat', wantCase: 'dat', prep: 'к', gotCase: null },
      rules,
    )
    expect(hint.headline).toBe('«к» always takes the dative')
    expect(hint.detail).not.toContain('You gave')
  })

  it('is null for a miss no rule explains', () => {
    expect(ruleReminder(null, rules)).toBeNull()
    expect(ruleReminder({}, rules)).toBeNull()
  })
})

describe('the rule tables', () => {
  it('gives every spelling rule a distinct id and a name to say', () => {
    const ids = SPELLING_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of SPELLING_RULES) {
      expect(rule.name, rule.id).toBeTruthy()
      expect(rule.detail(''), rule.id).toBeTruthy()
    }
  })

  it('maps every listed preposition to exactly one case', () => {
    for (const [prep, kase] of Object.entries(SINGLE_CASE_PREPOSITIONS)) {
      expect(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'], prep).toContain(kase)
    }
  })

  it('leaves out the prepositions whose case carries meaning', () => {
    for (const prep of ['в', 'на', 'за', 'под', 'с', 'об']) {
      expect(SINGLE_CASE_PREPOSITIONS[prep], prep).toBeUndefined()
    }
  })
})
