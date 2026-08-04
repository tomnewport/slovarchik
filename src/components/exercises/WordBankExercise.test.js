import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WordBankExercise from './WordBankExercise.vue'

// Speech and feedback sounds are side effects we don't exercise here.
vi.mock('../../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))
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

describe('WordBankExercise alternate translations', () => {
  it('accepts a curated alternate rendering without an override (#145)', async () => {
    const wrapper = mount(WordBankExercise, {
      props: { exercise: { ...exercise, enAlt: ['This city is big'] } },
    })
    // Assemble the alternate word order from the same bank of tiles.
    for (const word of ['this', 'city', 'is', 'big']) {
      const tile = wrapper
        .findAll('.bank .tile')
        .find((b) => b.text().toLowerCase() === word && !b.attributes('disabled'))
      await tile.trigger('click')
    }
    await wrapper.find('button.check').trigger('click')

    expect(wrapper.text()).toContain('Correct')
    expect(wrapper.find('.dispute').exists()).toBe(false)
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })
})

// Assemble a valid reordering of the same words (not the curated order).
async function assembleReordering(wrapper) {
  for (const word of ['this', 'city', 'is', 'big']) {
    const tile = wrapper
      .findAll('.bank .tile')
      .find((b) => b.text().toLowerCase() === word && !b.attributes('disabled'))
    await tile.trigger('click')
  }
}

describe('WordBankExercise order-insensitive grading (#267)', () => {
  it('asks the learner to confirm a same-words reordering rather than auto-crediting', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')

    // Not graded outright: a confirmation prompt appears, no Correct/Answer yet.
    expect(wrapper.find('.confirm').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Correct')
    expect(wrapper.find('button.next').exists()).toBe(false)
  })

  it('credits the reordering when the learner confirms it', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')
    await wrapper.findAll('.confirm button').find((b) => b.text().includes('Yes')).trigger('click')

    expect(wrapper.find('.confirm').exists()).toBe(false)
    expect(wrapper.text()).toContain('Correct')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('marks the reordering wrong when the learner rejects it', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')
    await wrapper.findAll('.confirm button').find((b) => b.text().includes('No')).trigger('click')

    expect(wrapper.find('.confirm').exists()).toBe(false)
    expect(wrapper.text()).toContain('Answer:')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('reveals the heard sentence in the confirm step so a reordering can be checked (#408)', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise: { ...exercise, audio: true } } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')

    // The source sentence — only heard, never shown until now — is revealed so
    // the learner can judge whether their order still means the same thing.
    const source = wrapper.find('.confirm-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain(exercise.ru)
  })

  it('does not repeat the source in the confirm step when it is already shown (#408)', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')
    // In non-audio mode the Russian cue is already visible above, so no reveal.
    expect(wrapper.find('.confirm-source').exists()).toBe(false)
  })

  it('shows the default translation next to the answer so they can be compared (#513)', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleReordering(wrapper)
    await wrapper.find('button.check').trigger('click')

    // The confirm step lays out the learner's reordering and the canonical
    // translation side by side so the learner can judge whether they match.
    const compare = wrapper.find('.confirm-compare')
    expect(compare.exists()).toBe(true)
    // Tiles are lowercased, so the assembled answer and the canonical
    // translation both render in lower case here.
    expect(compare.text()).toContain('this city is big') // the reordering
    expect(compare.text()).toContain('this is a big city') // the default translation
  })

  it('passes an exact-order answer outright without confirmation', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleExpected(wrapper)
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.confirm').exists()).toBe(false)
    expect(wrapper.text()).toContain('Correct')
  })

  it('still rejects an answer using the wrong words', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    // Place only a single tile so the assembled answer is missing words.
    await wrapper.find('.bank .tile').trigger('click')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.confirm').exists()).toBe(false)
    expect(wrapper.text()).toContain('Answer:')
  })
})

describe('WordBankExercise type-ahead', () => {
  const press = (key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key }))

  it('types a prefix and places the matching tile with Enter', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    // Type "ci" to single out "city", then commit it with Enter.
    for (const ch of 'ci') press(ch)
    press('Enter')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.answer-line').text().toLowerCase()).toContain('city')
    wrapper.unmount()
  })

  it('ignores a keystroke that matches no available tile', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    press('z') // no English tile starts with "z"
    await wrapper.vm.$nextTick()
    // Nothing typed sticks, so the idle hint is still shown.
    expect(wrapper.find('.typeahead').text()).toContain('Tap a word')
    wrapper.unmount()
  })

  it('still places tiles by clicking', async () => {
    const wrapper = mount(WordBankExercise, { props: { exercise } })
    await assembleExpected(wrapper)
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
    wrapper.unmount()
  })
})

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
