import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const speak = vi.fn()
vi.mock('../../lib/speech.js', () => ({
  speak: (...a) => speak(...a),
  speechSupported: () => false,
}))
vi.mock('../../stores/settings.js', () => ({ playFeedback: vi.fn() }))

import VerbContrastExercise from './VerbContrastExercise.vue'

// A drill for the говори́ть / сказа́ть pair, as built by
// phraseContext.buildContrastDrill: English sentences from both partners, then
// one conjugated form to spell.
const exercise = {
  id: 'ex0',
  kind: 'verb-contrast',
  options: [
    { id: 'impf', label: 'говори́ть', hint: 'imperfective — a process, habit or repeated action' },
    { id: 'pf', label: 'сказа́ть', hint: 'perfective — a single completed action or its result' },
  ],
  items: [
    { id: 'a0', en: 'He speaks Russian every day.', ru: 'Он говори́т по-ру́сски ка́ждый день.', answer: 'impf' },
    { id: 'a1', en: 'She said the truth.', ru: 'Она́ сказа́ла пра́вду.', answer: 'pf' },
    { id: 'a2', en: 'They were talking all evening.', ru: 'Они́ говори́ли весь ве́чер.', answer: 'impf' },
    { id: 'a3', en: 'Tell me, please, where the station is.', ru: 'Скажи́те, пожа́луйста, где вокза́л.', answer: 'pf' },
  ],
  spell: {
    id: 'sp0',
    kind: 'phrase-fix',
    tokens: ['Он', 'сказа́л', 'пра́вду.'],
    targetIndex: 1,
    lemma: 'сказа́ть',
    lemmaOptions: null,
    answerAccented: 'сказа́л',
    answer: 'сказал',
    selectSteps: [],
    slotLabel: 'Past · he (past)',
    ru: 'Он сказа́л пра́вду.',
    en: 'He said the truth.',
    rule: { id: 'verb-past', title: 'Past tense' },
    contrastRule: { id: 'verb-aspect', title: 'Aspect: imperfective or perfective?' },
    targets: ['сказать=to say'],
  },
  contrastRule: { id: 'verb-aspect', title: 'Aspect: imperfective or perfective?' },
  targets: ['сказать=to say'],
}

beforeEach(() => speak.mockClear())

// The row for the i-th sentence, and a click on the option labelled `label`.
async function answer(wrapper, i, label) {
  const row = wrapper.findAll('.item')[i]
  const btn = row.findAll('.pair-btn').find((b) => b.text().includes(label))
  await btn.trigger('click')
}

async function answerAll(wrapper, ...labels) {
  for (const [i, label] of labels.entries()) await answer(wrapper, i, label)
}

describe('VerbContrastExercise', () => {
  it('lists every English sentence with the two infinitives to pick from', () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    expect(wrapper.text()).toContain('Which verb does each sentence need?')
    const rows = wrapper.findAll('.item')
    expect(rows).toHaveLength(4)
    for (const [i, item] of exercise.items.entries()) {
      expect(rows[i].text()).toContain(item.en)
      // The Russian sentence is hidden until the pick is made.
      expect(rows[i].text()).not.toContain(item.ru)
      const labels = rows[i].findAll('.pair-btn').map((b) => b.text())
      expect(labels).toEqual(['говори́ть', 'сказа́ть'])
    }
    // The pair legend explains both aspects up front.
    expect(wrapper.text()).toContain('a process, habit or repeated action')
    expect(wrapper.text()).toContain('a single completed action or its result')
  })

  it('grades each pick at once, reveals and speaks the Russian sentence', async () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    await answer(wrapper, 0, 'говори́ть') // right
    let row = wrapper.findAll('.item')[0]
    expect(row.find('.verdict.good').exists()).toBe(true)
    expect(row.text()).toContain('Он говори́т по-ру́сски ка́ждый день.')
    expect(speak).toHaveBeenCalledWith('Он говори́т по-ру́сски ка́ждый день.')

    await answer(wrapper, 1, 'говори́ть') // wrong — it needed сказа́ть
    row = wrapper.findAll('.item')[1]
    expect(row.find('.verdict.bad').exists()).toBe(true)
    expect(row.text()).toContain('it needed')
    expect(row.text()).toContain('сказа́ть')
    // A row can only be answered once.
    expect(row.findAll('.pair-btn')).toHaveLength(0)
  })

  it('moves to the spelling stage only after every sentence is answered', async () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    expect(wrapper.find('.to-spell').exists()).toBe(false)
    await answerAll(wrapper, 'говори́ть', 'сказа́ть', 'говори́ть')
    expect(wrapper.find('.to-spell').exists()).toBe(false) // one still open
    await answer(wrapper, 3, 'сказа́ть')
    expect(wrapper.find('.feedback.good').text()).toContain('All 4 right')
    await wrapper.find('.to-spell').trigger('click')
    // The embedded spelling stage (the shared phrase-fix renderer) appears.
    expect(wrapper.find('input[lang="ru"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('He said the truth.')
  })

  it('is correct only when every pick and the spelling are right', async () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    await answerAll(wrapper, 'говори́ть', 'сказа́ть', 'говори́ть', 'сказа́ть')
    await wrapper.find('.to-spell').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('сказал')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('fails the exercise when an aspect pick was missed, even if spelled right', async () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    await answerAll(wrapper, 'сказа́ть', 'сказа́ть', 'говори́ть', 'сказа́ть') // first is wrong
    expect(wrapper.find('.feedback.bad').text()).toContain('1 of 4 missed')
    await wrapper.find('.to-spell').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('сказал')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('fails the exercise when the spelling was wrong', async () => {
    const wrapper = mount(VerbContrastExercise, { props: { exercise } })
    await answerAll(wrapper, 'говори́ть', 'сказа́ть', 'говори́ть', 'сказа́ть')
    await wrapper.find('.to-spell').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('сказали') // wrong form
    await wrapper.find('form').trigger('submit')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })
})
