<script setup>
import { computed, reactive, ref } from 'vue'
import { phrases, state } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { speak, estimateSpeechMs, SLOW_RATE } from '../lib/speech.js'
import { recognitionSupported, recognitionErrorMessage } from '../lib/recognition.js'
import { makeVisualReplacement } from '../lib/exerciseBuild.js'
import { useSpeechLoop } from '../composables/useSpeechLoop.js'
import {
  MODES,
  findMode,
  needsWarmUp,
  buildWarmUpSequence,
  gradeGuesses,
  buildFeedbackSequence,
  shouldRetryEmpty,
  CELEBRATE_MS,
  REVIEW_MS,
} from '../lib/speakingDrill.js'
import AnnotatedEnglish from '../components/AnnotatedEnglish.vue'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'
import WordBankExercise from '../components/exercises/WordBankExercise.vue'

const canRecognize = recognitionSupported()
const ready = computed(() => phrases.value.length > 0)

const mode = ref(null)
const modeCfg = computed(() => findMode(mode.value))
const handsFree = ref(true)
const score = reactive({ right: 0, total: 0 })

// phase: 'prompt' (waiting / reading) | 'listening' | 'graded'
const phase = ref('prompt')
const current = ref(null)
const transcript = ref('')
const recError = ref('')
const result = ref(null) // { correct, passed, similarity }
const celebrating = ref(false)

let visSeq = 0
const visualExercise = ref(null)
// Auto re-listens after a silent result, capped so a blocked mic can't spin
// (the cap and fatal-error set live in speakingDrill.shouldRetryEmpty).
let emptyRetries = 0

// Speech/mic orchestration shared with PracticeView: the sequence guard (`seq`,
// bumped on every question change / quit so callbacks captured by an earlier
// question bail), the timer registry, the speech watchdogs, the wake lock and
// the recognition lifecycle. See composables/useSpeechLoop.js.
const {
  // Not read by this component — bound so the step counter stays visible to the
  // template scope, Vue devtools and the view's tests.
  // eslint-disable-next-line no-unused-vars
  seq,
  later,
  clearTimers,
  onceForStep: onceForQuestion,
  readThen,
  listenGuarded,
  stopRecognition,
  stopListening,
  acquireWakeLock,
  releaseWakeLock,
  resetLoop,
} = useSpeechLoop({ isActive: () => Boolean(mode.value) })

const errorMessage = computed(() =>
  recError.value ? recognitionErrorMessage(recError.value) : '',
)

function start(modeId) {
  mode.value = modeId
  score.right = 0
  score.total = 0
  acquireWakeLock()
  nextQuestion()
}

function nextQuestion() {
  resetLoop()
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
    // For long phrases in hands-free mode, run a word-by-word warm-up sequence
    // before the first listening attempt so the learner has heard each part.
    if (needsWarmUp(current.value.ru, handsFree.value)) {
      presentWithWarmUp()
      return
    }
    const onEnd = onceForQuestion(() => {
      if (handsFree.value && phase.value === 'prompt') beginListen()
    }, estimateSpeechMs(current.value.ru) + 1500)
    const spoke = speak(current.value.ru, 'ru-RU', 0.9, { onEnd })
    if (!spoke) onEnd() // no TTS — don't wait on a callback that won't come
  } else if (handsFree.value) {
    beginListen()
  }
}

// Warm-up sequence for long phrases: full Russian → English → slow Russian →
// "Repeat each word:" → each word individually. Begins listening afterwards.
function presentWithWarmUp() {
  readThen(
    buildWarmUpSequence(current.value),
    () => {
      if (handsFree.value && phase.value === 'prompt') beginListen()
    },
    2000,
  )
}

function replayPrompt() {
  if (!current.value) return
  if (modeCfg.value?.promptRu) speak(current.value.ru)
}

// Read the prompt slowly: pause recognition (if active), speak at SLOW_RATE,
// then resume listening once the slow read finishes (hands-free mode only).
function replaySlowPrompt() {
  if (!current.value || !modeCfg.value?.promptRu) return
  const wasListening = phase.value === 'listening'
  stopRecognition()
  clearTimers()
  phase.value = 'prompt'
  const onEnd = onceForQuestion(() => {
    if (handsFree.value && phase.value === 'prompt' && wasListening) beginListen()
  }, estimateSpeechMs(current.value.ru, SLOW_RATE) + 1500)
  const spoke = speak(current.value.ru, 'ru-RU', SLOW_RATE, { onEnd })
  if (!spoke) onEnd()
}

function beginListen() {
  if (!canRecognize || phase.value === 'graded') return
  recError.value = ''
  transcript.value = ''
  phase.value = 'listening'
  // Stale results (from a question we've already left) are dropped by the
  // composable's sequence guard; only the phase check is ours.
  listenGuarded({
    lang: modeCfg.value.recLang,
    onResult: ({ transcript: heard }) => {
      transcript.value = heard
    },
    onError: (err) => {
      recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      if (phase.value !== 'listening') return
      if (!finalText) {
        // Empty result (usually a silent 'no-speech'): drop back to the prompt,
        // and hands-free re-open the mic so a quiet moment doesn't end the loop
        // — but not on a fatal error, and not forever.
        phase.value = 'prompt'
        if (shouldRetryEmpty(handsFree.value, recError.value, emptyRetries)) {
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
  stopListening()
}

function grade(finalText, alternatives = []) {
  // Grade on the most generous of all the recogniser's guesses; the winning
  // guess (`best`) is what we show and diff against. `onEnd` already passes the
  // best guess as `finalText` and the full set as `alternatives`.
  const target = current.value[modeCfg.value.target]
  const { correct, passed, similarity, best, diff } = gradeGuesses(finalText, alternatives, target)
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
  // even if speechSynthesis never reports the sequence finishing. The Russian is
  // read slowly when wrong so the learner gets a clear model to echo.
  const { sequence } = buildFeedbackSequence({ correct, passed }, current.value.ru)
  readThen(sequence, () => {
    if (handsFree.value && phase.value === 'graded') {
      later(nextQuestion, correct ? CELEBRATE_MS : REVIEW_MS)
    }
  })
}

function tryAgain() {
  resetLoop()
  celebrating.value = false
  emptyRetries = 0
  phase.value = 'prompt'
  transcript.value = ''
  recError.value = ''
  result.value = null
  beginListen()
}

function skipToVisual() {
  const phrase = current.value
  if (!phrase) { nextQuestion(); return }
  const rep = makeVisualReplacement(
    { ru: phrase.ru, en: phrase.en, content: 'phrase', targets: phrase.source ? [phrase.source] : [] },
    visSeq++,
  )
  if (!rep) { nextQuestion(); return }
  resetLoop()
  celebrating.value = false
  phase.value = 'prompt'
  transcript.value = ''
  recError.value = ''
  result.value = null
  visualExercise.value = rep
}

function onVisualDone({ correct }) {
  score.total += 1
  if (correct) score.right += 1
  visualExercise.value = null
  nextQuestion()
}

function quit() {
  resetLoop()
  celebrating.value = false
  mode.value = null
  current.value = null
  result.value = null
  visualExercise.value = null
  releaseWakeLock()
}
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
      browser maker's cloud service to transcribe it — it isn't processed on your device.
    </p>

    <p v-if="!canRecognize" class="feedback bad">
      This browser can't recognise speech. Speaking drills need Chrome or Edge (and a network
      connection); they won't work here.
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

    <!-- Visual replacement exercise shown after skipping a phrase -->
    <template v-if="visualExercise">
      <p class="muted" style="margin: 0; font-size: 0.85rem">Skipped — now translate it visually</p>
      <WordBankExercise :key="visualExercise.id" :exercise="visualExercise" @done="onVisualDone" />
      <button style="justify-self: start" @click="quit">Change mode</button>
    </template>

    <template v-else>
      <!-- Prompt card: what to say -->
      <div class="card" style="text-align: center">
        <div class="muted">
          {{ modeCfg.target === 'ru' ? 'Say this in Russian' : 'Say this in English' }}
        </div>

        <div v-if="modeCfg.showRu" lang="ru" style="font-size: 1.5rem; margin: 0.5rem 0">
          {{ current.ru }}
        </div>
        <div v-if="modeCfg.showEn" lang="en" style="font-size: 1.35rem; margin: 0.4rem 0">
          <!-- Annotate the ambiguous words only when the Russian is hidden
               (produce mode): with the Russian on screen there is nothing for
               the learner to guess. -->
          <AnnotatedEnglish :text="current.en" :notes="modeCfg.showRu ? [] : (current.enNotes ?? [])" />
        </div>
        <!-- Interpret mode hides everything until you've answered. -->
        <p v-if="!modeCfg.showRu && !modeCfg.showEn" class="muted" style="margin: 0.5rem 0">
          🎧 Listen, then say the English translation — or say "pass".
        </p>

        <div v-if="modeCfg.promptRu" class="replay-row">
          <button class="primary replay" @click="replayPrompt">🔊 Replay</button>
          <button class="replay" @click="replaySlowPrompt">🐢 Slow</button>
        </div>
      </div>

      <!-- Microphone / status -->
      <div class="mic-area">
        <p v-if="errorMessage" class="feedback bad" style="margin: 0">{{ errorMessage }}</p>

        <template v-if="phase === 'listening'">
          <p class="listening">🎤 Listening…</p>
          <p v-if="transcript" class="heard" :lang="modeCfg.recLang.slice(0, 2)">"{{ transcript }}"</p>
          <button class="primary" @click="finishListening">Done</button>
        </template>

        <template v-else-if="phase === 'prompt'">
          <button v-if="canRecognize" class="primary mic" @click="beginListen">🎤 Speak</button>
          <button @click="skipToVisual">Skip →</button>
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
          Heard: "{{ transcript }}"
        </p>

        <div class="card" style="text-align: left">
          <div class="muted" style="font-size: 0.85rem">Answer</div>
          <div class="row" style="gap: 0.4rem; align-items: center">
            <span lang="ru" style="font-size: 1.25rem">{{ current.ru }}</span>
            <SpeakButton :text="current.ru" :slow="true" />
          </div>
          <div lang="en" class="muted" style="margin-top: 0.25rem">{{ current.en }}</div>
        </div>

        <div class="row">
          <button class="primary" @click="nextQuestion">Next →</button>
          <button v-if="canRecognize && !result.correct" @click="tryAgain">
            🎤 Try again
          </button>
          <button style="margin-left: auto" @click="quit">Change mode</button>
        </div>
      </div>

      <button v-else style="justify-self: start" @click="quit">Change mode</button>
    </template>
  </section>
</template>

<style scoped>
.replay-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.5rem;
}

.replay {
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
