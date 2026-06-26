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
  displayTokens: ['Де́вочка', 'пойма́ла', 'ба́бочка.'],
  targetIndex: 2,
  lemma: 'ба́бочка',
  answerAccented: 'ба́бочку',
  answer: 'бабочку',
  caseOptions: [
    { case: 'nom', label: 'Nominative', hint: 'who / what', correct: false },
    { case: 'acc', label: 'Accusative', hint: 'whom / what', correct: true },
    { case: 'gen', label: 'Genitive', hint: 'of', correct: false },
  ],
  correctCase: 'acc',
  number: 'sg',
  slotLabel: 'Singular · Accusative',
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
  caseOptions: [],
  correctCase: null,
  slotLabel: 'Present · I',
  ru: 'Я бою́сь высоты́.',
  en: 'I am afraid of heights.',
  rule: null,
  targets: ['бояться=to be afraid'],
}

beforeEach(() => speak.mockClear())

describe('PhraseFixExercise', () => {
  it('does not speak the sentence until the form is solved', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    expect(wrapper.text()).toContain('The girl caught a butterfly.')
    // Step 1: still choosing the case — nothing voiced yet.
    expect(speak).not.toHaveBeenCalled()

    const accBtn = wrapper.findAll('.case-btn').find((b) => b.text().includes('Accusative'))
    await accBtn.trigger('click')
    // Step 2: spelling — still nothing voiced.
    expect(speak).not.toHaveBeenCalled()

    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    // Solved → the full correct sentence is spoken exactly once.
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('Де́вочка пойма́ла ба́бочку.')
  })

  it('counts correct only when both case and spelling are right', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    const genBtn = wrapper.findAll('.case-btn').find((b) => b.text().includes('Genitive'))
    await genBtn.trigger('click') // wrong case
    await wrapper.find('input[lang="ru"]').setValue('бабочку') // right spelling
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('grades leniently (stress/ё) and reveals the rule', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    const accBtn = wrapper.findAll('.case-btn').find((b) => b.text().includes('Accusative'))
    await accBtn.trigger('click')
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
    const accBtn = wrapper.findAll('.case-btn').find((b) => b.text().includes('Accusative'))
    await accBtn.trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.exc-badge').exists()).toBe(true)
    expect(wrapper.find('details.rule.exception').exists()).toBe(true)
  })

  it('shows no Exception badge for a regular rule', async () => {
    const wrapper = mount(PhraseFixExercise, { props: { exercise: nounExercise } })
    const accBtn = wrapper.findAll('.case-btn').find((b) => b.text().includes('Accusative'))
    await accBtn.trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('бабочку')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.exc-badge').exists()).toBe(false)
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
