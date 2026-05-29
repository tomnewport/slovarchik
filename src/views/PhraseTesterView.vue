<script setup>
import { computed, reactive, ref, nextTick, onUnmounted } from 'vue'
import { phrases, state } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { record as recordAttempt } from '../stores/progress.js'
import { gradeFor } from '../lib/progress.js'
import {
  phraseTokens,
  phraseCorrect,
  nextChar,
  hintKeys,
  RU_LETTERS,
  EN_LETTERS,
} from '../lib/phrases.js'
import { speak } from '../lib/speech.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import HintKeyboard from '../components/HintKeyboard.vue'
import SpeakButton from '../components/SpeakButton.vue'

// How long the celebration plays before auto-advancing to the next phrase.
const CELEBRATE_MS = 1000

const ready = computed(() => phrases.value.length > 0)

const LEVELS = [
  { id: 'easy', label: 'Easy · build', help: 'Tap the words in the right order.' },
  { id: 'intermediate', label: 'Intermediate · guided', help: 'Type it; the keyboard hints each letter.' },
  { id: 'hard', label: 'Hard · blind', help: 'Type the whole translation, no help.' },
]

const level = ref(null)
const direction = ref('ru-en') // or 'en-ru'
const score = reactive({ right: 0, total: 0 })

const current = ref(null)
const answered = ref(false)
const wasCorrect = ref(false)
const typed = ref('')
const inputEl = ref(null)
const celebrating = ref(false)
let advanceTimer = null

// Easy mode: a shuffled bank of word tokens and the learner's placed sequence.
const bank = ref([])
const placed = ref([])

const sourceOf = (p) => (direction.value === 'ru-en' ? p.ru : p.en)
const targetOf = (p) => (direction.value === 'ru-en' ? p.en : p.ru)
// The translation's alphabet — drives the guided keyboard and Russian input.
const targetLang = computed(() => (direction.value === 'ru-en' ? 'en' : 'ru'))

function start(levelId) {
  level.value = levelId
  score.right = 0
  score.total = 0
  nextQuestion()
}

function nextQuestion() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  placed.value = []
  current.value = sample(phrases.value, 1)[0]
  if (direction.value === 'ru-en') speak(current.value.ru)
  if (level.value === 'easy') {
    const tokens = phraseTokens(targetOf(current.value)).map((text, id) => ({ id, text }))
    bank.value = sample(tokens, tokens.length) // shuffle
  } else if (level.value === 'hard') {
    nextTick(() => inputEl.value?.focus())
  }
}

function record(correct) {
  if (answered.value) return
  answered.value = true
  wasCorrect.value = correct
  score.total += 1
  // Spelling/word-order success or error for a phrase.
  recordAttempt({ kind: 'phrase', key: current.value.id }, gradeFor(level.value, correct), {
    level: level.value,
  })
  if (correct) {
    score.right += 1
    // Celebrate, then move straight to the next phrase.
    celebrating.value = true
    advanceTimer = setTimeout(nextQuestion, CELEBRATE_MS)
  }
}

// --- Easy: build the sentence from word tiles ---------------------------------
const placedIds = computed(() => new Set(placed.value.map((t) => t.id)))
const pool = computed(() => bank.value.filter((t) => !placedIds.value.has(t.id)))

function placeToken(token) {
  if (answered.value) return
  if (targetLang.value === 'ru') speak(token.text)
  placed.value = [...placed.value, token]
  if (placed.value.length === bank.value.length) {
    record(phraseCorrect(placed.value.map((t) => t.text).join(' '), targetOf(current.value)))
  }
}

function removeToken(token) {
  if (answered.value) return
  placed.value = placed.value.filter((t) => t.id !== token.id)
}

// --- Intermediate: guided keyboard --------------------------------------------
const highlight = computed(() => {
  if (level.value !== 'intermediate' || !current.value || answered.value) return []
  const letters = targetLang.value === 'ru' ? RU_LETTERS : EN_LETTERS
  return hintKeys(nextChar(targetOf(current.value), typed.value), letters)
})

function typeKey(ch) {
  if (!answered.value) typed.value += ch
}
function typeSpace() {
  if (!answered.value) typed.value += ' '
}
function typeBackspace() {
  if (!answered.value) typed.value = typed.value.slice(0, -1)
}

// --- Shared answer submission (intermediate + hard) ---------------------------
function submitTyped() {
  if (answered.value) {
    nextQuestion()
    return
  }
  record(phraseCorrect(typed.value, targetOf(current.value)))
}

function quit() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  level.value = null
  current.value = null
}

onUnmounted(() => clearTimeout(advanceTimer))
</script>

<template>
  <section v-if="!level" class="grid">
    <h2 style="margin: 0">Phrases</h2>
    <div class="row">
      <button :class="{ primary: direction === 'ru-en' }" @click="direction = 'ru-en'">
        RU → EN
      </button>
      <button :class="{ primary: direction === 'en-ru' }" @click="direction = 'en-ru'">
        EN → RU
      </button>
    </div>
    <p v-if="!ready && state.status === 'loading'" class="muted">Loading phrases…</p>
    <p v-else-if="!ready" class="feedback bad">
      No phrases available offline yet — connect once to download them.
    </p>
    <div class="grid">
      <button
        v-for="l in LEVELS"
        :key="l.id"
        class="card"
        style="text-align: left"
        :disabled="!ready"
        @click="start(l.id)"
      >
        <strong>{{ l.label }}</strong>
        <div class="muted">{{ l.help }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ direction === 'ru-en' ? 'RU → EN' : 'EN → RU' }} · {{ level }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <div class="card" style="text-align: center">
      <div class="muted">Translate</div>
      <div
        style="font-size: 1.5rem; margin: 0.5rem 0"
        :lang="direction === 'ru-en' ? 'ru' : 'en'"
      >
        {{ sourceOf(current) }}
      </div>
      <SpeakButton v-if="direction === 'ru-en'" :text="sourceOf(current)" />
    </div>

    <!-- Easy: build the sentence from shuffled word tiles -->
    <template v-if="level === 'easy'">
      <div class="answer-line" :lang="targetLang">
        <button
          v-for="token in placed"
          :key="token.id"
          class="tile placed"
          :disabled="answered"
          @click="removeToken(token)"
        >
          {{ token.text }}
        </button>
        <span v-if="!placed.length" class="muted">Tap words below…</span>
      </div>
      <div class="row" style="flex-wrap: wrap" :lang="targetLang">
        <button
          v-for="token in pool"
          :key="token.id"
          class="tile"
          :disabled="answered"
          @click="placeToken(token)"
        >
          {{ token.text }}
        </button>
      </div>
    </template>

    <!-- Intermediate: guided on-screen keyboard -->
    <template v-else-if="level === 'intermediate'">
      <div class="answer-box" :lang="targetLang">
        {{ typed }}<span class="caret" :class="{ on: !answered }">|</span>
      </div>
      <HintKeyboard
        :layout="targetLang"
        :highlight="highlight"
        @press="typeKey"
        @space="typeSpace"
        @backspace="typeBackspace"
        @enter="submitTyped"
      />
      <button v-if="!answered" class="primary" @click="submitTyped">Check</button>
    </template>

    <!-- Hard: type the whole translation -->
    <form v-else @submit.prevent="submitTyped" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        :lang="targetLang"
        :disabled="answered"
        :placeholder="targetLang === 'ru' ? 'наберите по-русски' : 'type in English'"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button v-if="!answered" type="submit" class="primary">Check</button>
    </form>

    <div v-if="answered" class="grid">
      <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
        {{ wasCorrect ? '✓ Correct!' : '✗ Answer: ' + targetOf(current) }}
        <SpeakButton v-if="!wasCorrect && direction === 'en-ru'" :text="targetOf(current)" />
      </p>
      <!-- Correct answers advance on their own; only wrong answers wait. -->
      <div v-if="!wasCorrect" class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>

<style scoped>
.tile {
  padding: 0.5rem 0.8rem;
  font-size: 1.05rem;
}

.tile.placed {
  border-color: var(--primary);
  background: rgba(79, 125, 255, 0.18);
}

.answer-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  min-height: 2.6rem;
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}

.answer-box {
  min-height: 2.6rem;
  padding: 0.6rem 0.8rem;
  font-size: 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
  word-break: break-word;
}

.caret {
  color: var(--muted);
  opacity: 0;
}

.caret.on {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .caret.on {
    animation: none;
    opacity: 1;
  }
}
</style>
