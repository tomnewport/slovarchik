<script setup>
// Standalone free-practice entry for the in-context inflection drill. It reuses
// the same resolver (lib/phraseContext.js) and renderer (PhraseFixExercise.vue)
// as the session version, drawing from the usage `inflect:` annotations.
import { computed, ref } from 'vue'
import { state as vocabState } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { buildContextExercise, canBuildContext } from '../lib/phraseContext.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import PhraseFixExercise from '../components/exercises/PhraseFixExercise.vue'

const CELEBRATE_MS = 1000

// Words that have at least one annotated phrase, so a drill can be built.
const drillable = computed(() =>
  vocabState.words.filter((w) => canBuildContext(w, { phrasesByKey: vocabState.contextPhrases })),
)
const ready = computed(() => drillable.value.length > 0)

const started = ref(false)
const current = ref(null)
const exerciseSeq = ref(0)
const celebrating = ref(false)
const score = ref({ right: 0, total: 0 })

function pick() {
  celebrating.value = false
  const word = sample(drillable.value, 1)[0]
  current.value = buildContextExercise(word, {
    phrasesByKey: vocabState.contextPhrases,
    rules: vocabState.rules,
  })
  exerciseSeq.value++
}

function start() {
  started.value = true
  score.value = { right: 0, total: 0 }
  pick()
}

function onDone({ correct }) {
  score.value.total++
  if (correct) {
    score.value.right++
    celebrating.value = true
    setTimeout(pick, CELEBRATE_MS)
  } else {
    pick()
  }
}

function quit() {
  celebrating.value = false
  started.value = false
  current.value = null
}
</script>

<template>
  <!-- Start screen -->
  <section v-if="!started" class="grid">
    <h2 style="margin: 0">Fix the phrase</h2>
    <p class="muted">
      A real sentence appears with one word in its dictionary form. First pick
      the case the sentence needs, then spell the correct form.
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
      <PhraseFixExercise :key="exerciseSeq" :exercise="current" @done="onDone" />
    </div>

    <button style="justify-self: start" @click="quit">Stop</button>
  </section>
</template>

<style scoped>
.phrase-card {
  text-align: left;
}
</style>
