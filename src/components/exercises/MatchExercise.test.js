import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub speech so jsdom doesn't choke on TTS. The component shuffles each
// column with the real `shuffle`, so the assertions below are order-independent.
vi.mock('../../lib/speech.js', () => ({ speak: vi.fn() }))

import { speak } from '../../lib/speech.js'
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

const audioExercise = { ...exercise, audio: true }

// Locate a tile by its visible text in a given column (0 = Russian, 1 = English).
function tile(wrapper, col, text) {
  const buttons = wrapper.findAll('.col')[col].findAll('button')
  return buttons.find((b) => b.text() === text)
}

describe('MatchExercise', () => {
  it('audio mode: tiles show only the speaker icon and have an aria-label', () => {
    const wrapper = mount(MatchExercise, { props: { exercise: audioExercise } })
    const ruTiles = wrapper.findAll('.col')[0].findAll('button')
    // No Russian text rendered — only the icon span with aria-hidden.
    expect(ruTiles[0].find('span[lang="ru"]').exists()).toBe(false)
    expect(ruTiles[0].find('span[aria-hidden="true"]').exists()).toBe(true)
    // Accessible name comes from aria-label, not visible text. The column is
    // shuffled, so compare the full set rather than a positional match.
    const labels = ruTiles.map((t) => t.attributes('aria-label')).sort()
    expect(labels).toEqual(exercise.pairs.map((p) => p.ru).sort())
  })

  it('audio mode: clicking the tile speaks and selects it', async () => {
    vi.clearAllMocks()
    const wrapper = mount(MatchExercise, { props: { exercise: audioExercise } })
    const ruTiles = wrapper.findAll('.col')[0].findAll('button')
    await ruTiles[0].trigger('click')
    expect(speak).toHaveBeenCalled()
    expect(ruTiles[0].classes()).toContain('picked')
  })

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

  it('accepts a cross-key match when both sides have identical English text', async () => {
    const dupeExercise = {
      ...exercise,
      pairs: [
        { key: 'doch', ru: 'дочь', en: 'daughter' },
        { key: 'dochka', ru: 'до́чка', en: 'daughter' },
      ],
      targets: ['doch', 'dochka'],
    }
    const wrapper = mount(MatchExercise, { props: { exercise: dupeExercise } })
    // Pick the Russian "дочь" then any "daughter" English tile — both are valid.
    await tile(wrapper, 0, 'дочь').trigger('click')
    await wrapper.findAll('.col')[1].findAll('button')[0].trigger('click')
    // At least дочь must be matched (the exercise accepted it).
    expect(wrapper.findAll('.col')[0].findAll('button.matched').length).toBeGreaterThanOrEqual(1)
  })

  it('reports only the mismatched words as wrong', async () => {
    const wrapper = mount(MatchExercise, { props: { exercise } })

    await tile(wrapper, 0, 'весна').trigger('click')
    await tile(wrapper, 1, 'month').trigger('click') // wrong: a vs b
    // Now clear the board with correct matches.
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
