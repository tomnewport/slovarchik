import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

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

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = [{ key: 'w0', pos: 'noun', hasInflections: false }]
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
    await settle()
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
    await settle()

    expect(wrapper.find('.status.ok').exists()).toBe(true)
    expect(progress.stateOf('w0')).toBe('mastered')
  })

  it('shows cached dictionary update dates', async () => {
    await idb.putFile({ file: 'nouns.yml', pos: 'noun', updated: '2026-06-01T00:00:00Z', content: 'words: {}' })
    const wrapper = mount(DataView)
    await settle()
    expect(wrapper.find('.dicts').text()).toContain('nouns.yml')
  })
})
