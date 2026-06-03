<script setup>
import { computed, reactive, ref, nextTick, onUnmounted } from 'vue'
import { vocab, state } from '../stores/vocab.js'
import { checkAnswer, sample, shuffle } from '../lib/quiz.js'
import { record as recordAttempt } from '../stores/progress.js'
import { GRADES, gradeFor } from '../lib/progress.js'
import { resetHint } from '../stores/keyboard.js'
import { speak, speechSupported } from '../lib/speech.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'

// How long the celebration plays before auto-advancing to the next question.
const CELEBRATE_MS = 1000

const ready = computed(() => vocab.value.length > 0)

const LEVELS = [
  { id: 'easy', label: 'Easy · match', help: 'Pair up Russian and English.' },
  {
    id: 'type',
    label: 'Type it',
    help: 'Type the answer — tap the keyboard’s 💡 if you need a hint.',
  },
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
const celebrating = ref(false)
let advanceTimer = null

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

// Easy-mode "listen & match": hide the Russian spellings and read each word
// aloud when it's tapped, turning the matching board into a listening drill.
const hideSpellings = ref(false)
const canSpeak = speechSupported()

// English answers may be arrays; show the first as the canonical prompt/answer.
const promptOf = (w) => (direction.value === 'ru-en' ? w.ru : firstEn(w))
const answerOf = (w) => (direction.value === 'ru-en' ? w.en : w.ru)
const displayAnswer = (w) => (direction.value === 'ru-en' ? firstEn(w) : w.ru)
function firstEn(w) {
  return Array.isArray(w.en) ? w.en[0] : w.en
}

// Same-spelling forms whose stress carries the meaning (сто́ит vs стои́т). When
// the current word has any, we surface a reminder after it's answered.
const heteronyms = computed(() => current.value?.heteronyms ?? [])

function start(levelId) {
  level.value = levelId
  score.right = 0
  score.total = 0
  resetHint() // each lesson starts with the keyboard hint off
  if (levelId === 'easy') {
    nextBoard()
  } else {
    nextQuestion()
  }
}

function nextQuestion() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  current.value = sample(vocab.value, 1)[0]
  nextTick(() => inputEl.value?.focus())
  if (direction.value === 'ru-en') speak(current.value.ru)
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
  speak(word.ru)
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
    // A correct match is a win in easy/assisted mode.
    recordAttempt({ kind: 'word', key: left }, GRADES.EASY, { level: 'easy' })
    selectedLeft.value = null
    selectedRight.value = null
    if (matched.size === boardLeft.value.length) {
      setTimeout(nextBoard, 500)
    }
  } else {
    // The learner confused two words — count it against both.
    recordAttempt({ kind: 'word', key: left }, GRADES.INCORRECT, { level: 'easy' })
    recordAttempt({ kind: 'word', key: right }, GRADES.INCORRECT, { level: 'easy' })
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
  // Typed answer → spelling success or error for a word. The on-screen hint
  // carries no penalty, so a typed answer always counts at the top tier.
  recordAttempt({ kind: 'word', key: current.value.id }, gradeFor('advanced', correct), {
    level: 'advanced',
  })
  if (correct) {
    score.right += 1
    // Celebrate, then move straight to the next question — unless there's a
    // heteronym reminder to read, in which case wait for the learner to advance.
    celebrating.value = true
    if (heteronyms.value.length === 0) {
      advanceTimer = setTimeout(nextQuestion, CELEBRATE_MS)
    }
  }
}

function submitTyped() {
  if (answered.value) {
    nextQuestion()
    return
  }
  record(checkAnswer(typed.value, answerOf(current.value)))
}

function quit() {
  clearWrong()
  clearTimeout(advanceTimer)
  resetHint()
  celebrating.value = false
  level.value = null
  current.value = null
  boardLeft.value = []
  boardRight.value = []
  matched.clear()
}

onUnmounted(() => {
  clearTimeout(advanceTimer)
  resetHint()
})
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
    <label v-if="canSpeak" class="row" style="gap: 0.5rem; cursor: pointer">
      <input type="checkbox" v-model="hideSpellings" />
      <span>🔊 Listen &amp; match
        <span class="muted">— easy mode: hide Russian, tap to hear</span></span>
    </label>
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

    <div v-if="level !== 'easy'" class="card" style="text-align: center">
      <div class="muted">Translate</div>
      <div style="font-size: 2rem; margin: 0.5rem 0" lang="ru">{{ promptOf(current) }}</div>
      <SpeakButton v-if="direction === 'ru-en'" :text="promptOf(current)" />
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
            :aria-label="hideSpellings ? 'Play word' : undefined"
            @click="pickLeft(word)"
          >
            <span v-if="hideSpellings" aria-hidden="true">🔊</span>
            <span v-else lang="ru">{{ word.ru }}</span>
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

    <!-- Type it: the on-screen keyboard's 💡 reveals the next letter on demand -->
    <form v-else @submit.prevent="submitTyped" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        :lang="direction === 'en-ru' ? 'ru' : 'en'"
        :data-answer="direction === 'en-ru' && current ? answerOf(current) : null"
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
        <SpeakButton v-if="!wasCorrect && direction === 'en-ru'" :text="displayAnswer(current)" />
      </p>
      <p v-if="current.note" class="muted" style="margin: 0">{{ current.note }}</p>
      <!-- Heteronym reminder: same spelling, the stress changes the meaning. -->
      <div v-if="heteronyms.length" class="card heteronym-note">
        <div class="muted" style="margin-bottom: 0.5rem">
          Heteronym — same spelling, but the stress changes the meaning:
        </div>
        <div
          v-for="h in heteronyms"
          :key="h.ru"
          class="row"
          style="gap: 0.5rem; align-items: center"
        >
          <strong lang="ru">{{ h.ru }}</strong>
          <span class="muted">— {{ h.gloss }}</span>
          <SpeakButton :text="h.ru" />
        </div>
      </div>
      <!-- Correct answers advance on their own; wrong answers and heteronym
           reminders wait for the user. -->
      <div v-if="!wasCorrect || heteronyms.length" class="row">
        <button class="primary" @click="nextQuestion">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change mode</button>
  </section>
</template>

<style scoped>
.heteronym-note {
  border-left: 3px solid #d9a400;
  text-align: left;
}
</style>
