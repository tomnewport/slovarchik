import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import PracticeView from './PracticeView.vue'
import { state as vocabState } from '../stores/vocab.js'
import { state as progressState } from '../stores/progress.js'
import { settings } from '../stores/settings.js'
import { loadFixtureWords } from '../test/fixtures.js'

// A speech synthesis stub that fires each utterance's `onend` synchronously so
// the hands-free chain (read → listen) advances without real audio or timers.
function stubSpeech() {
  window.speechSynthesis = {
    speak(u) {
      if (u && typeof u.onend === 'function') u.onend()
    },
    cancel() {},
    getVoices: () => [],
  }
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text
    }
  }
}

// A recognition stub that records every instance so a test can drive onend().
function stubRecognition(instances) {
  window.webkitSpeechRecognition = class {
    constructor() {
      instances.push(this)
    }
    start() {}
    stop() {}
    abort() {}
  }
}

// Drive a recogniser instance to emit `text` as a final transcript, the way the
// real Web Speech API does (a final result segment, then `onend`).
function feed(rec, text) {
  const seg = [{ transcript: text }]
  seg.isFinal = true
  rec.onresult({ resultIndex: 0, results: Object.assign([seg], { length: 1 }) })
  rec.onend()
}

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

beforeEach(() => {
  // Skip the IndexedDB loads in setup() — we're testing the loop, not storage.
  progressState.loaded = true
  settings.loaded = true
})

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PracticeView', () => {
  it('shows a fallback when speech recognition/synthesis is unavailable', async () => {
    const wrapper = mount(PracticeView)
    await flushPromises()
    expect(wrapper.text()).toMatch(/can’t do hands-free speech/i)
  })

  it('reads a welcome prompt and waits for "давай"', async () => {
    const instances = []
    stubSpeech()
    stubRecognition(instances)

    const wrapper = mount(PracticeView)
    await flushPromises()

    // Welcome copy is on screen and the mic is already listening for the cue.
    expect(wrapper.text()).toMatch(/давай/i)
    expect(wrapper.vm.phase).toBe('welcome')
    expect(instances.length).toBe(1)
  })

  it('grades a correct spoken answer and scores it', async () => {
    const instances = []
    stubSpeech()
    stubRecognition(instances)
    vi.useFakeTimers()

    const wrapper = mount(PracticeView)
    await flushPromises()

    // Begin the session directly (skips the spoken "давай" recognition).
    wrapper.vm.beginSession()
    await flushPromises()

    // The first item has been read and the mic is open for the answer.
    expect(wrapper.vm.phase).toBe('listening')
    expect(wrapper.vm.activity).toBeTruthy()

    // Feed back the exact expected answer.
    wrapper.vm.grade([wrapper.vm.activity.targets[0]])
    await flushPromises()

    // Pleasant feedback, then the loop advances after a short pause.
    vi.advanceTimersByTime(2000)
    await flushPromises()

    expect(wrapper.vm.score.total).toBeGreaterThanOrEqual(1)
    expect(wrapper.vm.score.right).toBeGreaterThanOrEqual(1)
  })

  it('warms up with words from the current batch before the random mix', async () => {
    const instances = []
    stubSpeech()
    stubRecognition(instances)

    // Put a couple of real vocab words in the learning batch.
    const batchWords = vocabState.words.slice(0, 2).map((w) => w.key)
    progressState.learning = { level: 'learning', name: 'Test batch', words: batchWords }

    const wrapper = mount(PracticeView)
    await flushPromises()
    wrapper.vm.beginSession()
    await flushPromises()

    // The very first item is a "repeat after me" new-words activity drawn from
    // the batch.
    expect(wrapper.vm.activity.type).toBe('new-words')
    expect(batchWords).toContain(wrapper.vm.activity.recordKey)

    progressState.learning = null
  })

  it('does not count a spoken "pass" against the score', async () => {
    const instances = []
    stubSpeech()
    stubRecognition(instances)

    const wrapper = mount(PracticeView)
    await flushPromises()
    wrapper.vm.beginSession()
    await flushPromises()
    expect(wrapper.vm.phase).toBe('listening')

    // The learner skips this item — it should not add to total or right.
    feed(instances[instances.length - 1], 'pass')
    await flushPromises()

    expect(wrapper.vm.score.total).toBe(0)
    expect(wrapper.vm.score.right).toBe(0)
  })

  it('quits the session when the user says "quit"', async () => {
    const instances = []
    stubSpeech()
    stubRecognition(instances)

    const wrapper = mount(PracticeView)
    await flushPromises()
    wrapper.vm.beginSession()
    await flushPromises()
    expect(wrapper.vm.phase).toBe('listening')

    // The active recogniser hears "quit" → session ends.
    feed(instances[instances.length - 1], 'quit')
    await flushPromises()

    expect(wrapper.vm.phase).toBe('ended')
    expect(wrapper.text()).toMatch(/nice work/i)
  })
})
