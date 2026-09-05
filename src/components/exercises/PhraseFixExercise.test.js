import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const speak = vi.fn()
vi.mock('../../lib/speech.js', () => ({
  speak: (...a) => speak(...a),
  speechSupported: () => false,
}))
vi.mock('../../stores/settings.js', () => ({ playFeedback: vi.fn() }))

import PhraseFixExercise from './PhraseFixExercise.vue'

const nounExercise = {
  id: 'ex0',
  kind: 'phrase-fix',
  tokens: ['Де́вочка', 'пойма́ла', 'ба́бочку.'],
  targetIndex: 2,
  lemma: 'ба́бочка',
  answerAccented: 'ба́бочку',
  answer: 'бабочку',
  selectSteps: [
    {
      kind: 'case',
      prompt: 'Which case does the highlighted word need?',
      options: [
        { id: 'nom', label: 'Nominative', hint: 'who / what', correct: false },
        { id: 'acc', label: 'Accusative', hint: 'whom / what', correct: true },
        { id: 'gen', label: 'Genitive', hint: 'of', correct: false },
      ],
    },
    {
      kind: 'number',
      prompt: 'Is it singular or plural?',
      options: [
        { id: 'sg', label: 'Singular', correct: true },
        { id: 'pl', label: 'Plural', correct: false },
      ],
    },
  ],
  number: 'sg',
  slotLabel: 'Accusative · Singular',
  ru: 'Де́вочка пойма́ла ба́бочку.',
  en: 'The girl caught a butterfly.',
  rule: { id: 'noun-acc-sg', title: 'Accusative singular', formula: '-а → -у' },
  targets: ['бабочка=butterfly'],
}

const verbExercise = {
  id: 'ex1',
  kind: 'phrase-fix',
  tokens: ['Я', 'бою́сь', 'высоты́.'],
  targetIndex: 1,
  lemma: 'боя́ться',
  answerAccented: 'бою́сь',
  answer: 'боюсь',
  selectSteps: [],
  slotLabel: 'Present · I',
  ru: 'Я бою́сь высоты́.',
  en: 'I am afraid of heights.',
  rule: null,
  targets: ['бояться=to be afraid'],
}

beforeEach(() => speak.mockClear())

// The option button whose label contains `label`.
const optBtn = (wrapper, label) =>
  wrapper.findAll('.case-btn').find((b) => b.text().includes(label))

// Tap one option (graded the instant it's clicked).
async function pick(wrapper, label) {
  await optBtn(wrapper, label).trigger('click')
}

// Tap the CORRECT option in each group, in order, to reach the spelling stage.
async function pickSelections(wrapper, ...labels) {
  for (const label of labels) await pick(wrapper, label)
}

// Whether the spelling input is showing yet (i.e. selection is complete).
const spelling = (wrapper) => wrapper.find('input[lang="ru"]').exists()

describe('PhraseFixExercise', () => {
  it('shows every selection dimension on one board and does not speak until solved', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    expect(wrapper.text()).toContain('The girl caught a butterfly.')
    // Both the case and the number group are on the board together.
    expect(wrapper.text()).toContain('Which case does the highlighted word need?')
    expect(wrapper.text()).toContain('Is it singular or plural?')
    expect(speak).not.toHaveBeenCalled()

    // Spelling stays closed until every dimension is answered correctly.
    expect(spelling(wrapper)).toBe(false)

    await pickSelections(wrapper, 'Accusative', 'Singular')
    // Stage 2: spelling — still nothing voiced.
    expect(spelling(wrapper)).toBe(true)
    expect(speak).not.toHaveBeenCalled()

    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    // Solved → the full correct sentence is spoken exactly once.
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('Де́вочка пойма́ла ба́бочку.')
  })

  it('grades each pick immediately and only opens spelling once every dimension is right', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })

    // A wrong pick is flagged at once and does not advance.
    await pick(wrapper, 'Genitive')
    expect(optBtn(wrapper, 'Genitive').classes()).toContain('wrong')
    expect(spelling(wrapper)).toBe(false)

    // The correct pick locks its group green; the number is still open.
    await pick(wrapper, 'Accusative')
    expect(optBtn(wrapper, 'Accusative').classes()).toContain('correct')
    expect(spelling(wrapper)).toBe(false)

    await pick(wrapper, 'Singular')
    expect(spelling(wrapper)).toBe(true)

    // The early wrong case pick is remembered: spelling right, but still a miss.
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.feedback.warn').exists()).toBe(true)
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      wrong: ['бабочка=butterfly'],
    })
  })

  it('counts correct only when case, number and spelling are all right', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pick(wrapper, 'Accusative') // right case
    await pick(wrapper, 'Plural') // wrong number…
    await pick(wrapper, 'Singular') // …corrected, but the miss is recorded
    await wrapper.find('input[lang="ru"]').setValue('бабочку') // right spelling
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      wrong: ['бабочка=butterfly'],
    })
  })

  it('makes clear when the spelling was right but the case was wrong', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pick(wrapper, 'Genitive') // wrong case…
    await pick(wrapper, 'Accusative') // …corrected
    await pick(wrapper, 'Singular') // right number
    await wrapper.find('input[lang="ru"]').setValue('бабочку') // right spelling
    await wrapper.find('form').trigger('submit')
    // Not flagged as an outright miss — the spelling is acknowledged as correct…
    expect(wrapper.find('.feedback.bad').exists()).toBe(false)
    const feedback = wrapper.find('.feedback.warn')
    expect(feedback.exists()).toBe(true)
    expect(feedback.text()).toContain('Spelling right')
    expect(feedback.text()).toContain('wrong case')
    // …and it restates the slot the word actually needed (case first).
    expect(feedback.text()).toContain('Accusative · Singular')
    // The in-sentence form (the correct one) is warn-highlighted, not error-red.
    expect(wrapper.find('.phrase-line .mark-warn').exists()).toBe(true)
    expect(wrapper.find('.phrase-line .mark-err').exists()).toBe(false)
  })

  it('names the wrong number when only the number pick missed', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pick(wrapper, 'Accusative') // right case
    await pick(wrapper, 'Plural') // wrong number…
    await pick(wrapper, 'Singular') // …corrected
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    const feedback = wrapper.find('.feedback.warn')
    expect(feedback.text()).toContain('wrong number')
  })

  it('grades leniently (stress/ё) and reveals the rule', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('БАБОЧКУ') // stress-free, upper-case
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('Correct')
    expect(wrapper.text()).toContain('Accusative singular') // rule title shown
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  it('reveals what was typed against the correct form when the spelling is wrong', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочко') // wrong final vowel
    await wrapper.find('form').trigger('submit')
    // Both the learner's attempt and the correct form are shown for comparison.
    const diff = wrapper.find('.spell-diff')
    expect(diff.exists()).toBe(true)
    expect(diff.text()).toContain('бабочко') // what they typed
    expect(diff.text()).toContain('ба́бочку') // the correct, accented form
    // The differing letter is flagged on each row.
    expect(diff.findAll('.diff-text .off').length).toBeGreaterThan(0)
  })

  it('shows an Exception badge when the rule is flagged', async () => {
    const exEx = { ...nounExercise, exception: true, rule: { id: 'noun-acc-animate', title: 'Animate accusative' } }
    const wrapper = mount(PhraseFixExercise, { props: { exercise: exEx } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.exc-badge').exists()).toBe(true)
    expect(wrapper.find('details.rule.exception').exists()).toBe(true)
  })

  // #592: «два па́рка» is only intelligible beside «мно́го па́рков», so the reveal
  // offers the sibling — but closed, because showing both in full every time
  // would bury the one that actually applies.
  it('offers the sibling rule beside the one that applies, collapsed', async () => {
    const sibling = {
      ...nounExercise,
      rule: { id: 'noun-count-gen-sg', title: 'After two, three, four', formula: '2, 3, 4 + gen SG' },
      siblingRule: { id: 'noun-count-gen-pl', title: 'After five, and after много' },
    }
    const wrapper = mount(PhraseFixExercise, { props: { exercise: sibling } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')

    const blocks = wrapper.findAll('details.rule')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text()).toContain('After two, three, four')
    expect(blocks[0].attributes('open')).toBeDefined()
    expect(blocks[1].text()).toContain('After five, and after много')
    // Closed, and marked as the aside it is rather than as an exception.
    expect(blocks[1].attributes('open')).toBeUndefined()
    expect(blocks[1].find('.aside-badge').exists()).toBe(true)
    expect(wrapper.find('.exc-badge').exists()).toBe(false)
  })

  it('shows only the one rule when it names no sibling', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.findAll('details.rule')).toHaveLength(1)
    expect(wrapper.find('.aside-badge').exists()).toBe(false)
  })

  it('shows no Exception badge for a regular rule', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.exc-badge').exists()).toBe(false)
  })

  it('offers case and gender + number together for adjectives, then spells', async () => {
    const adj = {
      id: 'ex2', kind: 'phrase-fix',
      tokens: ['Я', 'чита́ю', 'но́вую', 'кни́гу.'],
      targetIndex: 2, lemma: 'но́вый', answerAccented: 'но́вую', answer: 'новую',
      selectSteps: [
        {
          kind: 'case',
          prompt: 'Which case does the highlighted word need?',
          options: [
            { id: 'nom', label: 'Nominative', correct: false },
            { id: 'acc', label: 'Accusative', correct: true },
          ],
        },
        {
          kind: 'gender',
          prompt: 'Which gender / number must it agree with?',
          options: [
            { id: 'm', label: 'Masculine', correct: false },
            { id: 'f', label: 'Feminine', correct: true },
            { id: 'pl', label: 'Plural', correct: false },
          ],
        },
      ],
      slotLabel: 'Accusative · Feminine',
      ru: 'Я чита́ю но́вую кни́гу.', en: 'I am reading a new book.',
      rule: { id: 'adj-agreement', title: 'Adjective agreement' }, targets: ['новый=new'],
    }
    const wrapper = mount(PhraseFixExercise, { props: { exercise: adj } })
    // Both dimensions are offered on the same board.
    expect(wrapper.text()).toContain('Which case does the highlighted word need?')
    expect(wrapper.text()).toContain('Which gender / number must it agree with?')
    expect(speak).not.toHaveBeenCalled()
    await pickSelections(wrapper, 'Accusative', 'Feminine')
    expect(speak).not.toHaveBeenCalled()
    await wrapper.find('input[lang="ru"]').setValue('новую')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('Correct')
    expect(speak).toHaveBeenCalledWith('Я чита́ю но́вую кни́гу.')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  it('keeps the stress mark on an end-stressed answer (reveal and inline slot)', async () => {
    // меня́ — accent on the final letter; the affix must not steal the mark, and
    // the inline slot must not double it.
    const endStressed = {
      ...verbExercise,
      tokens: ['Он', 'ждёт', 'меня́.'],
      targetIndex: 2,
      lemma: 'я',
      answerAccented: 'меня́',
      answer: 'меня',
      ru: 'Он ждёт меня́.',
      en: 'He is waiting for me.',
    }
    const wrapper = mount(PhraseFixExercise, { props: { exercise: endStressed } })
    await wrapper.find('input[lang="ru"]').setValue('хобана') // wrong on purpose
    await wrapper.find('form').trigger('submit')
    // The reveal shows the correct accented form, stress intact.
    expect(wrapper.find('.spell-diff').text()).toContain('меня́')
    // The inline slot reattaches the trailing full stop without doubling the mark.
    expect(wrapper.find('.phrase-line').text()).toContain('меня́.')
    expect(wrapper.find('.phrase-line').text()).not.toContain('меня́́')
  })

  it('skips the selection board for verbs', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: verbExercise } })
    expect(wrapper.findAll('.case-btn')).toHaveLength(0)
    await wrapper.find('input[lang="ru"]').setValue('боюсь')
    await wrapper.find('form').trigger('submit')
    expect(speak).toHaveBeenCalledWith('Я бою́сь высоты́.')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  // The choose-the-aspect drill: a verb with a linked aspect partner opens with
  // a pick between the two infinitives (see lib/phraseContext.js).
  const aspectExercise = {
    id: 'ex3',
    kind: 'phrase-fix',
    tokens: ['Он', 'сказа́л', 'пра́вду.'],
    targetIndex: 1,
    lemma: 'сказа́ть',
    lemmaOptions: ['говори́ть', 'сказа́ть'],
    answerAccented: 'сказа́л',
    answer: 'сказал',
    selectSteps: [
      {
        kind: 'contrast',
        dimension: 'aspect',
        label: 'aspect',
        prompt: 'Which verb does this sentence need?',
        options: [
          { id: 'impf', label: 'говори́ть', hint: 'imperfective — a process, habit or repeated action', correct: false },
          { id: 'pf', label: 'сказа́ть', hint: 'perfective — a single completed action or its result', correct: true },
        ],
      },
    ],
    slotLabel: 'Past · he (past)',
    ru: 'Он сказа́л пра́вду.',
    en: 'He said the truth.',
    rule: { id: 'verb-past', title: 'Past tense' },
    contrastRule: { id: 'verb-aspect', title: 'Aspect: imperfective or perfective?' },
    targets: ['сказать=to say'],
  }

  it('hides which aspect partner is correct until it is picked', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: aspectExercise } })
    expect(wrapper.text()).toContain('Which verb does this sentence need?')
    // The slot shows both candidate infinitives, not the answer.
    expect(wrapper.find('.target-btn').text()).toContain('говори́ть / сказа́ть')
    await pick(wrapper, 'сказа́ть')
    // Picked correctly → the slot collapses to the correct lemma for spelling.
    expect(wrapper.find('.target-btn').text()).not.toContain('говори́ть')
    await wrapper.find('input[lang="ru"]').setValue('сказал')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('Correct')
    // Both the slot rule and the aspect explanation are offered.
    expect(wrapper.text()).toContain('Past tense')
    expect(wrapper.text()).toContain('Aspect: imperfective or perfective?')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  it('flags a wrong aspect pick and names the verb it needed', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: aspectExercise } })
    await pick(wrapper, 'говори́ть') // wrong partner…
    expect(optBtn(wrapper, 'говори́ть').classes()).toContain('wrong')
    // …the slot must still not reveal which is correct.
    expect(wrapper.find('.target-btn').text()).toContain('говори́ть / сказа́ть')
    await pick(wrapper, 'сказа́ть') // …corrected
    await wrapper.find('input[lang="ru"]').setValue('сказал') // right spelling
    await wrapper.find('form').trigger('submit')
    const feedback = wrapper.find('.feedback.warn')
    expect(feedback.exists()).toBe(true)
    expect(feedback.text()).toContain('wrong aspect')
    expect(feedback.text()).toContain('сказа́ть')
    // The aspect explanation opens when the aspect choice missed.
    const aspectDetails = wrapper
      .findAll('details.rule')
      .find((d) => d.text().includes('Aspect: imperfective or perfective?'))
    expect(aspectDetails.attributes('open')).toBeDefined()
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      wrong: ['сказать=to say'],
    })
  })

  describe('sentence sets', () => {
    // A two-sentence set spanning two words, as built by exerciseBuild.
    const setExercise = {
      id: 'ex4',
      kind: 'phrase-fix',
      items: [nounExercise, verbExercise],
      targets: [...nounExercise.targets, ...verbExercise.targets],
    }

    it('walks the sentences in turn, keeping solved ones visible', async () => {
      const wrapper = mount(PhraseFixExercise, { props: { exercise: setExercise } })
      expect(wrapper.text()).toContain('Sentence 1 of 2')
      expect(wrapper.text()).toContain('The girl caught a butterfly.')

      await pickSelections(wrapper, 'Accusative', 'Singular')
      await wrapper.find('input[lang="ru"]').setValue('бабочку')
      await wrapper.find('form').trigger('submit')
      expect(speak).toHaveBeenCalledWith('Де́вочка пойма́ла ба́бочку.')
      // More sentences to come — the button says so and no done is emitted yet.
      const nextBtn = wrapper.find('button.next')
      expect(nextBtn.text()).toContain('Next sentence')
      await nextBtn.trigger('click')
      expect(wrapper.emitted('done')).toBeUndefined()

      // The solved sentence stays on screen; the second one is now active.
      expect(wrapper.text()).toContain('Sentence 2 of 2')
      expect(wrapper.find('.done-item.good').text()).toContain('Де́вочка пойма́ла ба́бочку.')
      expect(wrapper.text()).toContain('I am afraid of heights.')

      await wrapper.find('input[lang="ru"]').setValue('боюсь')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('button.next').trigger('click')
      expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
    })

    it('reports only the missed words in `wrong`', async () => {
      const wrapper = mount(PhraseFixExercise, { props: { exercise: setExercise } })
      // Miss the noun (wrong case, then corrected)…
      await pick(wrapper, 'Genitive')
      await pick(wrapper, 'Accusative')
      await pick(wrapper, 'Singular')
      await wrapper.find('input[lang="ru"]').setValue('бабочку')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('button.next').trigger('click')
      // …but get the verb right.
      await wrapper.find('input[lang="ru"]').setValue('боюсь')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('button.next').trigger('click')
      expect(wrapper.emitted('done')[0][0]).toEqual({
        correct: false,
        wrong: ['бабочка=butterfly'],
      })
    })
  })
})

// ── The facts panel (#586) ────────────────────────────────────────────────
describe('PhraseFixExercise word facts', () => {
  it('shows the drilled word only once its form is spelled and graded', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await pickSelections(wrapper, 'Accusative', 'Singular')
    // A `build` fact would spell the form out: still nothing at the spelling stage.
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')

    const facts = wrapper.findComponent({ name: 'WordFacts' })
    expect(facts.exists()).toBe(true)
    expect(facts.props('wordKey')).toBe('бабочка=butterfly')
  })
})

// #646 — when one rule accounts for the whole miss, say it. The reveal already
// carries the case's own explanation; this is the shorter thing to carry away,
// and it is about the *word*, not the case: a spelling convention, animacy, or
// a preposition that only ever takes one case.
describe('PhraseFixExercise — rule reminders', () => {
  // «без» + genitive, with the sugar paradigm the oracle reads the learner's
  // answer against.
  const saharParadigm = {
    key: 'сахар=sugar',
    pos: 'noun',
    lemma: 'са́хар',
    rows: [
      { key: 'nom', label: 'Nominative' },
      { key: 'gen', label: 'Genitive' },
      { key: 'acc', label: 'Accusative' },
    ],
    cols: [{ key: 'sg', label: 'Singular' }],
    cells: [
      { row: 'nom', col: 'sg', form: 'са́хар' },
      { row: 'gen', col: 'sg', form: 'са́хара' },
      { row: 'acc', col: 'sg', form: 'са́хар' },
    ],
    stem: 'сахар',
  }

  const bezSahara = {
    id: 'ex-prep',
    kind: 'phrase-fix',
    tokens: ['Я', 'пью', 'ко́фе', 'без', 'са́хара.'],
    targetIndex: 4,
    lemma: 'са́хар',
    answerAccented: 'са́хара',
    answer: 'сахара',
    selectSteps: [],
    slotLabel: 'Genitive · Singular',
    ru: 'Я пью ко́фе без са́хара.',
    en: 'I drink coffee without sugar.',
    rule: null,
    targets: ['сахар=sugar'],
    ruleContext: {
      paradigm: saharParadigm,
      wantCase: 'gen',
      animate: false,
      pos: 'noun',
      tokens: ['Я', 'пью', 'ко́фе', 'без', 'са́хара.'],
      targetIndex: 4,
    },
  }

  const answerWith = async (wrapper, value) => {
    await wrapper.find('input[lang="ru"]').setValue(value)
    await wrapper.find('form').trigger('submit')
  }

  it('names the preposition when another case of the right word was given', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: bezSahara } })
    await answerWith(wrapper, 'сахар')
    expect(wrapper.find('.rule-hint').text()).toContain('«без» always takes the genitive')
  })

  it('says nothing when the answer was right', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: bezSahara } })
    await answerWith(wrapper, 'сахара')
    expect(wrapper.find('.rule-hint').exists()).toBe(false)
  })

  it('says nothing about a plain misspelling — the character diff says more', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: bezSahara } })
    await answerWith(wrapper, 'сахра')
    expect(wrapper.find('.rule-hint').exists()).toBe(false)
  })

  it('names a spelling rule ahead of anything grammatical', async () => {
    const kniga = {
      ...bezSahara,
      id: 'ex-spell',
      tokens: ['Я', 'чита́ю', 'кни́ги.'],
      targetIndex: 2,
      lemma: 'кни́га',
      answerAccented: 'кни́ги',
      answer: 'книги',
      ru: 'Я чита́ю кни́ги.',
      en: 'I read books.',
      targets: ['книга=book'],
      ruleContext: null,
    }
    const wrapper = mount(PhraseFixExercise, { props: { exercise: kniga } })
    await answerWith(wrapper, 'книгы')
    expect(wrapper.find('.rule-hint').text()).toContain('seven-letter rule')
  })

  it('holds the reminder back until the answer is in', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: bezSahara } })
    expect(wrapper.find('.rule-hint').exists()).toBe(false)
  })

  it('copes with an exercise built before the oracle existed', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: { ...bezSahara, ruleContext: undefined } } })
    await answerWith(wrapper, 'сахар')
    expect(wrapper.find('.rule-hint').exists()).toBe(false)
  })
})
