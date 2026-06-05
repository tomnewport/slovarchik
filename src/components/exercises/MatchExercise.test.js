import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// shuffle is identity-friendly here; stub speech so jsdom doesn't choke on TTS.
vi.mock('../../lib/speech.js', () => ({ speak: vi.fn() }))

import MatchExercise from './MatchExercise.vue'

const exercise = {
  id: 'm0',
  kind: 'match',
  dimension: 'identification',
  level: 'learning',
  audio: false,
  pairs: [
    { key: 'a', ru: 'весна', en: 'spring' },
    { key: 'b', ru: 'месяц', en: 'month' },
  ],
  targets: ['a', 'b'],
}

// Locate a tile by its visible text in a given column (0 = Russian, 1 = English).
function tile(wrapper, col, text) {
  const buttons = wrapper.findAll('.col')[col].findAll('button')
  return buttons.find((b) => b.text() === text)
}

describe('MatchExercise', () => {
  it('flashes only the two tapped tiles on a wrong pairing, not their partners', async () => {
    const wrapper = mount(MatchExercise, { props: { exercise } })

    await tile(wrapper, 0, 'весна').trigger('click') // Russian "весна" (key a)
    await tile(wrapper, 1, 'month').trigger('click') // English "month" (key b) — mismatch

    expect(tile(wrapper, 0, 'весна').classes()).toContain('flash')
    expect(tile(wrapper, 1, 'month').classes()).toContain('flash')
    // The corresponding partners share the same keys but must stay un-flashed.
    expect(tile(wrapper, 0, 'месяц').classes()).not.toContain('flash')
    expect(tile(wrapper, 1, 'spring').classes()).not.toContain('flash')
  })

  it('reports only the mismatched words as wrong', async () => {
    const wrapper = mount(MatchExercise, { props: { exercise } })

    await tile(wrapper, 0, 'весна').trigger('click')
    await tile(wrapper, 1, 'month').trigger('click') // wrong: a vs b
    // Now clear the board with correct matches (autocompletes at 80%).
    await tile(wrapper, 0, 'весна').trigger('click')
    await tile(wrapper, 1, 'spring').trigger('click')
    await tile(wrapper, 0, 'месяц').trigger('click')
    await tile(wrapper, 1, 'month').trigger('click')

    await wrapper.find('button.next').trigger('click')
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect([...payload.wrong].sort()).toEqual(['a', 'b'])
  })
})
