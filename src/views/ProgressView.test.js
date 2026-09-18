import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import * as progressStore from '../stores/progress.js'
import { state as progress } from '../stores/progress.js'
import { state as vocabState } from '../stores/vocab.js'
import { dayKey } from '../lib/streak.js'

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
  progress.metWords = {}
  progress.learning = null
  progress.learningWishlist = []
  vocabState.partsDef = null
  vocabState.words = []
  localStorage.clear()
  push.mockClear()
})

describe('ProgressView', () => {
  it('renders the words-known chart and opens a known word from the combined list', async () => {
    vocabState.words = [{ key: 'дом=house', pos: 'noun', gender: 'm', hasInflections: false }]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const wrapper = mount(ProgressView)
    expect(wrapper.find('.line-learned').exists()).toBe(true)

    const row = wrapper.find('.explorer-row')
    expect(row.text()).toContain('дом')
    expect(row.text()).toContain('house')
    await row.trigger('click')
    expect(wrapper.find('.modal[aria-label="Word progress"]').exists()).toBe(true)
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
    expect(wrapper.find('.streak-stats').text()).toContain('Today5 / day')
    // At least one cell has been painted with an HSV colour.
    const painted = wrapper.findAll('.cal-cell').filter((c) => c.attributes('style')?.includes('background'))
    expect(painted.length).toBeGreaterThanOrEqual(2)
  })

  it('shows zero today even when the personal record was on another day, and updates as activity arrives', async () => {
    progress.activity = { '2025-01-01': { count: 12, correct: 10, hue: 40 } }
    const wrapper = mount(ProgressView)
    expect(wrapper.findAll('.streak-stats dd').map((n) => n.text())).toEqual(['1 days', '12 / day', '0 / day', '12'])
    progress.activity[dayKey(Date.now())] = { count: 3, correct: 3, hue: 40 }
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.streak-stats dd')[2].text()).toBe('3 / day')
  })

  it('searches unlearned and gloss-only words, and keeps a wishlist through remount', async () => {
    vocabState.words = [
      { key: 'кот=cat', ru: 'кот', headword: 'ко́т', meaning: 'cat', pos: 'noun' },
      { key: 'кошка=cat', ru: 'кошка', headword: 'ко́шка', meaning: 'cat', pos: 'noun', learnable: false },
    ]
    const wrapper = mount(ProgressView)
    await wrapper.find('input[type="search"]').setValue('cat')
    expect(wrapper.findAll('.explorer-item')).toHaveLength(2)
    await wrapper.find('.explorer-item .explorer-row').trigger('click')
    expect(wrapper.find('.modal[aria-label="Word progress"]').exists()).toBe(true)
    await wrapper.find('.modal-close').trigger('click')
    await wrapper.find('.wishlist-add').trigger('click')
    expect(wrapper.find('.wishlist').text()).toContain('ко́шка')
    expect(JSON.parse(localStorage.getItem('slovarchik:vocabulary-wishlist:v1'))).toHaveLength(1)
    wrapper.unmount()
    const remounted = mount(ProgressView)
    await remounted.vm.$nextTick()
    expect(remounted.find('.wishlist summary').text()).toContain('(1)')
  })

  it('lets a missing Russian word join the wishlist and opens a prefilled issue at checkout', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mount(ProgressView)
    await wrapper.find('input[type="search"]').setValue('ёжик')
    await wrapper.find('.request-word').trigger('click')
    await wrapper.find('.checkout').trigger('click')
    const url = new URL(open.mock.calls[0][0])
    expect(url.pathname).toBe('/tomnewport/slovarchik/issues/new')
    expect(url.searchParams.get('body')).toContain('ёжик')
    open.mockRestore()
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

  it('draws met-but-untaught words as a faint slice behind the learned one', () => {
    vocabState.words = [
      { key: 'дом=house', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'кот=cat', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'сон=sleep', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'год=year', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
    ]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }
    // Two more met in passing, never drilled.
    progress.metWords = { 'кот=cat': 1, 'сон=sleep': 1 }

    const row = mount(ProgressView).findAll('.cefr-row')[0]
    // 1 of 4 learned; 3 of 4 met (the learned one counts as met too).
    expect(row.find('.learn-fill').attributes('style')).toContain('width: 25%')
    expect(row.find('.met-fill').attributes('style')).toContain('width: 75%')
    expect(row.find('.cefr-count').text()).toBe('1 / 4 learned, 1 mastered, 3 met')
  })

  it('leaves the met count off when nothing has been met beyond what is learned', () => {
    vocabState.words = [
      { key: 'дом=house', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
      { key: 'кот=cat', pos: 'noun', gender: 'm', cefr: 'A1', hasInflections: false },
    ]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const row = mount(ProgressView).findAll('.cefr-row')[0]
    expect(row.find('.cefr-count').text()).toBe('1 / 2 learned, 1 mastered')
  })

  it('shows one bar per curriculum part once the parts have loaded', () => {
    vocabState.words = [
      { key: 'дом=house', pos: 'noun', gender: 'm', cefr: 'A2', collections: ['home'], hasInflections: false },
      { key: 'кот=cat', pos: 'noun', gender: 'm', cefr: 'A2', collections: ['home'], hasInflections: false },
      { key: 'год=year', pos: 'noun', gender: 'm', cefr: 'A2', collections: ['time'], hasInflections: false },
    ]
    vocabState.partsDef = {
      parts: [
        { id: 'A2-1', level: 'A2', ordinal: 1, collections: ['home'] },
        { id: 'A2-2', level: 'A2', ordinal: 2, collections: ['time'] },
      ],
    }
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const wrapper = mount(ProgressView)
    const rows = wrapper.findAll('.cefr-row')
    expect(rows.length).toBe(2)
    expect(rows[0].find('.cefr-level').text()).toBe('A2 Part I')
    expect(rows[0].find('.cefr-count').text()).toBe('1 / 2 learned, 1 mastered')
    expect(rows[1].find('.cefr-level').text()).toBe('A2 Part II')
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

  it('queues a searched word, then adds it as a supplement to the current batch', async () => {
    globalThis.indexedDB = new IDBFactory()
    idb._resetForTests()
    await progressStore.resetProgress()
    await progressStore.loadProgress()
    vocabState.words = [
      { key: 'кот=cat', ru: 'кот', headword: 'ко́т', meaning: 'cat', pos: 'noun', cefr: 'A1' },
      { key: 'дом=house', ru: 'дом', headword: 'до́м', meaning: 'house', pos: 'noun', cefr: 'A1' },
    ]

    const wrapper = mount(ProgressView)
    await wrapper.find('input[type="search"]').setValue('cat')
    expect(progress.loaded).toBe(true)
    expect(progressStore.stateOf('кот=cat')).toBe('unknown')
    expect(wrapper.find('.explorer-actions .next-batch').attributes('aria-pressed')).toBe('false')
    await wrapper.find('.explorer-actions .next-batch').trigger('click')
    await vi.waitFor(() => expect(progress.learningWishlist).toEqual(['кот=cat']))
    await flushPromises()
    expect(wrapper.find('.learning-wishlist summary').text()).toContain('(1)')

    await progressStore.commitBatch({ level: 'learning', name: 'home', words: ['дом=house'], size: 1 })
    await wrapper.findAll('.explorer-actions button').find((button) => button.text() === '+ Current batch').trigger('click')
    await vi.waitFor(() => expect(progress.learningWishlist).toEqual([]))
    await flushPromises()
    expect(progress.learning.words).toEqual(['дом=house', 'кот=cat'])
    expect(progress.learning.size).toBe(2)
    expect(wrapper.find('.explorer-actions .next-batch').exists()).toBe(false)
  })
})
