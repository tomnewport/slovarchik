import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mockPush }) }))

const { default: DataView } = await import('./DataView.vue')

// importData chains several IndexedDB transactions, each resolving on its own
// macrotask, so drain a handful of ticks.
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

// Like settle() but keeps draining ticks until `ready()` is true (or a generous
// cap is hit). The import chain's transaction count isn't fixed, so a hard tick
// count is racy under CI load — wait for the observable result instead.
const settleUntil = async (ready) => {
  for (let i = 0; i < 100 && !ready(); i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = [{ key: 'w0', pos: 'noun', hasInflections: false }]
  mockPush.mockClear()
  await progress.resetProgress()
  await progress.loadProgress()
})

describe('DataView', () => {
  it('exports valid, parseable backup JSON', async () => {
    const wrapper = mount(DataView)
    await settle()
    const json = wrapper.find('textarea.json').element.value
    const parsed = JSON.parse(json)
    expect(parsed.app).toBe('slovarchik')
    expect(Array.isArray(parsed.records)).toBe(true)
  })

  it('reports an error for invalid import JSON', async () => {
    const wrapper = mount(DataView)
    await settle()
    await wrapper.findAll('textarea')[1].setValue('not json{')
    await wrapper.find('.do-import').trigger('click')
    await settleUntil(() => wrapper.find('.status.no').exists())
    expect(wrapper.find('.status.no').exists()).toBe(true)
  })

  it('imports a valid backup and restores progress', async () => {
    // Build a backup with one mastered word, then wipe and import it.
    await progress.recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    for (const d of ['identification', 'hearing']) {
      for (let i = 0; i < 3; i++) await progress.recordAttempt({ word: 'w0', dimension: d, level: 'learning', correct: true })
    }
    for (let i = 0; i < 2; i++) await progress.recordAttempt({ word: 'w0', dimension: 'usage', level: 'learning', correct: true })
    for (let i = 0; i < 3; i++) await progress.recordAttempt({ word: 'w0', dimension: 'speaking', level: 'learning', correct: true })
    const backup = JSON.stringify(progress.exportData())
    await progress.resetProgress()
    expect(progress.stateOf('w0')).toBe('unknown')

    const wrapper = mount(DataView)
    await settle()
    await wrapper.findAll('textarea')[1].setValue(backup)
    await wrapper.find('.do-import').trigger('click')
    await settleUntil(() => wrapper.find('.status.ok').exists())

    expect(wrapper.find('.status.ok').exists()).toBe(true)
    expect(progress.stateOf('w0')).toBe('mastered')
  })

  it('requires confirmation before resetting and navigates home', async () => {
    await progress.recordAttempt({ word: 'w0', dimension: 'identification', level: 'learning', correct: true })
    expect(Object.keys(progress.state.records).length).toBe(1)

    const wrapper = mount(DataView)
    await settle()

    // First click reveals the confirm button
    await wrapper.find('.reset-btn').trigger('click')
    expect(wrapper.find('.reset-confirm').exists()).toBe(true)
    expect(wrapper.find('.reset-btn').exists()).toBe(false)

    // Confirm click wipes progress and pushes home
    await wrapper.find('.reset-confirm').trigger('click')
    await settle()

    expect(Object.keys(progress.state.records).length).toBe(0)
    expect(progress.state.firstUseAt).toBeNull()
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('cancel on reset confirm restores the initial button', async () => {
    const wrapper = mount(DataView)
    await settle()
    await wrapper.find('.reset-btn').trigger('click')
    await wrapper.find('.reset-cancel').trigger('click')
    expect(wrapper.find('.reset-btn').exists()).toBe(true)
    expect(wrapper.find('.reset-confirm').exists()).toBe(false)
  })

  it('shows cached dictionary update dates', async () => {
    await idb.putFile({ file: 'nouns.yml', pos: 'noun', updated: '2026-06-01T00:00:00Z', content: 'words: {}' })
    const wrapper = mount(DataView)
    await settle()
    expect(wrapper.find('.dicts').text()).toContain('nouns.yml')
  })
})
