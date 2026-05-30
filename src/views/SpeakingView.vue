<script setup>
import { computed, reactive, ref, onUnmounted } from 'vue'
import { phrases, state } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { record as recordAttempt } from '../stores/progress.js'
import { gradeFor } from '../lib/progress.js'
import { speak, speakSequence, cancelSpeech } from '../lib/speech.js'
import {
  listen,
  gradeSpoken,
  wordDiff,
  isPass,
  recognitionSupported,
  recognitionErrorMessage,
} from '../lib/recognition.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'

// How long the ✓ celebration shows before the hands-free loop moves on.
const CELEBRATE_MS = 1100

// The three speaking challenges. `recLang` is what the recogniser listens for;
// `target` is the field of the phrase the spoken answer is graded against;
// `promptRu` reads the Russian aloud when the question appears; `showRu`/`showEn`
// decide what's on screen before the answer is revealed.
const MODES = [
  {
    id: 'echo',
    emoji: '🗣️',
    label: 'Echo · say it in Russian',
    help: 'See the Russian and English, hear it read out, then say it back. Checks your pronunciation.',
    recLang: 'ru-RU',
    target: 'ru',
    promptRu: true,
    showRu: true,
    showEn: true,
  },
  {
    id: 'produce',
    emoji: '🇷🇺',
    label: 'Produce · translate into Russian',
    help: 'See the English, say the Russian. The correct phrase is then read aloud.',
    recLang: 'ru-RU',
    target: 'ru',
    promptRu: false,
    showRu: false,
    showEn: true,
  },
  {
    id: 'interpret',
    emoji: '🎧',
    label: 'Interpret · translate into English',
    help: 'Hear a Russian phrase, say the English — or say “pass”. Hands-free with spoken feedback.',
    recLang: 'en-GB',
    target: 'en',
    promptRu: true,
    showRu: false,
    showEn: false,
  },
]

const canRecognize = recognitionSupported()
const ready = computed(() => phrases.value.length > 0)

const mode = ref(null)
const modeCfg = computed(() => MODES.find((m) => m.id === mode.value) ?? null)
const handsFree = ref(true)
const score = reactive({ right: 0, total: 0 })

// phase: 'prompt' (waiting / reading) | 'listening' | 'graded'
const phase = ref('prompt')
const current = ref(null)
const transcript = ref('')
const recError = ref('')
const result = ref(null) // { correct, passed, similarity }
const celebrating = ref(false)

let recCtl = null
let advanceTimer = null

const errorMessage = computed(() =>
  recError.value ? recognitionErrorMessage(recError.value) : '',
)

function start(modeId) {
  mode.value = modeId
  score.right = 0
  score.total = 0
  nextQuestion()
}

function stopRecognition() {
  if (recCtl) {
    recCtl.abort()
    recCtl = null
  }
}

function nextQuestion() {
  clearTimeout(advanceTimer)
  stopRecognition()
  cancelSpeech()
  celebrating.value = false
  phase.value = 'prompt'
  transcript.value = ''
  recError.value = ''
  result.value = null
  current.value = sample(phrases.value, 1)[0]
  presentPrompt()
}

// Read the prompt (if the mode reads Russian) and, hands-free, start listening
// the moment the prompt finishes — never while the phone is still talking, or
// the mic would hear the synthesised voice.
function presentPrompt() {
  if (modeCfg.value?.promptRu) {
    const spoke = speak(current.value.ru, 'ru-RU', 0.9, {
      onEnd: () => {
        if (handsFree.value && phase.value === 'prompt') beginListen()
      },
    })
    if (!spoke && handsFree.value) beginListen()
  } else if (handsFree.value) {
    beginListen()
  }
}

function replayPrompt() {
  if (!current.value) return
  if (modeCfg.value?.promptRu) speak(current.value.ru)
}

function beginListen() {
  if (!canRecognize || phase.value === 'graded') return
  stopRecognition()
  recError.value = ''
  transcript.value = ''
  phase.value = 'listening'
  recCtl = listen({
    lang: modeCfg.value.recLang,
    onResult: ({ transcript: heard }) => {
      transcript.value = heard
    },
    onError: (err) => {
      recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      // A real error (permission/network) leaves us on the prompt to retry;
      // a plain empty result after the user spoke nothing does too.
      if (phase.value !== 'listening') return
      if (!finalText) {
        phase.value = 'prompt'
        return
      }
      grade(finalText, alternatives)
    },
  })
}

// User taps "Done" to finish a manual recording early.
function finishListening() {
  if (recCtl) recCtl.stop()
}

function grade(finalText, alternatives = []) {
  const passed = isPass(finalText)
  const target = current.value[modeCfg.value.target]
  // Grade on the most generous of all the recogniser's guesses; the winning
  // guess (`best`) is what we show and diff against.
  const guesses = [finalText, ...alternatives]
  const { correct, similarity, best } = passed
    ? { correct: false, similarity: 0, best: finalText }
    : gradeSpoken(guesses, target)
  // Per-word breakdown of the best guess, so the highlighted words line up with
  // the score (skip it on a deliberate pass — there was no real attempt).
  const diff = passed ? null : wordDiff(best, target)
  reveal({ correct, passed, similarity, diff, heard: best })
}

function reveal({ correct, passed, similarity, diff, heard }) {
  phase.value = 'graded'
  if (heard) transcript.value = heard
  result.value = { correct, passed, similarity, diff, targetLang: modeCfg.value.target }
  score.total += 1
  if (correct) {
    score.right += 1
    celebrating.value = true
  }
  // A speaking attempt is an intermediate-difficulty production task.
  recordAttempt({ kind: 'phrase', key: current.value.id }, gradeFor('intermediate', correct), {
    level: 'speaking',
    mode: mode.value,
  })

  // Spoken feedback: a short English cue, then the Russian phrase so you always
  // hear the model answer — the heart of the hands-free loop.
  const cue = correct ? 'Correct.' : passed ? 'Passed.' : 'Not quite.'
  speakSequence([
    { text: cue, lang: 'en-GB', rate: 1 },
    { text: current.value.ru, lang: 'ru-RU', rate: 0.9 },
  ], {
    onEnd: () => {
      if (handsFree.value && phase.value === 'graded') {
        advanceTimer = setTimeout(nextQuestion, correct ? CELEBRATE_MS : 1400)
      }
    },
  })
}

function quit() {
  clearTimeout(advanceTimer)
  stopRecognition()
  cancelSpeech()
  celebrating.value = false
  mode.value = null
  current.value = null
  result.value = null
}

onUnmounted(() => {
  clearTimeout(advanceTimer)
  stopRecognition()
  cancelSpeech()
})
</script>

<template>
  <!-- Mode picker --------------------------------------------------------- -->
  <section v-if="!mode" class="grid">
    <h2 style="margin: 0">Speaking</h2>
    <p class="muted" style="margin: 0">
      Practise saying Russian (and translating) out loud — your browser listens and grades
      what it hears. Best with headphones in a quiet room.
    </p>

    <p v-if="!canRecognize" class="feedback bad">
      This browser can’t recognise speech. Speaking drills need Chrome or Edge (and a network
      connection); they won’t work here.
    </p>

    <p v-if="!ready && state.status === 'loading'" class="muted">Loading phrases…</p>
    <p v-else-if="!ready" class="feedback bad">
      No phrases available offline yet — connect once to download them.
    </p>

    <label class="row" style="gap: 0.5rem; align-items: center">
      <input v-model="handsFree" type="checkbox" />
      <span>Hands-free — auto-listen and read feedback aloud</span>
    </label>

    <div class="grid">
      <button
        v-for="m in MODES"
        :key="m.id"
        class="card"
        style="text-align: left"
        :disabled="!ready || !canRecognize"
        @click="start(m.id)"
      >
        <strong>{{ m.emoji }} {{ m.label }}</strong>
        <div class="muted">{{ m.help }}</div>
      </button>
    </div>
  </section>

  <!-- Drill ---------------------------------------------------------------- -->
  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ modeCfg.emoji }} {{ mode }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <!-- Prompt card: what to say -->
    <div class="card" style="text-align: center">
      <div class="muted">
        {{ modeCfg.target === 'ru' ? 'Say this in Russian' : 'Say this in English' }}
      </div>

      <div v-if="modeCfg.showRu" lang="ru" style="font-size: 1.5rem; margin: 0.5rem 0">
        {{ current.ru }}
      </div>
      <div v-if="modeCfg.showEn" lang="en" style="font-size: 1.35rem; margin: 0.4rem 0">
        {{ current.en }}
      </div>
      <!-- Interpret mode hides everything until you've answered. -->
      <p v-if="!modeCfg.showRu && !modeCfg.showEn" class="muted" style="margin: 0.5rem 0">
        🎧 Listen, then say the English translation — or say “pass”.
      </p>

      <button v-if="modeCfg.promptRu" class="primary replay" @click="replayPrompt">
        🔊 Replay
      </button>
    </div>

    <!-- Microphone / status -->
    <div class="mic-area">
      <p v-if="errorMessage" class="feedback bad" style="margin: 0">{{ errorMessage }}</p>

      <template v-if="phase === 'listening'">
        <p class="listening">🎤 Listening…</p>
        <p v-if="transcript" class="heard" :lang="modeCfg.recLang.slice(0, 2)">“{{ transcript }}”</p>
        <button class="primary" @click="finishListening">Done</button>
      </template>

      <template v-else-if="phase === 'prompt'">
        <button v-if="canRecognize" class="primary mic" @click="beginListen">🎤 Speak</button>
        <button @click="nextQuestion">Skip →</button>
      </template>
    </div>

    <!-- Result -->
    <div v-if="phase === 'graded'" class="grid">
      <p
        class="feedback"
        :class="result.correct ? 'good' : 'bad'"
      >
        <template v-if="result.correct">✓ Correct!</template>
        <template v-else-if="result.passed">↷ Passed</template>
        <template v-else>✗ Not quite</template>
        <span v-if="!result.passed" class="match-score">· {{ Math.round(result.similarity * 100) }}% letters</span>
      </p>

      <!-- Per-word breakdown: which words landed (green) and which were missed
           or misheard (struck through) against what you were asked to say. -->
      <div v-if="result.diff && result.diff.words.length" class="word-diff" :lang="result.targetLang">
        <span
          v-for="(w, i) in result.diff.words"
          :key="i"
          :class="w.skip ? '' : w.hit ? 'word-hit' : 'word-miss'"
        >{{ w.text }}</span>
      </div>
      <p v-if="result.diff && result.diff.extra.length" class="muted extra-words" style="margin: 0">
        Extra heard: {{ result.diff.extra.join(', ') }}
      </p>

      <p v-if="transcript" class="muted heard" style="margin: 0">
        Heard: “{{ transcript }}”
      </p>

      <div class="card" style="text-align: left">
        <div class="muted" style="font-size: 0.85rem">Answer</div>
        <div class="row" style="gap: 0.4rem; align-items: center">
          <span lang="ru" style="font-size: 1.25rem">{{ current.ru }}</span>
          <SpeakButton :text="current.ru" />
        </div>
        <div lang="en" class="muted" style="margin-top: 0.25rem">{{ current.en }}</div>
      </div>

      <div class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button v-if="canRecognize && !result.correct" @click="phase = 'prompt'; beginListen()">
          🎤 Try again
        </button>
        <button style="margin-left: auto" @click="quit">Change mode</button>
      </div>
    </div>

    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>

<style scoped>
.replay {
  margin: 0.5rem auto 0;
  font-size: 1.05rem;
}

.match-score {
  margin-left: 0.4rem;
  font-weight: 400;
  opacity: 0.85;
}

.word-diff {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  font-size: 1.2rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

.word-hit {
  color: var(--good, #1a9d52);
}

.word-miss {
  color: var(--bad, #d23b3b);
  text-decoration: underline wavy;
  text-underline-offset: 3px;
}

.extra-words {
  font-size: 0.9rem;
}

.mic-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  min-height: 3rem;
}

.mic {
  font-size: 1.15rem;
  padding: 0.6rem 1.4rem;
}

.listening {
  margin: 0;
  font-size: 1.2rem;
  animation: pulse 1.2s ease-in-out infinite;
}

.heard {
  font-style: italic;
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
