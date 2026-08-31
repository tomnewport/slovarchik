import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { state as progress } from '../stores/progress.js'
import { state as vocabState } from '../stores/vocab.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../stores/reports.js', () => ({
  state: { pending: [], loaded: true },
  loadReports: vi.fn(),
  removeReport: vi.fn(),
}))

const { default: HomeView } = await import('./HomeView.vue')

beforeEach(() => {
  vocabState.words = []
  progress.records = {}
  progress.learning = null
  progress.mastery = null
  push.mockClear()
})

describe('HomeView', () => {
  it('redirects to batch selection (carrying the session intent) when starting a session with no batch', async () => {
    const wrapper = mount(HomeView)
    await wrapper.find('.size.quick').trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/batch',
      query: { level: 'learning', next: 'session', type: 'standard', size: 'quick' },
    })
  })

  it('carries a focused session intent through batch selection', async () => {
    const wrapper = mount(HomeView)
    await wrapper.findAll('.focus-btn')[0].trigger('click') // Speaking
    expect(push).toHaveBeenCalledWith({
      path: '/batch',
      query: { level: 'learning', next: 'session', type: 'speaking' },
    })
  })

  it('launches the three standard session sizes once a batch is set', async () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    await wrapper.find('.size.quick').trigger('click')
    await wrapper.find('.size.normal').trigger('click')
    await wrapper.find('.size.super').trigger('click')
    expect(push).toHaveBeenNthCalledWith(1, { path: '/session', query: { type: 'standard', size: 'quick' } })
    expect(push).toHaveBeenNthCalledWith(2, { path: '/session', query: { type: 'standard', size: 'normal' } })
    expect(push).toHaveBeenNthCalledWith(3, { path: '/session', query: { type: 'standard', size: 'super' } })
  })

  it('launches each focused session type once a batch is set', async () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    const buttons = wrapper.findAll('.focus-btn')
    expect(buttons).toHaveLength(5)
    await buttons[0].trigger('click') // Speaking
    expect(push).toHaveBeenCalledWith({ path: '/session', query: { type: 'speaking' } })
  })

  it('prompts to choose a learning batch when none is set', async () => {
    const wrapper = mount(HomeView)
    const card = wrapper.find('.choose-batch')
    expect(card.element.tagName).toBe('BUTTON')
    expect(card.text()).toContain('Choose words to learn')
    await card.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/batch', query: { level: 'learning' } })
  })

  it('links to the standalone free-practice drills', async () => {
    const wrapper = mount(HomeView)
    const drills = wrapper.findAll('.drill')
    expect(drills.length).toBe(11)
    await drills[0].trigger('click') // Vocabulary
    expect(push).toHaveBeenCalledWith('/vocab')
  })

  it('shows the committed batch name as a non-clickable card', () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    const card = wrapper.find('.batches-card')
    expect(card.element.tagName).toBe('DIV')
    expect(card.text()).toContain('animals')
  })

  it('renders the exercise-progress bar at the top of each batch', () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    progress.mastery = { name: 'Random', level: 'mastery', words: [], size: 10 }
    const wrapper = mount(HomeView)
    const bars = wrapper.findAll('.exercise-bar')
    expect(bars).toHaveLength(2)
    // The exercise bar precedes the words-done bar within its row.
    const firstRow = wrapper.find('.batch-row')
    const children = [...firstRow.element.children].map((el) => el.className)
    expect(children[0]).toContain('exercise-bar')
  })

  it('visibly distinguishes both members of an aspect pair in the batch list', () => {
    vocabState.words = [
      {
        key: 'сшить=to sew',
        headword: 'сши́ть',
        english: ['to sew'],
        pos: 'verb',
        aspect: 'pf',
        aspectPair: { key: 'шить=to sew' },
      },
      {
        key: 'шить=to sew',
        headword: 'ши́ть',
        english: ['to sew'],
        pos: 'verb',
        aspect: 'impf',
        aspectPair: { key: 'сшить=to sew' },
      },
    ]
    progress.learning = {
      name: 'sewing',
      level: 'learning',
      words: ['сшить=to sew', 'шить=to sew'],
      size: 2,
    }

    const wrapper = mount(HomeView)
    const rows = wrapper.find('.word-list-card')
    const glosses = rows.findAll('.word-en').map((node) => node.text())
    // Abbreviated in the row, which shares its width with the dimension pips;
    // the hover title (and the word card) still says it in full.
    expect(glosses).toEqual(['to sew (pf.)', 'to sew (impf.)'])
    expect(rows.findAll('.word-label').map((node) => node.attributes('title'))).toEqual([
      'to sew (perfective)',
      'to sew (imperfective)',
    ])
  })

  it('flags the unmet skills on a slipped word with a missing badge', () => {
    // A word that reached "learned" (peak 2) but whose attempts now only place
    // it back at "learning" shows up under Slipped. Its not-yet-recovered
    // dimensions should be marked so the learner sees what to practise.
    progress.records = {
      'кот=cat': {
        word: 'кот=cat',
        events: [{ dimension: 'identification', level: 'learning', correct: true, ts: 1 }],
        learnedAt: null,
        masteredAt: null,
        peak: 2,
      },
    }
    const wrapper = mount(HomeView)
    const card = wrapper.find('.slipped-card')
    expect(card.exists()).toBe(true)
    // At least one dimension is missing, and missing pips carry the badge class.
    const missing = card.findAll('.dim-missing')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing[0].classes()).toContain('dim-pip')
  })

  it('shows mastery batch only when a mastery batch is active', () => {
    const wrapper = mount(HomeView)
    expect(wrapper.find('.master-kind').exists()).toBe(false)

    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    progress.mastery = { name: 'Random', level: 'mastery', words: [], size: 10 }
    const wrapper2 = mount(HomeView)
    expect(wrapper2.find('.master-kind').exists()).toBe(true)
    expect(wrapper2.find('.batches-card').text()).toContain('Random')
  })
})
