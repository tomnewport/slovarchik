import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import InflectExercise from './InflectExercise.vue'
import { keyboard, resetHint } from '../../stores/keyboard.js'
import { state as vocabState } from '../../stores/vocab.js'
import { buildParadigm } from '../../lib/paradigm.js'
import { loadFixtureWords } from '../../test/fixtures.js'

vi.mock('../../lib/speech.js', () => ({ speak: vi.fn(), speechSupported: () => false }))

// Any real word with a paradigm will do for the keyboard variant.
let word

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  word = vocabState.words.find((w) => {
    try {
      return buildParadigm(w) != null
    } catch {
      return false
    }
  })
})

afterEach(() => resetHint())

function keyboardExercise() {
  return { id: 'ex1', kind: 'inflect', mode: 'keyboard', wordKey: word.key, lemma: word.ru }
}

async function fillTable(wrapper, correct = true) {
  for (const input of wrapper.findAll('input.ending-input')) {
    await input.setValue(correct ? (input.attributes('data-answer') ?? '') : 'ыыы')
  }
}

describe('InflectExercise', () => {
  it('auto-passes (does not soft-lock) when no paradigm is available', async () => {
    const saved = vocabState.words
    vocabState.words = [] // the word key resolves to nothing → no paradigm
    const wrapper = mount(InflectExercise, {
      props: { exercise: { id: 'ex0', kind: 'inflect', mode: 'bank', wordKey: 'missing', lemma: 'нет' } },
    })
    expect(wrapper.text()).toContain('No inflection table')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: false })
    vocabState.words = saved
  })

  it('withholds the keyboard hint for the first unaided try in keyboard mode', () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    expect(keyboard.allowed).toBe(false)
    wrapper.unmount()
    // Restored on leave so the next exercise's keyboard isn't left locked.
    expect(keyboard.allowed).toBe(true)
  })

  it('counts a table typed correctly without the hint double, with a 🔥 burst', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // Check
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: true })
  })

  it('unlocks the hint after a wrong first check and grades the retry', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    await fillTable(wrapper, false)
    await wrapper.find('.row button.primary').trigger('click') // first check → retry
    expect(wrapper.text()).toContain('Not quite')
    expect(keyboard.allowed).toBe(true)
    expect(wrapper.find('button.next').exists()).toBe(false) // not yet graded

    keyboard.on = true // the learner reaches for the hint on the aided retry
    await wrapper.vm.$nextTick()
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // second check grades
    await wrapper.find('button.next').trigger('click')
    // Correct on the retry, but the hint was used → full (single) credit only.
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: false })
  })

  it('does not count a hint-assisted first-try success double', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    // The hint is withheld, but flipping it on (e.g. unlocked mid-exercise by a
    // retry elsewhere) must still cancel the double credit.
    keyboard.allowed = true
    keyboard.on = true
    await wrapper.vm.$nextTick()
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, double: false })
  })
})
