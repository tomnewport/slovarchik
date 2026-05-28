<script setup>
import { computed, reactive, ref, nextTick, onUnmounted } from 'vue'
import { vocab, state } from '../stores/vocab.js'
import { buildChoices, checkAnswer, maskWord, sample } from '../lib/quiz.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'

// How long the celebration plays before auto-advancing to the next question.
const CELEBRATE_MS = 1000

const ready = computed(() => vocab.value.length > 0)

const LEVELS = [
  { id: 'easy', label: 'Easy · match', help: 'Pick the right translation.' },
  { id: 'intermediate', label: 'Intermediate · hint', help: 'Type it, first letters shown.' },
  { id: 'advanced', label: 'Advanced · blind', help: 'Type it with no help.' },
]

const level = ref(null)
const direction = ref('ru-en') // or 'en-ru'
const score = reactive({ right: 0, total: 0 })

const current = ref(null)
const choices = ref([])
const answered = ref(false)
const wasCorrect = ref(false)
const typed = ref('')
const inputEl = ref(null)
const celebrating = ref(false)
let advanceTimer = null

// English answers may be arrays; show the first as the canonical prompt/answer.
const promptOf = (w) => (direction.value === 'ru-en' ? w.ru : firstEn(w))
const answerOf = (w) => (direction.value === 'ru-en' ? w.en : w.ru)
const displayAnswer = (w) => (direction.value === 'ru-en' ? firstEn(w) : w.ru)
function firstEn(w) {
  return Array.isArray(w.en) ? w.en[0] : w.en
}

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
  current.value = sample(vocab.value, 1)[0]
  if (level.value === 'easy') {
    choices.value = buildChoices(current.value, vocab.value, 4, (w) => w.id)
  } else {
    nextTick(() => inputEl.value?.focus())
  }
}

function record(correct) {
  if (answered.value) return
  answered.value = true
  wasCorrect.value = correct
  score.total += 1
  if (correct) {
    score.right += 1
    // Celebrate, then move straight to the next question.
    celebrating.value = true
    advanceTimer = setTimeout(nextQuestion, CELEBRATE_MS)
  }
}

function pick(word) {
  record(word.id === current.value.id)
}

function submitTyped() {
  if (answered.value) {
    nextQuestion()
    return
  }
  record(checkAnswer(typed.value, answerOf(current.value)))
}

const hint = computed(() => {
  if (!current.value) return ''
  const target = displayAnswer(current.value)
  return maskWord(target, 1)
})

function classFor(word) {
  if (!answered.value) return ''
  if (word.id === current.value.id) return 'correct'
  return 'wrong'
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
    <h2 style="margin: 0">Vocabulary</h2>
    <div class="row">
      <button
        :class="{ primary: direction === 'ru-en' }"
        @click="direction = 'ru-en'"
      >
        RU → EN
      </button>
      <button
        :class="{ primary: direction === 'en-ru' }"
        @click="direction = 'en-ru'"
      >
        EN → RU
      </button>
    </div>
    <p v-if="!ready && state.status === 'loading'" class="muted">Loading vocabulary…</p>
    <p v-else-if="!ready" class="feedback bad">
      No vocabulary available offline yet — connect once to download it.
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
      <div style="font-size: 2rem; margin: 0.5rem 0" lang="ru">{{ promptOf(current) }}</div>
      <div v-if="level === 'intermediate' && !answered" class="muted" style="letter-spacing: 0.2em">
        {{ hint }}
      </div>
    </div>

    <!-- Easy: multiple choice -->
    <div v-if="level === 'easy'" class="grid">
      <button
        v-for="opt in choices"
        :key="opt.id"
        class="choice"
        :class="classFor(opt)"
        :disabled="answered"
        @click="pick(opt)"
      >
        {{ displayAnswer(opt) }}
      </button>
    </div>

    <!-- Intermediate / advanced: typing -->
    <form v-else @submit.prevent="submitTyped" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        :disabled="answered"
        :placeholder="direction === 'ru-en' ? 'type in English' : 'наберите по-русски'"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button v-if="!answered" type="submit" class="primary">Check</button>
    </form>

    <div v-if="answered" class="grid">
      <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
        {{ wasCorrect ? '✓ Correct!' : '✗ Answer: ' + displayAnswer(current) }}
      </p>
      <p v-if="current.note" class="muted" style="margin: 0">{{ current.note }}</p>
      <!-- Correct answers advance on their own; only wrong answers wait for the user. -->
      <div v-if="!wasCorrect" class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>
