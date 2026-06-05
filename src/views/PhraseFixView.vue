<script setup>
import { computed, reactive, ref, nextTick, onUnmounted } from 'vue'
import { phrases, state as vocabState } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { resetHint } from '../stores/keyboard.js'
import { buildFixExercise } from '../lib/phraseFix.js'
import { normalize } from '../lib/text.js'
import { CASE_LABELS, NUMBER_LABELS } from '../lib/declension.js'
import { speak } from '../lib/speech.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'

const CELEBRATE_MS = 1000

const wordIndex = computed(() => {
  const map = new Map()
  for (const w of vocabState.words) map.set(w.key, w)
  return map
})

// Filter to phrases whose source noun has a non-nominative form in the phrase.
const exercises = computed(() => {
  const out = []
  for (const phrase of phrases.value) {
    const noun = wordIndex.value.get(phrase.source)
    if (!noun?.forms || Object.keys(noun.forms).length === 0) continue
    const ex = buildFixExercise(phrase, noun)
    if (ex) out.push(ex)
  }
  return out
})

const started = ref(false)
const current = ref(null)
const answered = ref(false)
const wasCorrect = ref(false)
const typed = ref('')
const inputEl = ref(null)
const celebrating = ref(false)
const score = reactive({ right: 0, total: 0 })
let advanceTimer = null

const ready = computed(() => exercises.value.length > 0)

function start() {
  started.value = true
  score.right = 0
  score.total = 0
  resetHint()
  pick()
}

function pick() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  wasCorrect.value = false
  typed.value = ''
  current.value = sample(exercises.value, 1)[0]
  speak(current.value.phrase.ru)
  nextTick(() => inputEl.value?.focus())
}

function submit() {
  if (answered.value) {
    pick()
    return
  }
  const correct = normalize(typed.value) === current.value.answer
  answered.value = true
  wasCorrect.value = correct
  score.total++
  if (correct) {
    score.right++
    celebrating.value = true
    advanceTimer = setTimeout(pick, CELEBRATE_MS)
  }
}

function quit() {
  clearTimeout(advanceTimer)
  resetHint()
  celebrating.value = false
  started.value = false
  current.value = null
}

function caseLabel(ex) {
  const numLabel = NUMBER_LABELS[ex.num] ?? ex.num
  const casLabel = CASE_LABELS[ex.cas] ?? ex.cas
  return `${numLabel} ${casLabel}`
}

// Token display for the current exercise phrase.
// Before answering: the target slot shows the lemma (highlighted).
// After answering: the slot shows the correct inflected form (green/red).
const targetDisplay = computed(() => {
  if (!current.value) return ''
  if (!answered.value) return current.value.displayTokens[current.value.targetIndex]
  // Reconstruct the token using the correct form + original surrounding punct.
  const origToken = current.value.tokens[current.value.targetIndex]
  const leadPunct = origToken.match(/^[^\p{L}]*/u)?.[0] ?? ''
  const trailPunct = origToken.match(/[^\p{L}]*$/u)?.[0] ?? ''
  return leadPunct + current.value.answerAccented + trailPunct
})

onUnmounted(() => {
  clearTimeout(advanceTimer)
  resetHint()
})
</script>

<template>
  <!-- Start screen -->
  <section v-if="!started" class="grid">
    <h2 style="margin: 0">Fix the phrase</h2>
    <p class="muted">
      Words appear in their dictionary form. Tap the highlighted word to correct
      its inflection using the keyboard.
    </p>
    <p v-if="!ready && vocabState.status === 'loading'" class="muted">Loading vocabulary…</p>
    <p v-else-if="!ready" class="feedback bad">
      No exercises available offline yet — connect once to download vocabulary.
    </p>
    <button v-else class="primary" @click="start">Start →</button>
  </section>

  <!-- Exercise screen -->
  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />

    <div class="row" style="justify-content: space-between">
      <span class="pill">Fix the phrase</span>
      <span class="muted">{{ score.right }} / {{ score.total }}</span>
    </div>

    <div v-if="current" class="card phrase-card">
      <div class="phrase-row muted">
        Restore the correct form
        <SpeakButton :text="current.phrase.ru" />
      </div>

      <div class="phrase-line" lang="ru">
        <template v-for="(tok, i) in current.displayTokens" :key="i">
          <span v-if="i > 0"> </span>
          <!-- Target token: highlighted lemma before answering -->
          <button
            v-if="i === current.targetIndex && !answered"
            class="target-btn"
            type="button"
            @click="() => inputEl?.focus()"
          >{{ tok }}</button>
          <!-- Target token after answering -->
          <mark
            v-else-if="i === current.targetIndex"
            :class="wasCorrect ? 'mark-ok' : 'mark-err'"
          >{{ targetDisplay }}</mark>
          <span v-else>{{ tok }}</span>
        </template>
      </div>

      <div class="hint-row muted">
        <em>{{ current.noun.headword || current.noun.ru }}</em> —
        {{ current.noun.meaning }} · {{ caseLabel(current) }}
      </div>
    </div>

    <form v-if="current" @submit.prevent="submit" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        lang="ru"
        :data-answer="current.answerAccented"
        :disabled="answered"
        placeholder="наберите правильную форму"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button v-if="!answered" type="submit" class="primary">Check</button>
    </form>

    <div v-if="answered" class="grid">
      <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
        <template v-if="wasCorrect">✓ Correct!</template>
        <template v-else>
          ✗ {{ current.answerAccented }}
          <SpeakButton :text="current.answerAccented" />
        </template>
      </p>
      <p v-if="!wasCorrect" class="muted phrase-en">{{ current.phrase.en }}</p>
      <div v-if="!wasCorrect" class="row">
        <button class="primary" @click="pick">Next →</button>
        <button @click="quit">Stop</button>
      </div>
    </div>
    <button v-else style="justify-self: start" @click="quit">Stop</button>
  </section>
</template>

<style scoped>
.phrase-card {
  text-align: left;
  display: grid;
  gap: 0.75rem;
}
.phrase-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.phrase-line {
  font-size: 1.4rem;
  line-height: 1.8;
}
.target-btn {
  padding: 0.05rem 0.3rem;
  font-size: inherit;
  font-family: inherit;
  border: 2px solid var(--primary);
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
}
.target-btn:hover {
  background: color-mix(in srgb, var(--primary) 20%, var(--card));
}
.mark-ok {
  background: color-mix(in srgb, var(--good) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--good);
  font-weight: 600;
}
.mark-err {
  background: color-mix(in srgb, var(--bad) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--bad);
  font-weight: 600;
}
.hint-row {
  font-size: 0.85rem;
}
.phrase-en {
  font-style: italic;
}
</style>
