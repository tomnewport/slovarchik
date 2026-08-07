import { describe, it, expect, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import { useSpeechLoop } from './useSpeechLoop.js'
import { SLOW_RATE } from '../lib/speech.js'

// Mount a throwaway component so the composable gets a real Vue lifecycle
// (onMounted / onUnmounted), then hand its API back to the test. Every mount is
// torn down after the test — a leftover component keeps its document-level
// visibility listener and would answer another test's events.
const mounted = []
function mountLoop(options) {
  let api
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useSpeechLoop(options)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return { loop: api, wrapper }
}

// Drive a recogniser instance to emit `text` as a final result, the way the real
// Web Speech API does.
function feed(rec, text) {
  const segment = [{ transcript: text }]
  segment.isFinal = true
  rec.onresult({ resultIndex: 0, results: Object.assign([segment], { length: 1 }) })
  rec.onend()
}

// A recogniser stub that records every instance, so a test can drive its
// callbacks and assert that abort() was called on the ones it replaced.
function stubRecognition(instances) {
  window.webkitSpeechRecognition = class {
    constructor() {
      this.aborted = 0
      this.stopped = 0
      instances.push(this)
    }
    start() {}
    stop() {
      this.stopped += 1
    }
    abort() {
      this.aborted += 1
    }
  }
}

// Speech synthesis that never reports completion — the case the watchdogs exist
// for (a real `speechSynthesis` sometimes just never fires `onend`).
function stubSilentSpeech() {
  window.speechSynthesis = { speak() {}, cancel: vi.fn(), getVoices: () => [] }
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text
    }
  }
}

function stubWakeLock(lock) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: vi.fn(async () => lock) },
    configurable: true,
    writable: true,
  })
}

function makeLock() {
  return {
    released: 0,
    listeners: [],
    release() {
      this.released += 1
      for (const fn of this.listeners) fn()
    },
    addEventListener(_type, fn) {
      this.listeners.push(fn)
    },
  }
}

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  delete navigator.wakeLock
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('timers', () => {
  it('runs a scheduled callback and forgets it once fired', () => {
    vi.useFakeTimers()
    const { loop } = mountLoop()
    const fn = vi.fn()

    loop.later(fn, 500)
    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clearTimers drops every pending callback', () => {
    vi.useFakeTimers()
    const { loop } = mountLoop()
    const a = vi.fn()
    const b = vi.fn()

    loop.later(a, 100)
    loop.later(b, 5000)
    loop.clearTimers()
    vi.advanceTimersByTime(10000)

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })
})

describe('onceForStep', () => {
  it('runs the action once, whichever fires first', () => {
    vi.useFakeTimers()
    const { loop } = mountLoop()
    const action = vi.fn()

    const run = loop.onceForStep(action, 1000)
    run() // the speech `onEnd` arrived first
    expect(action).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2000) // …so the watchdog must not run it again
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('falls back to the watchdog when `onEnd` never arrives', () => {
    vi.useFakeTimers()
    const { loop } = mountLoop()
    const action = vi.fn()

    loop.onceForStep(action, 1000)
    vi.advanceTimersByTime(1000)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('ignores a callback left over from an earlier step', () => {
    vi.useFakeTimers()
    const { loop } = mountLoop()
    const action = vi.fn()

    const run = loop.onceForStep(action, 1000)
    loop.bumpSeq() // the drill moved on
    run()
    vi.advanceTimersByTime(2000)

    expect(action).not.toHaveBeenCalled()
  })
})

describe('readThen', () => {
  it('continues immediately when nothing can be spoken', () => {
    const { loop } = mountLoop()
    const cb = vi.fn()

    loop.readThen([{ text: 'привет', lang: 'ru-RU' }], cb)

    // No speechSynthesis in this environment — the loop must not strand itself
    // waiting on a callback that will never come.
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('waits out a slow read before the watchdog fires', () => {
    vi.useFakeTimers()
    stubSilentSpeech()
    const { loop } = mountLoop()
    const cb = vi.fn()

    const parts = [{ text: 'x'.repeat(50), lang: 'ru-RU', rate: SLOW_RATE }]
    const rateUnaware = 50 * 90 + 1200 + 1500
    loop.readThen(parts, cb)

    // A rate-unaware watchdog would give up here, mid-utterance.
    vi.advanceTimersByTime(rateUnaware)
    expect(cb).not.toHaveBeenCalled()

    vi.advanceTimersByTime((50 * 90 + 1200) * 2 + 1500 - rateUnaware)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('listenGuarded', () => {
  it('passes results through while the step is current', () => {
    const instances = []
    stubRecognition(instances)
    const { loop } = mountLoop()
    const onResult = vi.fn()
    const onEnd = vi.fn()

    loop.listenGuarded({ lang: 'ru-RU', onResult, onEnd })
    feed(instances[0], 'привет')

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('привет', ['привет'], expect.any(Number))
  })

  it('drops a result that arrives after the drill moved on', () => {
    const instances = []
    stubRecognition(instances)
    const { loop } = mountLoop()
    const onResult = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()

    loop.listenGuarded({ lang: 'ru-RU', onResult, onError, onEnd })
    loop.bumpSeq() // next question

    instances[0].onerror({ error: 'no-speech' })
    feed(instances[0], 'привет')

    expect(onResult).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('keeps only one recogniser live', () => {
    const instances = []
    stubRecognition(instances)
    const { loop } = mountLoop()

    loop.listenGuarded({ lang: 'ru-RU' })
    loop.listenGuarded({ lang: 'ru-RU' })

    expect(instances).toHaveLength(2)
    expect(instances[0].aborted).toBe(1)
    expect(instances[1].aborted).toBe(0)
  })

  it('stopListening asks the recogniser to finish and deliver', () => {
    const instances = []
    stubRecognition(instances)
    const { loop } = mountLoop()

    loop.listenGuarded({ lang: 'ru-RU' })
    loop.stopListening()

    expect(instances[0].stopped).toBe(1)
    expect(instances[0].aborted).toBe(0)
  })

  it('hands the step number to onEnd so callbacks can re-check it', () => {
    const instances = []
    stubRecognition(instances)
    const { loop } = mountLoop()
    let seen = null

    loop.listenGuarded({ lang: 'ru-RU', onEnd: (_t, _a, mySeq) => { seen = mySeq } })
    instances[0].onend()

    expect(loop.isCurrent(seen)).toBe(true)
    loop.bumpSeq()
    expect(loop.isCurrent(seen)).toBe(false)
  })
})

describe('resetLoop', () => {
  it('invalidates in-flight work, clears timers, aborts the mic and stops speech', () => {
    vi.useFakeTimers()
    const instances = []
    stubRecognition(instances)
    stubSilentSpeech()
    const { loop } = mountLoop()
    const pending = vi.fn()

    loop.listenGuarded({ lang: 'ru-RU' })
    loop.later(pending, 500)
    const before = loop.seq.value

    loop.resetLoop()
    vi.advanceTimersByTime(1000)

    expect(loop.seq.value).toBeGreaterThan(before)
    expect(pending).not.toHaveBeenCalled()
    expect(instances[0].aborted).toBe(1)
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
  })
})

describe('wake lock', () => {
  it('holds a lock while the drill is active and releases it on demand', async () => {
    const lock = makeLock()
    stubWakeLock(lock)
    const { loop } = mountLoop({ isActive: () => true })

    await loop.acquireWakeLock()
    expect(loop.wakeLock.value).toBe(lock)

    loop.releaseWakeLock()
    expect(lock.released).toBe(1)
    expect(loop.wakeLock.value).toBe(null)
  })

  it('drops a lock that resolves after the drill ended', async () => {
    const lock = makeLock()
    stubWakeLock(lock)
    let active = true
    const { loop } = mountLoop({ isActive: () => active })

    const pending = loop.acquireWakeLock()
    active = false // the learner quit while the request was in flight
    await pending

    expect(lock.released).toBe(1)
    expect(loop.wakeLock.value).toBe(null)
  })

  it('re-acquires when the tab comes back, but only while active', async () => {
    const lock = makeLock()
    stubWakeLock(lock)
    let active = false
    mountLoop({ isActive: () => active })

    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(navigator.wakeLock.request).not.toHaveBeenCalled()

    active = true
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1)
  })

  it('forgets the lock when the browser releases it itself', async () => {
    const lock = makeLock()
    stubWakeLock(lock)
    const { loop } = mountLoop({ isActive: () => true })

    await loop.acquireWakeLock()
    lock.release() // e.g. the tab was hidden
    expect(loop.wakeLock.value).toBe(null)
  })

  it('is a no-op where the API is missing', async () => {
    const { loop } = mountLoop({ isActive: () => true })
    await loop.acquireWakeLock()
    expect(loop.wakeLock.value).toBe(null)
  })
})

describe('teardown', () => {
  it('releases everything on unmount', async () => {
    vi.useFakeTimers()
    const instances = []
    const lock = makeLock()
    stubRecognition(instances)
    stubSilentSpeech()
    stubWakeLock(lock)
    const { loop, wrapper } = mountLoop({ isActive: () => true })
    const pending = vi.fn()

    await loop.acquireWakeLock()
    loop.listenGuarded({ lang: 'ru-RU' })
    loop.later(pending, 500)

    wrapper.unmount()
    vi.advanceTimersByTime(1000)

    expect(pending).not.toHaveBeenCalled()
    expect(instances[0].aborted).toBe(1)
    expect(lock.released).toBe(1)
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()

    // The visibility listener is gone too, so a hidden/shown tab can't revive
    // a drill that no longer exists.
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1)
  })
})
