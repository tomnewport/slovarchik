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

// Walk the selection grid by clicking the option whose label contains each
// of the given strings, in order (e.g. pickSelections(wrapper, 'Accusative',
// 'Singular') drives the case step then the number step).
async function pickSelections(wrapper, ...labels) {
  for (const label of labels) {
    const btn = wrapper.findAll('.case-btn').find((b) => b.text().includes(label))
    await btn.trigger('click')
  }
}

describe('PhraseFixExercise', () => {
  it('does not speak the sentence until the form is solved', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    expect(wrapper.text()).toContain('The girl caught a butterfly.')
    // Stage 1: still choosing case → number — nothing voiced yet.
    expect(speak).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Which case does the highlighted word need?')

    await pickSelections(wrapper, 'Accusative')
    // The number step appears next; still nothing voiced.
    expect(wrapper.text()).toContain('Is it singular or plural?')
    expect(speak).not.toHaveBeenCalled()
    await pickSelections(wrapper, 'Singular')
    // Stage 2: spelling — still nothing voiced.
    expect(speak).not.toHaveBeenCalled()

    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    // Solved → the full correct sentence is spoken exactly once.
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('Де́вочка пойма́ла ба́бочку.')
  })

  it('counts correct only when case, number and spelling are all right', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Plural') // right case, wrong number
    await wrapper.find('input[lang="ru"]').setValue('бабочку') // right spelling
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('makes clear when the spelling was right but the case was wrong', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Genitive', 'Singular') // wrong case, right number
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
    await pickSelections(wrapper, 'Accusative', 'Plural') // right case, wrong number
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
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
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

  it('shows no Exception badge for a regular rule', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    await pickSelections(wrapper, 'Accusative', 'Singular')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.exc-badge').exists()).toBe(false)
  })

  it('runs case then gender + number for adjectives, then spells', async () => {
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
    expect(wrapper.text()).toContain('Which case does the highlighted word need?')
    expect(speak).not.toHaveBeenCalled()
    await pickSelections(wrapper, 'Accusative')
    expect(wrapper.text()).toContain('Which gender / number must it agree with?')
    await pickSelections(wrapper, 'Feminine')
    expect(speak).not.toHaveBeenCalled()
    await wrapper.find('input[lang="ru"]').setValue('новую')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('Correct')
    expect(speak).toHaveBeenCalledWith('Я чита́ю но́вую кни́гу.')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
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
    // The reveal chip shows the correct accented form, stress intact.
    expect(wrapper.find('.feedback.bad').text()).toContain('меня́')
    // The inline slot reattaches the trailing full stop without doubling the mark.
    expect(wrapper.find('.phrase-line').text()).toContain('меня́.')
    expect(wrapper.find('.phrase-line').text()).not.toContain('меня́́')
  })

  it('skips the case step for verbs', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: verbExercise } })
    expect(wrapper.findAll('.case-btn')).toHaveLength(0)
    await wrapper.find('input[lang="ru"]').setValue('боюсь')
    await wrapper.find('form').trigger('submit')
    expect(speak).toHaveBeenCalledWith('Я бою́сь высоты́.')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })
})
