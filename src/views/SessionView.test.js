import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

// A fixed two-exercise session so the runner flow is deterministic; both are
// keyboard-typing exercises so we can drive them through the real DOM.
vi.mock('../lib/exerciseBuild.js', () => ({
  buildExercises: () => [
    { id: 'ex0', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 0, audio: false, targets: ['t1'], ru: 'дом', en: 'house' },
    { id: 'ex1', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 1, audio: false, targets: ['t2'], ru: 'кот', en: 'cat' },
  ],
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { type: 'words' } }),
  useRouter: () => ({ push }),
}))

// Import after the mocks are registered.
const { default: SessionView } = await import('./SessionView.vue')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
  await progress.resetProgress()
  await progress.loadProgress()
  push.mockClear()
})

async function answer(wrapper, text) {
  await wrapper.find('input[lang="ru"]').setValue(text)
  await wrapper.find('button.check').trigger('click')
  await wrapper.find('button.next').trigger('click')
  await flushPromises()
}

describe('SessionView', () => {
  it('runs a session to completion, reports results and shows a summary', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    // Progress bar segmented by practice (two practices here).
    expect(wrapper.findAll('.seg')).toHaveLength(2)

    await answer(wrapper, 'дом') // ex0 correct
    await answer(wrapper, 'кот') // ex1 correct

    expect(wrapper.text()).toContain('Session complete')
    expect(wrapper.text()).toContain('100%')
    // Each exercise reported its result to the store per dimension.
    expect(progress.stateOf('t1')).not.toBe('unknown')
    expect(progress.stateOf('t2')).not.toBe('unknown')
  })

  it('repeats wrong answers until they are cleared', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    await answer(wrapper, 'дом') // ex0 correct
    await answer(wrapper, 'wrong') // ex1 wrong → re-queued

    // Still running: the repeat round re-presents the wrong exercise.
    expect(wrapper.text()).not.toContain('Session complete')
    expect(wrapper.text()).toContain('Fixing mistakes')

    await answer(wrapper, 'кот') // ex1 correct on repeat
    expect(wrapper.text()).toContain('Session complete')
    // First-attempt score: 1 of 2 correct.
    expect(wrapper.text()).toContain('50%')
  })

  it('asks for confirmation before closing', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    await wrapper.find('button.close').trigger('click')
    expect(wrapper.find('.modal').exists()).toBe(true)
    expect(push).not.toHaveBeenCalled()

    await wrapper.findAll('.modal button').at(1).trigger('click') // "End session"
    expect(push).toHaveBeenCalledWith('/')
  })
})
