import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { initAppUpdate, resetAppUpdate, installed } from '../stores/appUpdate.js'

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

/**
 * A `fetch` answering the deployed-version request. Every mount asks,
 * so every test needs one; an unstubbed fetch would reach for the network.
 */
function serving(body, { ok = true } = {}) {
  return vi.fn(async () => ({ ok, json: async () => body }))
}

const FUTURE = '2099-01-01T00:00:00.000Z'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('fetch', serving({ commit: installed.commit, released: installed.released }))
  idb._resetForTests()
  vocabState.words = [{ key: 'w0', pos: 'noun', hasInflections: false }]
  mockPush.mockClear()
  await progress.resetProgress()
  await progress.loadProgress()
  resetAppUpdate()
})

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('takes the waiting build when asked to reload for the latest app (#691)', async () => {
    // Since the worker stopped claiming the page on its own, a bare reload
    // would be served the old shell — this button has to take the update.
    const updateSW = vi.fn(async () => {})
    const registration = { update: vi.fn(async () => {}), waiting: {} }
    initAppUpdate(
      (options) => {
        options.onRegisteredSW?.('/sw.js', registration)
        return updateSW
      },
      { reload: vi.fn() },
    )

    const wrapper = mount(DataView)
    await settle()
    // The press now runs a full check first — the worker *and* the deployment
    // — so give the chain room to finish rather than a single tick.
    await wrapper.find('.update-app').trigger('click')
    await settleUntil(() => updateSW.mock.calls.length > 0)

    expect(registration.update).toHaveBeenCalled()
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('shows cached dictionary update dates', async () => {
    await idb.putFile({ file: 'nouns.yml', pos: 'noun', updated: '2026-06-01T00:00:00Z', content: 'words: {}' })
    const wrapper = mount(DataView)
    await settle()
    expect(wrapper.find('.dicts').text()).toContain('nouns.yml')
  })

  it('names the build that is running and when it was released', async () => {
    const wrapper = mount(DataView)
    await settle()

    const line = wrapper.find('.installed').text()
    expect(line).toContain(new Date(installed.released).toLocaleString())
    expect(line).toContain(installed.commit)
  })

  it('confirms the running build is the deployed one, and when that was checked', async () => {
    const wrapper = mount(DataView)
    await settleUntil(() => wrapper.find('.checked').text().includes('Last checked'))

    expect(wrapper.find('.deployed').text()).toContain("You're running the version that's deployed")
    expect(wrapper.find('.checked').text()).toContain('Last checked against the live site just now')
  })

  it('reports a newer deployed version, with its release date', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))

    const wrapper = mount(DataView)
    await settleUntil(() => wrapper.find('.deployed.newer').exists())

    const text = wrapper.find('.deployed').text()
    expect(text).toContain('A newer version is available')
    expect(text).toContain(new Date(FUTURE).toLocaleString())
    expect(text).toContain('deadbee')
    expect(wrapper.find('.update-app').text()).toBe('Update now')
  })

  it('says so when the check could not reach the live site, keeping the old answer', async () => {
    // Offline is the normal state of this app: "up to date" is only worth the
    // age of the check behind it, so a failed check must not read as one.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const wrapper = mount(DataView)
    await settleUntil(() => wrapper.find('.checked').text().includes("Couldn't reach"))

    expect(wrapper.find('.checked').text()).toContain('Never checked against the live site')
    expect(wrapper.find('.deployed').text()).toContain('Not yet checked against the live site')
  })

  it('checks again on demand', async () => {
    const wrapper = mount(DataView)
    await settle()

    const fetchMock = serving({ commit: 'deadbee', released: FUTURE })
    vi.stubGlobal('fetch', fetchMock)
    await wrapper.find('.check-version').trigger('click')
    await settleUntil(() => wrapper.find('.deployed.newer').exists())

    expect(fetchMock).toHaveBeenCalled()
    expect(wrapper.find('.deployed').text()).toContain('A newer version is available')
  })
})
