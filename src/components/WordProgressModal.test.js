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

describe('WordProgressModal — the full explanation (the row is abbreviated)', () => {
  it('shows the authored meaning whole, its alternates, and the spelled-out aspect', async () => {
    vocabState.words = [
      {
        key: 'сшить=to sew',
        headword: 'сшить',
        meaning: 'to sew',
        meaningFull: 'to sew (join with thread)',
        meaningsAlt: ['to stitch', 'to make up'],
        aspect: 'pf',
        aspectPair: { key: 'шить=to sew' },
        pos: 'verb',
      },
    ]
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'сшить=to sew' } })
    await flushPromises()

    expect(wrapper.find('.meaning').text()).toBe('to sew (join with thread)')
    expect(wrapper.find('.meaning-alt').text()).toBe('also: to stitch; to make up')
    expect(wrapper.findAll('.chip').map((c) => c.text())).toContain('perfective')
  })

  it('falls back to the key gloss and hides the alternates line when there are none', async () => {
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    expect(wrapper.find('.meaning').text()).toBe('house')
    expect(wrapper.find('.meaning-alt').exists()).toBe(false)
  })
})
