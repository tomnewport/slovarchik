<script setup>
import { computed, reactive, ref, nextTick } from 'vue'
import { vocab } from '../data/vocab.js'
import { buildChoices, checkAnswer, maskWord, sample } from '../lib/quiz.js'

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
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  current.value = sample(vocab, 1)[0]
  if (level.value === 'easy') {
    choices.value = buildChoices(current.value, vocab, 4, (w) => w.id)
  } else {
    nextTick(() => inputEl.value?.focus())
  }
}

function record(correct) {
  if (answered.value) return
  answered.value = true
  wasCorrect.value = correct
  score.total += 1
  if (correct) score.right += 1
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
  level.value = null
  current.value = null
}
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
    <div class="grid">
      <button v-for="l in LEVELS" :key="l.id" class="card" style="text-align: left" @click="start(l.id)">
        <strong>{{ l.label }}</strong>
        <div class="muted">{{ l.help }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem">
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
      <div class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>
