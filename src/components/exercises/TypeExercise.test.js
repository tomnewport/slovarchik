import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TypeExercise from './TypeExercise.vue'
import { keyboard, resetHint } from '../../stores/keyboard.js'

afterEach(() => resetHint())

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
    // Correct without touching the hint → counts double, with a 🔥 burst.
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: true, wordCorrect: true })
  })

  it('fires a burst and counts double when correct without the hint', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: true, wordCorrect: true })
  })

  it('does not count double (or burst) once the hint has been switched on', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    keyboard.on = true // learner reaches for the hint
    await wrapper.vm.$nextTick()

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: false, wordCorrect: true })
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
    // A word (no targetTokens): the slip is necessarily in the word, so it is
    // penalised — wordCorrect mirrors the failed grade.
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false, double: false, wordCorrect: false })
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

  // Collateral-damage guard for phrase spelling: a phrase carries targetTokens
  // naming the word being assessed, so a slip elsewhere doesn't penalise the word.
  const phrase = {
    ...exercise,
    content: 'phrase',
    targets: ['школа=school'],
    ru: 'я иду в школу',
    en: 'I am going to school',
    targetTokens: ['школу'],
  }

  it('reports the phrase wrong but the word right when the slip is elsewhere', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // Mis-spell a different word ("ыду") but spell the assessed word correctly.
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click') // first wrong → retry
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click') // second wrong → revealed

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      double: false,
      wordCorrect: true,
    })
  })

  it('reports both the phrase and the word wrong when the slip is in the word', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      double: false,
      wordCorrect: false,
    })
  })
})
