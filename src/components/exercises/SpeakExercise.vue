<script setup>
// Speaking exercise: say the Russian word or phrase aloud. When the browser can
// recognise speech (Chrome / Edge, online) we listen and grade what's heard with
// a forgiving 80% letter-similarity threshold — so a single mangled ending still
// passes. When recognition is unavailable we fall back to self-assessment (an
// attempt counts, per #79) and say so. Either way the model answer is read aloud
// the moment the exercise appears, and again with the result so it can be echoed.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { typingSequence } from '../../lib/phrases.js'
import { speak, speechSupported, cancelSpeech } from '../../lib/speech.js'
import {
  listen,
  gradeSpoken,
  recognitionSupported,
  recognitionErrorMessage,
} from '../../lib/recognition.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const canRecognize = recognitionSupported()

// Grade fuzzily — 80% of the letters lining up counts as said correctly.
const THRESHOLD = 0.8

// Give a reasonable window to finish speaking: ~3s for a word, ~10s for a phrase.
const isPhrase = computed(() => props.exercise.content === 'phrase')
const maxListenMs = computed(() => (isPhrase.value ? 10000 : 3000))

// Letters expected, so we can stop early once roughly that much has been heard
// instead of waiting out the whole window for a short word.
const targetLetters = computed(() => typingSequence(props.exercise.ru).replace(/\s+/g, '').length)

// phase: 'prompt' (read out, waiting to speak) | 'listening' | 'graded'
const phase = ref('prompt')
const transcript = ref('')
const recError = ref('')
const result = ref(null) // { correct, similarity }

let recCtl = null
let cancelled = false
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

const errorMessage = computed(() =>
  recError.value ? recognitionErrorMessage(recError.value) : '',
)

// Rough upper bound on how long the prompt takes to read aloud, so the watchdog
// that opens the mic can wait out a long phrase rather than cut in mid-speech.
function estimateSpeechMs(text) {
  return Math.min(12000, Math.max(2500, String(text ?? '').length * 90 + 1200))
}

function speakTarget() {
  if (speechSupported()) speak(props.exercise.ru)
}

function stopRecognition() {
  if (recCtl) {
    recCtl.abort()
    recCtl = null
  }
}

function beginListen() {
  if (!canRecognize || phase.value === 'graded' || cancelled) return
  stopRecognition()
  clearTimers()
  earlyTimer = null
  recError.value = ''
  transcript.value = ''
  phase.value = 'listening'
  recCtl = listen({
    lang: 'ru-RU',
    onResult: ({ transcript: heard }) => {
      if (cancelled) return
      transcript.value = heard
      maybeFinishEarly(heard)
    },
    onError: (err) => {
      if (!cancelled) recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      clearTimers()
      if (cancelled || phase.value !== 'listening') return
      if (!finalText) {
        // Heard nothing — drop back to the prompt so they can try again rather
        // than scoring an empty attempt as wrong.
        phase.value = 'prompt'
        if (!recError.value) recError.value = 'no-speech'
        return
      }
      grade(finalText, alternatives)
    },
  })
  // Hard cap: stop after the allotted window even if the recogniser doesn't.
  later(() => recCtl?.stop(), maxListenMs.value)
}

// Once we've heard roughly as many letters as the target, give the recogniser a
// short grace period to finalise, then stop — so a quick word concludes promptly.
let earlyTimer = null
function maybeFinishEarly(heard) {
  if (earlyTimer || !targetLetters.value) return
  const heardLetters = typingSequence(heard).replace(/\s+/g, '').length
  if (heardLetters >= targetLetters.value * 0.8) {
    earlyTimer = later(() => {
      earlyTimer = null
      recCtl?.stop()
    }, 700)
  }
}

function grade(finalText, alternatives = []) {
  const guesses = alternatives.length ? alternatives : [finalText]
  const { correct, similarity, best } = gradeSpoken(guesses, props.exercise.ru, THRESHOLD)
  transcript.value = best || transcript.value
  result.value = { correct, similarity }
  phase.value = 'graded'
  speakTarget() // hear the model answer alongside the result
}

function tryAgain() {
  result.value = null
  recError.value = ''
  beginListen()
}

// Self-assessment fallback (no recognition): the attempt counts.
function selfAssessed() {
  emit('done', { correct: true })
}

function next() {
  emit('done', { correct: result.value?.correct ?? false })
}

onMounted(() => {
  // Read the word/phrase aloud the moment it appears (the main subject). When we
  // can recognise speech, start listening once the prompt finishes so the mic
  // doesn't pick up the synthesised voice; a watchdog opens it if onEnd is flaky.
  if (canRecognize && speechSupported()) {
    let opened = false
    const open = () => {
      if (opened || cancelled || phase.value !== 'prompt') return
      opened = true
      beginListen()
    }
    speak(props.exercise.ru, 'ru-RU', 0.9, { onEnd: open })
    // Scale the fallback to how long the prompt should take to read, so it can't
    // open the mic mid-speech on a long phrase when onEnd is slow to fire.
    later(open, estimateSpeechMs(props.exercise.ru) + 1500)
  } else {
    speakTarget()
  }
})

onBeforeUnmount(() => {
  cancelled = true
  clearTimers()
  stopRecognition()
  cancelSpeech()
})
</script>

<template>
  <div class="grid speak" style="gap: 1rem">
    <p class="muted">Say it aloud</p>
    <div class="target">
      <span lang="ru" class="ru">{{ exercise.ru }}</span>
      <SpeakButton :text="exercise.ru" />
    </div>
    <p class="muted en">{{ exercise.en }}</p>

    <!-- With recognition: listen, then grade fuzzily. -->
    <template v-if="canRecognize">
      <p v-if="errorMessage && phase !== 'graded'" class="feedback bad" style="margin: 0">
        {{ errorMessage }}
      </p>

      <template v-if="phase === 'listening'">
        <p class="listening">🎤 Listening…</p>
        <p v-if="transcript" lang="ru" class="heard">“{{ transcript }}”</p>
        <button class="primary done" @click="recCtl?.stop()">Done</button>
      </template>

      <template v-else-if="phase === 'prompt'">
        <button class="primary mic" @click="beginListen">🎤 Speak</button>
      </template>

      <template v-else>
        <p class="feedback" :class="result.correct ? 'good' : 'bad'">
          <template v-if="result.correct">✓ Got it!</template>
          <template v-else>✗ Not quite</template>
          <span class="match-score">· {{ Math.round(result.similarity * 100) }}% letters</span>
        </p>
        <p v-if="transcript" class="muted heard" style="margin: 0">Heard: “{{ transcript }}”</p>
        <div class="row">
          <button class="primary next" @click="next">Next →</button>
          <button v-if="!result.correct" @click="tryAgain">🎤 Try again</button>
        </div>
      </template>
    </template>

    <!-- No recognition: self-assess (the attempt counts). -->
    <template v-else>
      <p class="muted info">
        Speech recognition isn’t available in this browser (try Chrome or Edge) — listen, say it
        aloud, then mark it done yourself.
      </p>
      <div class="row">
        <button class="primary next" @click="selfAssessed">I said it →</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.target {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.6rem;
}
.en {
  font-size: 1.1rem;
}
.info {
  font-size: 0.9rem;
}
.mic {
  font-size: 1.15rem;
  padding: 0.6rem 1.4rem;
  justify-self: start;
}
.listening {
  margin: 0;
  font-size: 1.2rem;
  animation: pulse 1.2s ease-in-out infinite;
}
.heard {
  font-style: italic;
}
.match-score {
  margin-left: 0.4rem;
  font-weight: 400;
  opacity: 0.85;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .listening {
    animation: none;
  }
}
</style>
