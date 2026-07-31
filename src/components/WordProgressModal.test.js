import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import WordProgressModal from './WordProgressModal.vue'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = [{ key: 'w0', headword: 'дом', meaning: 'house', hasInflections: true, pos: 'noun' }]
  await progress.resetProgress()
  await progress.loadProgress()
})

describe('WordProgressModal — "I know this word" (#321)', () => {
  it('flags the word known, shows the confirmation, and can undo it', async () => {
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    // The offer is shown while the word is not yet known.
    const knowBtn = wrapper.find('button.know')
    expect(knowBtn.exists()).toBe(true)
    expect(progress.isKnown('w0')).toBe(false)

    await knowBtn.trigger('click')
    await flushPromises()
    await flushPromises() // second flush: fake-indexeddb settles the write on setImmediate

    // Now flagged: the store agrees and the UI swaps to the "known" badge.
    expect(progress.isKnown('w0')).toBe(true)
    expect(wrapper.find('.known-badge').exists()).toBe(true)
    expect(wrapper.find('button.know').exists()).toBe(false)

    // Undo restores the offer and clears the flag.
    await wrapper.find('button.linkish').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(progress.isKnown('w0')).toBe(false)
    expect(wrapper.find('button.know').exists()).toBe(true)
  })
})
