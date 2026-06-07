import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TypeExercise from './TypeExercise.vue'

const exercise = {
  id: 'ex0',
  kind: 'type',
  dimension: 'usage',
  level: 'learning',
  content: 'word',
  audio: false,
  targets: ['дом=house'],
  ru: 'дом',
  en: 'house',
}

describe('TypeExercise', () => {
  it('shows the English cue and grades a correct answer', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.text()).toContain('house')

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')).toBeTruthy()
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('offers a retry on the first wrong answer, then reveals on the second', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    // First wrong attempt → retry hint shown, answer not yet revealed.
    expect(wrapper.text()).toContain('Not quite')
    expect(wrapper.text()).not.toContain('Answer:')

    // Second wrong attempt → answer revealed.
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Answer:')

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('accepts an alsoRu synonym as correct', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'автомобиль', alsoRu: ['маши́на'] } },
    })
    await wrapper.find('input[lang="ru"]').setValue('машина')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
  })

  it('ignores stress, case and ё/е when grading (hints never penalise)', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'всё' } },
    })
    await wrapper.find('input[lang="ru"]').setValue('ВСЕ')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
  })
})
