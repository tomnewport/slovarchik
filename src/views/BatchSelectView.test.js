import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

const push = vi.fn()
const query = { level: 'learning' }
vi.mock('vue-router', () => ({
  useRoute: () => ({ query }),
  useRouter: () => ({ push }),
}))

const { default: BatchSelectView } = await import('./BatchSelectView.vue')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
  await progress.resetProgress()
  await progress.loadProgress()
  query.level = 'learning'
  delete query.next
  delete query.type
  delete query.size
  push.mockClear()
})

describe('BatchSelectView', () => {
  it('offers batch options and commits the chosen one', async () => {
    const wrapper = mount(BatchSelectView)
    await flushPromises()

    const options = wrapper.findAll('.option')
    expect(options.length).toBeGreaterThan(0)
    expect(options.length).toBeLessThanOrEqual(5)

    await options[0].trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r)) // let the IndexedDB write settle
    await flushPromises()

    expect(progress.state.learning).toBeTruthy()
    expect(progress.state.learning.level).toBe('learning')
    expect(push).toHaveBeenCalledWith('/')
  })

  it('continues into the session when launched mid-session-start', async () => {
    query.next = 'session'
    query.type = 'standard'
    query.size = 'quick'
    const wrapper = mount(BatchSelectView)
    await flushPromises()

    await wrapper.findAll('.option')[0].trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r)) // let the IndexedDB write settle
    await flushPromises()

    expect(progress.state.learning).toBeTruthy()
    expect(push).toHaveBeenCalledWith({
      path: '/session',
      query: { type: 'standard', size: 'quick' },
    })
  })

  it('explains the lock when no mastery options are available', async () => {
    query.level = 'mastery' // nothing learned yet → mastery is locked
    const wrapper = mount(BatchSelectView)
    await flushPromises()

    expect(wrapper.find('.option').exists()).toBe(false)
    expect(wrapper.text()).toContain('Mastery unlocks')
  })
})
