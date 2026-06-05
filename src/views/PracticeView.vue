<script setup>
// Fully hands-free spoken practice (issue #25).
//
// The screen is deliberately bare — a single big microphone — so it's safe to
// glance at while walking or commuting. Everything is driven by voice: say
// "давай" to begin, answer out loud, say "pass" to skip a word or "quit" to
// stop. The display is kept awake (a locked phone disables the mic) and, if the
// learner falls silent, the app just keeps listening rather than nagging.
//
// All the "what to say / listen for / how to grade" decisions live in the pure
// engine (lib/handsFree.js); this component only drives speech, the microphone,
// and the loop's timing — closely mirroring SpeakingView's robustness tricks
// (sequence guards, watchdogs, wake lock, visibility re-acquire).
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue'

import { vocab, phrases, state as vocabState, initVocab } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadSettings, playFeedback } from '../stores/settings.js'
import { STATES } from '../lib/progression.js'
import { speakSequence, cancelSpeech, speechSupported } from '../lib/speech.js'
import { recognitionSupported, recognitionErrorMessage, listen } from '../lib/recognition.js'
import {
  nextActivity,
  warmupActivities,
  availableTypes,
  gradeActivity,
  isStart,
  isQuit,
  isPass,
} from '../lib/handsFree.js'

const canRecognize = recognitionSupported()
const canSpeak = speechSupported()

// How long the pleasant sound rings before the loop moves to the next item.
const CORRECT_MS = 1100
// Brief pause after a correction is read before the next item.
const ADVANCE_MS = 700
// Patient, but not infinite: a blocked mic mustn't spin forever on silence.
const MAX_SILENCE = 60
// How many current-batch words to open each session with as a gentle warm-up.
const WARMUP_COUNT = 3
// Errors that won't fix themselves — pause the loop instead of auto-retrying.
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'network',
  'unsupported',
])

const ready = ref(false)
// phase: 'welcome' | 'reading' | 'listening' | 'feedback' | 'ended'
const phase = ref('welcome')
const started = ref(false)
const activity = ref(null)
const transcript = ref('')
const recError = ref('')
const paused = ref(false)
const score = reactive({ right: 0, total: 0 })

let recCtl = null
let seq = 0
let attempts = 0
let gotCorrect = false
let silenceRetries = 0
let lastKey = null
// New-words activities to run before the random mix — a current-batch warm-up.
let warmup = []

const errorMessage = computed(() =>
  recError.value ? recognitionErrorMessage(recError.value) : '',
)

const rank = (s) => STATES.indexOf(s)

// --- Eligible pools (issue #25's gating rules) ------------------------------

const learningKeys = computed(() => new Set(progress.state.learning?.words ?? []))

// "New words" come from the current learning batch (which includes never-seen
// words); fall back to anything actively being learned if no batch is set.
const newWordsPool = computed(() => {
  const inBatch = vocab.value.filter((w) => learningKeys.value.has(w.id))
  if (inBatch.length) return inBatch
  return vocab.value.filter((w) => progress.stateOf(w.id) === 'learning')
})

// Words the learner has got right at least once are eligible to be *tested*.
const knownWords = computed(() => vocab.value.filter((w) => progress.hasBeenCorrect(w.id)))

// English→Russian phrase production is only offered once the owning word is
// learned (a stand-in for "translated a few times and spoken aloud").
const phraseToRuPool = computed(() =>
  phrases.value.filter((p) => rank(progress.stateOf(p.source)) >= rank('learned')),
)

const pools = computed(() => ({
  'new-words': newWordsPool.value,
  'word-test': knownWords.value,
  'translate-word': knownWords.value,
  'repeat-phrase': phrases.value,
  'translate-phrase': phrases.value,
  'phrase-to-russian': phraseToRuPool.value,
}))

const hasActivities = computed(() => availableTypes(pools.value).length > 0)

// --- Timers + speech watchdogs (mirrors SpeakingView) -----------------------

const timers = new Set()
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

// Rough upper bound on how long a part takes to read aloud. Divide by the
// playback rate: a slow (0.5×) read takes about twice as long, so the watchdog
// must wait for it — otherwise the mic opens mid-sentence.
function estimateSpeechMs(text, rate = 1) {
  const base = Math.min(12000, Math.max(2500, String(text ?? '').length * 90 + 1200))
  return base / (rate || 1)
}

// Run `action` once for the current step — whichever fires first, the speech
// `onEnd` or the watchdog. A stale call from an earlier step is ignored.
function onceForStep(action, watchdogMs) {
  const mySeq = seq
  let done = false
  const run = () => {
    if (done || mySeq !== seq) return
    done = true
    action()
  }
  later(run, watchdogMs)
  return run
}

// Read a sequence of spoken parts, then call `cb` once they finish.
function readThen(parts, cb) {
  const watchdog =
    (parts ?? []).reduce((s, p) => s + estimateSpeechMs(p.text, p.rate), 0) + 1500
  const run = onceForStep(cb, watchdog)
  const spoke = speakSequence(parts, { onEnd: run })
  if (!spoke) run()
}

// --- Screen Wake Lock (a locked screen kills the mic) -----------------------

const wakeLock = ref(null)
async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock.value) return
  try {
    const lock = await navigator.wakeLock.request('screen')
    if (!started.value) {
      lock.release()
      return
    }
    wakeLock.value = lock
    wakeLock.value.addEventListener('release', () => {
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
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && started.value) acquireWakeLock()
}

// --- The loop ---------------------------------------------------------------

function stopRecognition() {
  if (recCtl) {
    recCtl.abort()
    recCtl = null
  }
}

function welcome() {
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  phase.value = 'welcome'
  transcript.value = ''
  recError.value = ''
  paused.value = false
  // Read the instructions in English, but the Russian cue «давай» in a Russian
  // voice — otherwise an English voice mangles it.
  readThen(
    [
      {
        text:
          'Let’s start learning! Say "pass" to skip a word, or "quit" to stop. ' +
          'When you’re ready, say:',
        lang: 'en-GB',
        rate: 1,
      },
      { text: 'давай!', lang: 'ru-RU', rate: 0.9 },
    ],
    () => {
      if (phase.value === 'welcome') listenForStart()
    },
  )
}

function listenForStart() {
  if (!canRecognize) return
  stopRecognition()
  const mySeq = seq
  phase.value = 'welcome'
  recError.value = ''
  recCtl = listen({
    lang: 'ru-RU',
    onResult: ({ transcript: heard }) => {
      if (mySeq === seq) transcript.value = heard
    },
    onError: (err) => {
      if (mySeq === seq) recError.value = err
    },
    onEnd: (finalText) => {
      recCtl = null
      if (mySeq !== seq || phase.value !== 'welcome') return
      if (isQuit(finalText)) {
        endSession()
        return
      }
      if (isStart(finalText)) {
        beginSession()
        return
      }
      // Anything else (incl. silence): keep waiting unless the mic is blocked.
      if (!FATAL_ERRORS.has(recError.value) && silenceRetries < MAX_SILENCE) {
        silenceRetries += 1
        later(() => {
          if (phase.value === 'welcome') listenForStart()
        }, 600)
      } else {
        paused.value = true
      }
    },
  })
}

function beginSession() {
  started.value = true
  score.right = 0
  score.total = 0
  silenceRetries = 0
  lastKey = null
  // Open with a few words from the current batch as a gentle warm-up.
  warmup = warmupActivities(newWordsPool.value, WARMUP_COUNT)
  acquireWakeLock()
  nextItem()
}

function nextItem() {
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  attempts = 0
  gotCorrect = false
  silenceRetries = 0
  transcript.value = ''
  recError.value = ''
  paused.value = false

  // Run the warm-up first, then fall back to the random mix.
  const next = warmup.length ? warmup.shift() : nextActivity(pools.value, Math.random, lastKey)
  if (!next) {
    endSession()
    return
  }
  activity.value = next
  lastKey = next.recordKey
  phase.value = 'reading'
  readThen(next.prompt, () => {
    if (phase.value === 'reading') beginListen()
  })
}

function beginListen() {
  if (!canRecognize || !activity.value) return
  stopRecognition()
  const mySeq = seq
  recError.value = ''
  transcript.value = ''
  phase.value = 'listening'
  recCtl = listen({
    lang: activity.value.recLang,
    onResult: ({ transcript: heard }) => {
      if (mySeq === seq) transcript.value = heard
    },
    onError: (err) => {
      if (mySeq === seq) recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      if (mySeq !== seq || phase.value !== 'listening') return
      if (isQuit(finalText)) {
        endSession()
        return
      }
      if (!finalText) {
        // Silence — stay patient and re-open the mic (unless blocked).
        if (!FATAL_ERRORS.has(recError.value) && silenceRetries < MAX_SILENCE) {
          silenceRetries += 1
          later(() => {
            if (phase.value === 'listening' && seq === mySeq) beginListen()
          }, 600)
        } else {
          paused.value = true
          phase.value = 'reading'
        }
        return
      }
      silenceRetries = 0
      if (isPass(finalText)) {
        onPass()
        return
      }
      grade(alternatives.length ? alternatives : [finalText])
    },
  })
}

function grade(guesses) {
  const { correct, best } = gradeActivity(activity.value, guesses)
  transcript.value = best
  if (correct) onCorrect()
  else onWrong()
}

function onCorrect() {
  gotCorrect = true
  phase.value = 'feedback'
  playFeedback(true)
  later(() => finishItem(true), CORRECT_MS)
}

function onWrong() {
  attempts += 1
  playFeedback(false)
  phase.value = 'feedback'
  if (attempts < activity.value.maxAttempts) {
    // Read the model answer slowly, then listen again for another try.
    silenceRetries = 0
    readThen(activity.value.model, () => {
      if (phase.value === 'feedback') beginListen()
    })
  } else {
    readThen(activity.value.model, () => finishItem(true))
  }
}

function onPass() {
  phase.value = 'feedback'
  playFeedback(false)
  // Reveal the answer, then move on without recording a result.
  readThen(activity.value.model, () => finishItem(false))
}

// `record` is false for a deliberate "pass": a skip shouldn't count toward the
// session ratio or be recorded as a missed attempt.
function finishItem(record) {
  if (record) {
    score.total += 1
    if (gotCorrect) score.right += 1
    if (activity.value?.recordKey) {
      progress.recordAttempt({
        word: activity.value.recordKey,
        dimension: activity.value.dimension,
        level: activity.value.level,
        correct: gotCorrect,
      })
    }
  }
  later(nextItem, ADVANCE_MS)
}

function endSession() {
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  started.value = false
  activity.value = null
  paused.value = false
  phase.value = 'ended'
  releaseWakeLock()
}

// Manual fallbacks (tap to start / resume — voice is the primary path).
function manualStart() {
  if (!started.value) beginSession()
}
function resume() {
  paused.value = false
  recError.value = ''
  silenceRetries = 0
  if (started.value) beginListen()
  else listenForStart()
}

async function setup() {
  if (!vocabState.words.length) await initVocab()
  if (!progress.state.loaded) await progress.loadProgress()
  loadSettings()
  ready.value = true
  if (canSpeak && canRecognize) welcome()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  setup()
})

onUnmounted(() => {
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  releaseWakeLock()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// Big-icon state: 🎧 while the app speaks, 🎤 while listening.
const micIcon = computed(() => (phase.value === 'listening' ? '🎤' : '🎧'))
const statusLine = computed(() => {
  if (paused.value) return 'Paused'
  if (phase.value === 'listening') return 'Listening…'
  if (phase.value === 'reading' || phase.value === 'feedback') return 'Speaking…'
  return ''
})
</script>

<template>
  <section class="practice">
    <!-- Unsupported / empty fallbacks -->
    <div v-if="!canRecognize || !canSpeak" class="card center">
      <h2>Hands-free practice</h2>
      <p class="feedback bad">
        This browser can’t do hands-free speech. It needs both speech recognition and
        synthesis — try Chrome or Edge with a network connection.
      </p>
    </div>

    <div v-else-if="ready && !hasActivities" class="card center">
      <h2>Hands-free practice</h2>
      <p v-if="vocabState.status === 'loading'" class="muted">Loading…</p>
      <p v-else class="muted">
        Nothing to practise yet — choose a learning batch and try a few words first, then
        come back for a hands-free session.
      </p>
    </div>

    <!-- Welcome -->
    <div v-else-if="phase === 'welcome'" class="stage">
      <div class="mic-icon big">🎧</div>
      <p class="welcome-copy">
        Let’s start learning! Say <strong>“pass”</strong> to skip a word, or
        <strong>“quit”</strong> to stop. When you’re ready, say
        <strong lang="ru">«давай!»</strong>
      </p>
      <p v-if="transcript" class="heard">“{{ transcript }}”</p>
      <p v-if="errorMessage" class="feedback bad">{{ errorMessage }}</p>
      <button v-if="paused" class="primary start" @click="resume">🎤 Resume</button>
      <button v-else class="primary start" @click="manualStart">Start</button>
    </div>

    <!-- Ended -->
    <div v-else-if="phase === 'ended'" class="stage">
      <div class="mic-icon big">✅</div>
      <h2>Nice work!</h2>
      <p class="muted">You answered {{ score.right }} of {{ score.total }} correctly.</p>
      <button class="primary start" @click="welcome">Practise again</button>
    </div>

    <!-- Active loop: nothing but a big mic, by design -->
    <div v-else class="stage active">
      <button class="quit" aria-label="Quit practice" @click="endSession">✕</button>
      <span class="score muted">{{ score.right }} / {{ score.total }}</span>

      <div class="mic-icon big" :class="{ pulse: phase === 'listening' }" aria-hidden="true">
        {{ micIcon }}
      </div>
      <p class="status muted" aria-live="polite">{{ statusLine }}</p>

      <p v-if="paused" class="feedback bad center">
        {{ errorMessage || 'Paused — tap to keep going.' }}
      </p>
      <button v-if="paused" class="primary" @click="resume">🎤 Resume</button>
    </div>
  </section>
</template>

<style scoped>
.practice {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 60vh;
}
.stage {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
  padding-top: 2rem;
}
.stage.active {
  justify-content: center;
  min-height: 60vh;
}
.mic-icon {
  line-height: 1;
}
.mic-icon.big {
  font-size: 6rem;
}
.mic-icon.pulse {
  animation: pulse 1.3s ease-in-out infinite;
}
.status {
  font-size: 1.1rem;
  min-height: 1.4rem;
}
.welcome-copy {
  max-width: 28rem;
  font-size: 1.05rem;
  line-height: 1.5;
}
.heard {
  font-style: italic;
  color: var(--muted);
}
.quit {
  position: absolute;
  top: 0;
  right: 0;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
}
.score {
  position: absolute;
  top: 0.4rem;
  left: 0;
  font-size: 0.95rem;
}
.start {
  font-size: 1.1rem;
  padding: 0.6rem 1.6rem;
}
.center {
  text-align: center;
}
@keyframes pulse {
  50% {
    transform: scale(1.12);
    opacity: 0.6;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mic-icon.pulse {
    animation: none;
  }
}
</style>
