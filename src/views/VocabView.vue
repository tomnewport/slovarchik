<script setup>
import { computed, reactive, ref, nextTick } from 'vue'
import { vocab, state } from '../stores/vocab.js'
import { checkAnswer, maskWord, sample, shuffle } from '../lib/quiz.js'

const ready = computed(() => vocab.value.length > 0)

const LEVELS = [
  { id: 'easy', label: 'Easy · match', help: 'Pair up Russian and English.' },
  { id: 'intermediate', label: 'Intermediate · hint', help: 'Type it, first letters shown.' },
  { id: 'advanced', label: 'Advanced · blind', help: 'Type it with no help.' },
]

// How many pairs to show on the easy-mode matching board at once.
const BOARD_PAIRS = 5

const level = ref(null)
const direction = ref('ru-en') // or 'en-ru'
const score = reactive({ right: 0, total: 0 })

const current = ref(null)
const answered = ref(false)
const wasCorrect = ref(false)
const typed = ref('')
const inputEl = ref(null)

// Easy-mode matching board: two independently-shuffled columns of the same
// words. The player taps one Russian and one English item to clear a pair.
const boardLeft = ref([]) // Russian column
const boardRight = ref([]) // English column
const selectedLeft = ref(null) // word id picked in the left column
const selectedRight = ref(null) // word id picked in the right column
const matched = reactive(new Set()) // ids of cleared pairs
const wrongLeft = ref(null) // transient "wrong" flash markers
const wrongRight = ref(null)
let wrongTimer = null

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
  if (levelId === 'easy') {
    nextBoard()
  } else {
    nextQuestion()
  }
}

function nextQuestion() {
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  current.value = sample(vocab.value, 1)[0]
  nextTick(() => inputEl.value?.focus())
}

// Deal a fresh matching board: a sample of distinct words shown as two columns,
// each shuffled on its own so the rows don't line up.
function nextBoard() {
  clearWrong()
  matched.clear()
  selectedLeft.value = null
  selectedRight.value = null
  const words = sample(vocab.value, Math.min(BOARD_PAIRS, vocab.value.length))
  boardLeft.value = shuffle(words)
  boardRight.value = shuffle(words)
}

function clearWrong() {
  if (wrongTimer) clearTimeout(wrongTimer)
  wrongTimer = null
  wrongLeft.value = null
  wrongRight.value = null
}

function pickLeft(word) {
  if (matched.has(word.id)) return
  clearWrong()
  selectedLeft.value = selectedLeft.value === word.id ? null : word.id
  resolveMatch()
}

function pickRight(word) {
  if (matched.has(word.id)) return
  clearWrong()
  selectedRight.value = selectedRight.value === word.id ? null : word.id
  resolveMatch()
}

// Once one item is chosen in each column, score the attempt: a hit clears the
// pair, a miss flashes both briefly so the player can try again.
function resolveMatch() {
  if (selectedLeft.value == null || selectedRight.value == null) return
  const left = selectedLeft.value
  const right = selectedRight.value
  score.total += 1
  if (left === right) {
    matched.add(left)
    score.right += 1
    selectedLeft.value = null
    selectedRight.value = null
    if (matched.size === boardLeft.value.length) {
      setTimeout(nextBoard, 500)
    }
  } else {
    wrongLeft.value = left
    wrongRight.value = right
    selectedLeft.value = null
    selectedRight.value = null
    wrongTimer = setTimeout(clearWrong, 600)
  }
}

function leftClass(word) {
  if (matched.has(word.id)) return 'matched'
  if (word.id === selectedLeft.value) return 'selected'
  if (word.id === wrongLeft.value) return 'wrong'
  return ''
}

function rightClass(word) {
  if (matched.has(word.id)) return 'matched'
  if (word.id === selectedRight.value) return 'selected'
  if (word.id === wrongRight.value) return 'wrong'
  return ''
}

function record(correct) {
  if (answered.value) return
  answered.value = true
  wasCorrect.value = correct
  score.total += 1
  if (correct) score.right += 1
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

function quit() {
  clearWrong()
  level.value = null
  current.value = null
  boardLeft.value = []
  boardRight.value = []
  matched.clear()
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

  <section v-else class="grid" style="gap: 1.25rem">
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ direction === 'ru-en' ? 'RU → EN' : 'EN → RU' }} · {{ level }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <div v-if="level !== 'easy'" class="card" style="text-align: center">
      <div class="muted">Translate</div>
      <div style="font-size: 2rem; margin: 0.5rem 0" lang="ru">{{ promptOf(current) }}</div>
      <div v-if="level === 'intermediate' && !answered" class="muted" style="letter-spacing: 0.2em">
        {{ hint }}
      </div>
    </div>

    <!-- Easy: tap a Russian word and its English match to clear the pair. -->
    <div v-if="level === 'easy'">
      <p class="muted" style="margin: 0 0 0.75rem">Tap a matching pair to clear it.</p>
      <div class="match">
        <div class="match-col">
          <button
            v-for="word in boardLeft"
            :key="word.id"
            class="match-item"
            :class="leftClass(word)"
            :disabled="matched.has(word.id)"
            lang="ru"
            @click="pickLeft(word)"
          >
            {{ word.ru }}
          </button>
        </div>
        <div class="match-col">
          <button
            v-for="word in boardRight"
            :key="word.id"
            class="match-item"
            :class="rightClass(word)"
            :disabled="matched.has(word.id)"
            @click="pickRight(word)"
          >
            {{ firstEn(word) }}
          </button>
        </div>
      </div>
    </div>

    <!-- Intermediate / advanced: typing -->
    <form v-else @submit.prevent="submitTyped" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        :lang="direction === 'en-ru' ? 'ru' : 'en'"
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
      <div class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>
