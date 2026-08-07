// The stateful Vue orchestration behind the speech-driven drills (issue #532).
//
// SpeakingView (the mode drill) and PracticeView (the hands-free loop) both run
// the same machine: read a prompt aloud → open the mic → grade → move on. The
// *decisions* in that loop are pure and live in `lib/speakingDrill.js` and
// `lib/handsFree.js`; what lives here is the plumbing that makes the loop
// survive a flaky platform:
//
//   - a **sequence counter** (`seq`), bumped on every step, so a late callback
//     from an earlier step — a recogniser result that arrives after we moved on,
//     or an `onend` that `speechSynthesis.cancel()` retro-fires — bails instead
//     of acting on the current one;
//   - a **timer registry**, so every pending watchdog / advance delay is dropped
//     in one call on any transition;
//   - **watchdogs**: `speechSynthesis` sometimes never reports that it finished,
//     so every "speak, then continue" is raced against a time-based fallback
//     that runs the continuation exactly once;
//   - the **screen wake lock** (a locked phone kills the mic), including the
//     re-acquire on tab return that the browser's silent release requires;
//   - the **recognition lifecycle** — one live controller at a time, aborted on
//     every transition, with the sequence guard applied to its callbacks.
//
// Both views used to carry their own copy of all of this. Mount-time and
// unmount-time wiring is registered here so neither view can forget to release
// the lock, clear its timers or stop the mic.

import { onMounted, onUnmounted, ref, shallowRef } from 'vue'

import { cancelSpeech, sequenceDurationMs, speakSequence } from '../lib/speech.js'
import { listen } from '../lib/recognition.js'

/**
 * @param {object} [options]
 * @param {() => boolean} [options.isActive] whether a drill is currently
 *   running. Consulted by the wake lock: it re-acquires on tab return only
 *   while active, and drops a lock that resolved after the drill ended.
 */
export function useSpeechLoop({ isActive = () => false } = {}) {
  // Monotonic step counter. A ref (rather than a plain `let`) so views can
  // expose it and tests can observe that a transition invalidated in-flight work.
  const seq = ref(0)
  // Pending timers (watchdogs + advance delays), all cleared on any transition.
  const timers = new Set()
  // shallowRef: this holds a platform object we only ever null-check, and it
  // must stay the raw lock rather than a reactive proxy of it.
  const wakeLock = shallowRef(null)
  let recCtl = null

  /** Invalidate every in-flight callback; returns the new step number. */
  function bumpSeq() {
    seq.value += 1
    return seq.value
  }

  /** Whether `mySeq` (captured when the work was scheduled) is still current. */
  function isCurrent(mySeq) {
    return mySeq === seq.value
  }

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
    return id
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  /**
   * Run `action` exactly once for the *current* step — whichever fires first,
   * the speech `onEnd` callback or the watchdog. Returns the callback to hand to
   * speak()/speakSequence(); a stale call from an earlier step is ignored.
   */
  function onceForStep(action, watchdogMs) {
    const mySeq = seq.value
    let done = false
    const run = () => {
      if (done || !isCurrent(mySeq)) return
      done = true
      action()
    }
    later(run, watchdogMs)
    return run
  }

  /**
   * Read a sequence of spoken parts, then call `cb` once — when the last part
   * finishes, or when the watchdog gives up on `onend` ever arriving. Falls
   * straight through to `cb` when nothing could be spoken, so a browser without
   * speech synthesis never strands the loop.
   * @param {Array<{ text: string, lang?: string, rate?: number }>} parts
   * @param {() => void} cb
   * @param {number} [graceMs] slack added on top of the estimated read time
   */
  function readThen(parts, cb, graceMs = 1500) {
    const run = onceForStep(cb, sequenceDurationMs(parts) + graceMs)
    const spoke = speakSequence(parts, { onEnd: run })
    if (!spoke) run()
  }

  /** Abort the live recogniser, if any. Safe to call at any time. */
  function stopRecognition() {
    if (recCtl) {
      recCtl.abort()
      recCtl = null
    }
  }

  /** Ask the recogniser to finish and deliver its result (the "Done" button). */
  function stopListening() {
    recCtl?.stop()
  }

  /**
   * Open the microphone with the step guard applied: `onResult` / `onError` /
   * `onEnd` only fire while the step they were opened for is still current, so
   * a result that lands after the drill moved on is dropped. Any previous
   * recogniser is aborted first — only one is ever live.
   *
   * `onEnd` receives `(finalText, alternatives, mySeq)`; the step number is
   * handed back for callbacks that schedule further work of their own.
   * @returns {number} the step this listener is bound to
   */
  function listenGuarded({ lang, onResult, onError, onEnd }) {
    stopRecognition()
    const mySeq = seq.value
    recCtl = listen({
      lang,
      onResult: (result) => {
        if (isCurrent(mySeq)) onResult?.(result)
      },
      onError: (err) => {
        if (isCurrent(mySeq)) onError?.(err)
      },
      onEnd: (finalText, alternatives) => {
        recCtl = null
        if (!isCurrent(mySeq)) return
        onEnd?.(finalText, alternatives, mySeq)
      },
    })
    return mySeq
  }

  // Screen Wake Lock — keeps the display on during active drills, because a
  // locked screen disables the microphone.
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock.value) return
    try {
      const lock = await navigator.wakeLock.request('screen')
      // If the drill ended while we were awaiting, release immediately rather
      // than leaving an orphaned lock with no owner to clean it up.
      if (!isActive()) {
        lock.release()
        return
      }
      wakeLock.value = lock
      lock.addEventListener('release', () => {
        wakeLock.value = null
      })
    } catch {
      // Permission denied or API unavailable — safe to ignore.
    }
  }

  function releaseWakeLock() {
    wakeLock.value?.release()
    wakeLock.value = null
  }

  // The browser silently releases the lock when the tab is hidden; re-acquire on
  // return if a drill is still running.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && isActive()) acquireWakeLock()
  }

  /**
   * The transition preamble every step shares: invalidate in-flight callbacks,
   * drop pending timers, close the mic and stop any speech.
   */
  function resetLoop() {
    bumpSeq()
    clearTimers()
    stopRecognition()
    cancelSpeech()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    resetLoop()
    releaseWakeLock()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    seq,
    bumpSeq,
    isCurrent,
    later,
    clearTimers,
    onceForStep,
    readThen,
    listenGuarded,
    stopRecognition,
    stopListening,
    wakeLock,
    acquireWakeLock,
    releaseWakeLock,
    resetLoop,
  }
}
