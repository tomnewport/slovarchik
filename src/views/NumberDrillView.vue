<script setup>
import { computed, reactive, ref, nextTick, onUnmounted } from 'vue'

import { FOCUSES, nextExercise } from '../lib/numberDrill.js'
import { checkAnswer } from '../lib/quiz.js'
import { record as recordAttempt } from '../stores/progress.js'
import { gradeFor } from '../lib/progress.js'
import { speak } from '../lib/speech.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'

// How long the celebration plays before auto-advancing.
const CELEBRATE_MS = 1000

const focus = ref(null) // the chosen FOCUSES entry
const score = reactive({ right: 0, total: 0 })

const current = ref(null)
const typed = ref('')
const answered = ref(false)
const wasCorrect = ref(false)
const celebrating = ref(false)
const inputEl = ref(null)
let advanceTimer = null

function start(f) {
  focus.value = f
  score.right = 0
  score.total = 0
  next()
}

function next() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  current.value = nextExercise(focus.value.kinds)
  nextTick(() => inputEl.value?.focus())
}

function submit() {
  if (answered.value) {
    next()
    return
  }
  answered.value = true
  wasCorrect.value = checkAnswer(typed.value, current.value.answers)
  score.total += 1
  // Track per-topic so numbers show up in the progress dashboard. Blind typing
  // grades as the 'advanced' tier.
  recordAttempt({ kind: 'number', key: current.value.kind }, gradeFor('advanced', wasCorrect.value), {
    level: 'advanced',
  })
  // Read the correct Russian aloud — hearing the number/year said is the point.
  speak(current.value.reveal)
  if (wasCorrect.value) {
    score.right += 1
    celebrating.value = true
    advanceTimer = setTimeout(next, CELEBRATE_MS)
  }
}

function quit() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  focus.value = null
  current.value = null
}

const accuracy = computed(() =>
  score.total ? Math.round((score.right / score.total) * 100) : null,
)

onUnmounted(() => clearTimeout(advanceTimer))
</script>

<template>
  <section v-if="!focus" class="grid">
    <h2 style="margin: 0">Numbers</h2>
    <p class="muted" style="margin: 0">
      Numbers are generated on the fly and declined by rule, so the questions never run out —
      any year up to 2100, any age, any price.
    </p>
    <div class="grid">
      <button
        v-for="f in FOCUSES"
        :key="f.id"
        class="card"
        style="text-align: left"
        @click="start(f)"
      >
        <strong>{{ f.label }}</strong>
        <div class="muted">{{ f.kinds.join(' · ') }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ focus.label }}</span>
      <span class="muted">
        Score: {{ score.right }} / {{ score.total }}
        <template v-if="accuracy !== null"> · {{ accuracy }}%</template>
      </span>
    </div>

    <div class="card" style="text-align: center">
      <div style="font-size: 1.6rem; margin: 0.25rem 0">{{ current.prompt }}</div>
      <div class="muted">{{ current.instruction }}</div>
    </div>

    <form @submit.prevent="submit" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        lang="ru"
        :disabled="answered"
        placeholder="наберите по-русски"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button v-if="!answered" type="submit" class="primary">Check</button>
    </form>

    <div v-if="answered" class="grid">
      <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
        {{ wasCorrect ? '✓ Correct!' : '✗ Not quite' }}
      </p>
      <p v-if="!wasCorrect" class="speak-row" style="margin: 0">
        <span lang="ru">Answer: <strong>{{ current.reveal }}</strong></span>
        <SpeakButton :text="current.reveal" />
      </p>
      <p v-if="current.note" class="muted" style="margin: 0">{{ current.note }}</p>
      <div v-if="!wasCorrect" class="row">
        <button class="primary" @click="next">Next →</button>
        <button @click="quit">Change focus</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Change focus</button>
  </section>
</template>
