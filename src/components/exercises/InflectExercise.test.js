import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import InflectExercise from './InflectExercise.vue'
import { state as vocabState } from '../../stores/vocab.js'

describe('InflectExercise', () => {
  it('auto-passes (does not soft-lock) when no paradigm is available', async () => {
    vocabState.words = [] // the word key resolves to nothing → no paradigm
    const wrapper = mount(InflectExercise, {
      props: { exercise: { id: 'ex0', kind: 'inflect', mode: 'bank', wordKey: 'missing', lemma: 'нет' } },
    })
    expect(wrapper.text()).toContain('No inflection table')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })
})
