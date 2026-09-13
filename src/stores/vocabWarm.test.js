import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Wrap the real builder so the test can count builds without changing what one
// produces — the claim under test is *when* the index is built, not what it holds.
vi.mock('../lib/phraseHint.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, buildFormIndex: vi.fn(actual.buildFormIndex) }
})

import { buildFormIndex } from '../lib/phraseHint.js'
import * as idb from '../lib/idb.js'
import { state, formIndex, warmFormIndex, initVocab } from './vocab.js'

const WORDS = [
  { key: 'дом=house', headword: 'до́м', ru: 'дом', meaning: 'house' },
  { key: 'кот=cat', headword: 'ко́т', ru: 'кот', meaning: 'cat' },
]

/** Capture what gets scheduled instead of waiting for the browser to go idle. */
function captureIdle() {
  const calls = []
  globalThis.requestIdleCallback = vi.fn((cb, opts) => calls.push({ cb, opts }))
  return calls
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  state.words = []
  state.status = 'idle'
  buildFormIndex.mockClear()
})

afterEach(() => {
  delete globalThis.requestIdleCallback
  vi.useRealTimers()
})

// #697: the index is ~200 ms of CPU, and as a lazy computed it was built on the
// first phrase — between "start the drill" and the first question appearing.
// Warming it while the learner reads Home moves that cost off the only moment
// they are waiting on it.
describe('warmFormIndex', () => {
  it('builds the index in an idle callback, leaving the first phrase nothing to pay', () => {
    const idle = captureIdle()
    state.words = WORDS

    warmFormIndex()
    // Scheduled, not run: warming must not block the boot it rides on.
    expect(buildFormIndex).not.toHaveBeenCalled()
    expect(idle).toHaveLength(1)
    // A page that never goes idle still warms, eventually.
    expect(idle[0].opts?.timeout).toBeGreaterThan(0)

    idle[0].cb()
    expect(buildFormIndex).toHaveBeenCalledTimes(1)

    // What a drill's first phrase does — and it finds the computed warm.
    expect(formIndex.value.get('дом').en).toBe('house')
    expect(buildFormIndex).toHaveBeenCalledTimes(1)
  })

  it('falls back to a timeout where requestIdleCallback is missing', () => {
    vi.useFakeTimers()
    delete globalThis.requestIdleCallback
    state.words = WORDS

    warmFormIndex()
    expect(buildFormIndex).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(buildFormIndex).toHaveBeenCalledTimes(1)
  })

  it('schedules one build at a time, however often it is asked', () => {
    const idle = captureIdle()
    state.words = WORDS

    warmFormIndex()
    warmFormIndex()
    expect(idle).toHaveLength(1)

    // Once it has run, a later corpus change can schedule another.
    idle[0].cb()
    warmFormIndex()
    expect(idle).toHaveLength(2)
    idle[1].cb() // leave nothing scheduled behind this test
  })

  it('does nothing with no corpus to index', () => {
    const idle = captureIdle()

    warmFormIndex()
    expect(idle).toHaveLength(0)
  })

  it('skips the build when the corpus went away before the callback ran', () => {
    const idle = captureIdle()
    state.words = WORDS

    warmFormIndex()
    state.words = []
    idle[0].cb()
    expect(buildFormIndex).not.toHaveBeenCalled()
  })
})

// The boot path is where the idle time is: Home is up in ~70 ms and read for
// seconds before a drill starts.
describe('initVocab', () => {
  it('warms the index once the corpus is in hand', async () => {
    const idle = captureIdle()
    await idb.putFile({
      file: 'nouns.json',
      pos: 'noun',
      updated: '2026-05-28T00:00:00Z',
      doc: { words: { 'дом=house': { ru: 'до́м', en: 'house' } } },
    })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false) // cached launch, no refresh

    expect(await initVocab()).toBe('ready')
    expect(idle).toHaveLength(1)

    idle[0].cb()
    expect(buildFormIndex).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('schedules nothing when the corpus never arrived', async () => {
    const idle = captureIdle()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    expect(await initVocab()).toBe('empty')
    expect(idle).toHaveLength(0)
    vi.restoreAllMocks()
  })
})
