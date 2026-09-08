import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { state as progress } from '../stores/progress.js'
import { state as vocabState } from '../stores/vocab.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const { default: ProgressView } = await import('./ProgressView.vue')

function masteredRecord(word, ts) {
  const events = []
  for (const d of ['identification', 'usage', 'hearing']) {
    for (let i = 0; i < 3; i++) events.push({ dimension: d, level: 'learning', correct: true, ts })
  }
  for (let i = 0; i < 3; i++) events.push({ dimension: 'speaking', level: 'learning', correct: true, ts })
  return { word, events, learnedAt: ts, masteredAt: ts, peak: 3 }
}
function learningRecord(word) {
  return { word, events: [{ dimension: 'usage', level: 'learning', correct: true, ts: 1 }], learnedAt: null, masteredAt: null, peak: 1 }
}

beforeEach(() => {
  progress.records = {}
  progress.activity = {}
  vocabState.words = []
  push.mockClear()
})

describe('ProgressView', () => {
  it('renders the words-known chart and an expandable learned list', async () => {
    vocabState.words = [{ key: 'дом=house', pos: 'noun', gender: 'm', hasInflections: false }]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const wrapper = mount(ProgressView)
    expect(wrapper.find('.line-learned').exists()).toBe(true)

    await wrapper.findAll('.toggle')[0].trigger('click') // Show learned
    expect(wrapper.find('.words').text()).toContain('дом=house')
    // A single history day draws a dot (a lone line has nothing to stroke).
    expect(wrapper.find('.dot-learned').exists()).toBe(true)
  })

  it('scales the chart with gridlines and labelled word and date axes', () => {
    // Anchored to now, so the span stays short however long after this is run.
    const june = Date.now() - 4 * 86400000
    vocabState.words = [{ key: 'дом=house', pos: 'noun', gender: 'm', hasInflections: false }]
    progress.records = {
      'дом=house': masteredRecord('дом=house', june),
      'кот=cat': masteredRecord('кот=cat', june + 3 * 86400000),
    }

    const wrapper = mount(ProgressView)
    const ticks = wrapper.findAll('.chart .tick').map((t) => t.text())
    // A word scale (0 at the baseline, up to the total) and a date scale.
    expect(ticks).toContain('0')
    expect(ticks).toContain('2')
    expect(ticks.some((t) => /^\d{1,2} [A-Z][a-z]{2}$/.test(t))).toBe(true)
    expect(wrapper.find('.axis-title').text()).toBe('words')
    expect(wrapper.findAll('.grid line').length).toBeGreaterThan(2)
    // Two days apart on a real time axis, so the line steps between them.
    expect(wrapper.find('.line-learned').attributes('d')).toMatch(/L.*L/)
    expect(wrapper.find('.area-learned').exists()).toBe(true)
  })

  it('renders the streak calendar with the current streak and coloured cells', async () => {
    const today = new Date()
    const key = (d) => {
      const dt = new Date(today)
      dt.setDate(today.getDate() - d)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    progress.activity = {
      [key(0)]: { count: 5, correct: 5, hue: 120 },
      [key(1)]: { count: 2, correct: 1, hue: 120 },
    }

    const wrapper = mount(ProgressView)
    expect(wrapper.find('.streak-card').exists()).toBe(true)
    // Two consecutive active days ending today → a 2-day streak.
    expect(wrapper.find('.streak-num').text()).toBe('2')
    expect(wrapper.find('.streak-now').classes()).toContain('lit')
    // At least one cell has been painted with an HSV colour.
    const painted = wrapper.findAll('.cal-cell').filter((c) => c.attributes('style')?.includes('background'))
    expect(painted.length).toBeGreaterThanOrEqual(2)
  })

  it('shows a coverage bar per CEFR level, with the mastered slice inside it', () => {
    vocabState.words = [
      { key: 'дом=house', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'кот=cat', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'год=year', pos: 'noun', gender: 'm', cefr: 'A2', hasInflections: false },
      { key: 'gloss=only', pos: 'noun', gender: 'm', cefr: 'B1', hasInflections: false, learnable: false },
    ]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const wrapper = mount(ProgressView)
    const rows = wrapper.findAll('.cefr-row')
    // A1 and A2 have learnable words; B1's only entry is gloss-only, so no bar.
    expect(rows.length).toBe(2)
    expect(rows[0].find('.cefr-level').text()).toBe('A1')
    expect(rows[0].find('.cefr-pct').text()).toBe('50%')
    expect(rows[0].find('.cefr-count').text()).toBe('1 / 2 learned, 1 mastered')
    expect(rows[0].find('.cefr-bar').attributes('aria-valuenow')).toBe('50')
    expect(rows[0].find('.learn-fill').attributes('style')).toContain('width: 50%')
    expect(rows[0].find('.master-fill').attributes('style')).toContain('width: 50%')
    // A2: nothing learned yet.
    expect(rows[1].find('.cefr-pct').text()).toBe('0%')
    expect(rows[1].find('.cefr-count').text()).toBe('0 / 1 learned')
  })

  it('lists weakest skills and launches a focused session on tap', async () => {
    const nouns = ['n0', 'n1', 'n2'].map((key) => ({ key, pos: 'noun', gender: 'm', hasInflections: false }))
    vocabState.words = nouns
    progress.records = Object.fromEntries(nouns.map((n) => [n.key, learningRecord(n.key)]))

    const wrapper = mount(ProgressView)
    const chips = wrapper.findAll('.chip')
    expect(chips.length).toBeGreaterThan(0)

    await chips[0].trigger('click')
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/session', query: expect.objectContaining({ type: 'standard' }) }),
    )
    expect(typeof push.mock.calls[0][0].query.focus).toBe('string')
  })
})
