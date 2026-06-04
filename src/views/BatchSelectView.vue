<script setup>
// Batch selection: the engine offers up to five named word batches (prioritising
// real collection names over "Random") for the next learning or mastery journey.
// Learning is themed green, mastery gold. Picking one commits it to the store.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { state as vocabState, initVocab } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'

const route = useRoute()
const router = useRouter()

const level = computed(() => (route.query.level === 'mastery' ? 'mastery' : 'learning'))
const options = ref([])
const ready = ref(false)

async function load() {
  if (!vocabState.words.length) await initVocab()
  if (!progress.state.loaded) await progress.loadProgress()
  options.value = progress.getBatchOptions(level.value)
  ready.value = true
}
load()

async function pick(option) {
  await progress.commitBatch(option)
  router.push('/')
}
</script>

<template>
  <section class="grid batch-select" :class="level" style="gap: 1rem">
    <h1>{{ level === 'mastery' ? 'Master next' : 'Learn next' }}</h1>
    <p class="muted">Pick a set of words to focus on.</p>

    <p v-if="!ready" class="muted">Loading…</p>

    <template v-else-if="options.length">
      <button
        v-for="opt in options"
        :key="opt.name + opt.words.join()"
        class="option card"
        @click="pick(opt)"
      >
        <strong class="name">{{ opt.name }}</strong>
        <span class="muted size">{{ opt.size }} words</span>
      </button>
    </template>

    <div v-else class="card empty">
      <p v-if="level === 'mastery'" class="muted">
        Mastery unlocks once you've learned 100 words. Keep learning!
      </p>
      <p v-else class="muted">Nothing left to learn here — great work!</p>
      <button class="primary" @click="router.push('/')">Back home</button>
    </div>
  </section>
</template>

<style scoped>
.option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  border-left: 4px solid var(--border);
}
.batch-select.learning .option {
  border-left-color: var(--good);
}
.batch-select.mastery .option {
  border-left-color: var(--gold);
}
.batch-select.mastery h1 {
  color: var(--gold);
}
.name {
  font-size: 1.2rem;
  text-transform: capitalize;
}
.empty {
  display: grid;
  gap: 1rem;
  justify-items: start;
}
</style>
