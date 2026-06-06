import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WordBankExercise from './WordBankExercise.vue'

// Speech and feedback sounds are side effects we don't exercise here.
vi.mock('../../lib/speech.js', () => ({ speak: vi.fn() }))
vi.mock('../../stores/settings.js', () => ({ playFeedback: vi.fn() }))

const exercise = {
  id: 'ex0',
  kind: 'wordbank',
  dimension: 'usage',
  level: 'learning',
  content: 'phrase',
  audio: false,
  targets: ['го́род=city'],
  ru: 'Э́то большо́й го́род.',
  en: 'This is a big city',
}

// Place every tile that belongs to the target translation, in order.
async function assembleExpected(wrapper) {
  for (const word of exercise.en.toLowerCase().split(' ')) {
    const tile = wrapper
      .findAll('.bank .tile')
      .find((b) => b.text().toLowerCase() === word && !b.attributes('disabled'))
    await tile.trigger('click')
  }
}

describe('WordBankExercise honesty system', () => {
  it('does not offer the override when the answer is correct', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleExpected(wrapper)
    await wrapper.find('button.check').trigger('click')

    expect(wrapper.text()).toContain('Correct')
    expect(wrapper.find('.dispute').exists()).toBe(false)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('lets the learner override a wrong grade, crediting it and emitting dispute', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    // Place a single tile so the assembled answer is wrong.
    await wrapper.find('.bank .tile').trigger('click')
    const submitted = wrapper.find('.answer-line').text()
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Answer:')

    // The "I was right" action is offered only after a wrong grade.
    const override = wrapper.find('.dispute .link')
    expect(override.exists()).toBe(true)
    await override.trigger('click')

    // Grade flips to correct and a dispute is reported for curation.
    expect(wrapper.text()).toContain('Marked correct')
    expect(wrapper.emitted('dispute')).toBeTruthy()
    expect(wrapper.emitted('dispute')[0][0]).toEqual({ submitted })
    // Once overridden, the prompt is gone — no nagging.
    expect(wrapper.find('.dispute').exists()).toBe(false)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })
})
