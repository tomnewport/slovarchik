<script setup>
import { computed, reactive, ref, onUnmounted } from 'vue'
import { phrases, state } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
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
const CELEBRATE_MS = 2500
// How long to pause after the model answer is read aloud (incorrect / passed),
// giving enough time to read the phrase and attempt to repeat it.
const REVIEW_MS = 4000

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
// Bumped on every question change / quit so callbacks captured by an earlier
// question (a late recogniser result, or a `speechSynthesis.cancel()` that
// retro-fires the old utterance's `onend`) bail instead of acting on the new one.
let seq = 0
// Auto re-listens after a silent result, capped so a blocked mic can't spin.
let emptyRetries = 0
const MAX_EMPTY_RETRIES = 5
// Errors that won't fix themselves — never auto-retry listening on these.
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'network',
  'unsupported',
])

// Pending timers (watchdogs + advance delays), all cleared on any transition.
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

// Rough upper bound on how long an utterance takes to read, so a watchdog can
// rescue the hands-free loop when speechSynthesis never fires `onend` (a known
// flaky case: long utterances, backgrounded tabs, after a cancel()).
function estimateSpeechMs(text) {
  return Math.min(12000, Math.max(2500, String(text ?? '').length * 90 + 1200))
}

// Run `action` exactly once for the *current* question — whichever fires first,
// the speech `onEnd` callback or the watchdog. Returns the callback to hand to
// speak()/speakSequence(); a stale call from a previous question is ignored.
function onceForQuestion(action, watchdogMs) {
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
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  celebrating.value = false
  emptyRetries = 0
  phase.value = 'prompt'
  transcript.value = ''
  recError.value = ''
  result.value = null
  current.value = sample(phrases.value, 1)[0]
  presentPrompt()
}

// Read the prompt (if the mode reads Russian) and, hands-free, start listening
// the moment the prompt finishes — never while the phone is still talking, or
// the mic would hear the synthesised voice. A watchdog opens the mic anyway if
// `onend` never arrives.
function presentPrompt() {
  if (modeCfg.value?.promptRu) {
    const onEnd = onceForQuestion(() => {
      if (handsFree.value && phase.value === 'prompt') beginListen()
    }, estimateSpeechMs(current.value.ru) + 1500)
    const spoke = speak(current.value.ru, 'ru-RU', 0.9, { onEnd })
    if (!spoke) onEnd() // no TTS — don't wait on a callback that won't come
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
  const mySeq = seq
  recError.value = ''
  transcript.value = ''
  phase.value = 'listening'
  recCtl = listen({
    lang: modeCfg.value.recLang,
    onResult: ({ transcript: heard }) => {
      if (mySeq === seq) transcript.value = heard
    },
    onError: (err) => {
      if (mySeq === seq) recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      // Ignore a result that arrives after we've already moved on.
      if (mySeq !== seq || phase.value !== 'listening') return
      if (!finalText) {
        // Empty result (usually a silent 'no-speech'): drop back to the prompt,
        // and hands-free re-open the mic so a quiet moment doesn't end the loop
        // — but not on a fatal error, and not forever.
        phase.value = 'prompt'
        const retryable = handsFree.value && !FATAL_ERRORS.has(recError.value)
        if (retryable && emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries += 1
          later(() => {
            if (phase.value === 'prompt' && handsFree.value) beginListen()
          }, 700)
        }
        return
      }
      emptyRetries = 0
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
  // guess (`best`) is what we show and diff against. `onEnd` already passes the
  // best guess as `finalText` and the full set as `alternatives`.
  const guesses = alternatives.length ? alternatives : [finalText]
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

  // Spoken feedback: a short English cue, then the Russian phrase so you always
  // hear the model answer — the heart of the hands-free loop. A watchdog advances
  // even if speechSynthesis never reports the sequence finishing.
  const cue = correct ? 'Correct.' : passed ? 'Passed.' : 'Not quite.'
  const advance = onceForQuestion(() => {
    if (handsFree.value && phase.value === 'graded') {
      later(nextQuestion, correct ? CELEBRATE_MS : REVIEW_MS)
    }
  }, estimateSpeechMs(cue) + estimateSpeechMs(current.value.ru) + 1500)
  const spoke = speakSequence(
    [
      { text: cue, lang: 'en-GB', rate: 1 },
      { text: current.value.ru, lang: 'ru-RU', rate: 0.9 },
    ],
    { onEnd: advance },
  )
  if (!spoke) advance()
}

function quit() {
  seq += 1
  clearTimers()
  stopRecognition()
  cancelSpeech()
  celebrating.value = false
  mode.value = null
  current.value = null
  result.value = null
}

onUnmounted(() => {
  clearTimers()
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

    <p v-if="canRecognize" class="muted" style="margin: 0; font-size: 0.85rem">
      🔒 Heads-up: in Chrome and Edge, speech recognition sends your microphone audio to the
      browser maker’s cloud service to transcribe it — it isn’t processed on your device.
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
