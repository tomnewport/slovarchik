<script setup>
import { ref } from 'vue'
import { submitReport } from '../stores/reports.js'

const props = defineProps({
  exercise: { type: Object, required: true },
  vocabVersion: { type: Number, default: null },
  lastSyncedAt: { type: Number, default: null },
})

const queued = ref(false)

function getContext() {
  return {
    ru: props.exercise.ru ?? props.exercise.lemma,
    en: props.exercise.en,
    kind: props.exercise.kind,
    dimension: props.exercise.dimension,
    content: props.exercise.content,
    practiceType: props.exercise.practiceType,
    vocabVersion: props.vocabVersion,
    lastSyncedAt: props.lastSyncedAt,
  }
}

async function report() {
  const { queued: wasQueued } = await submitReport(getContext())
  if (wasQueued) {
    queued.value = true
    setTimeout(() => {
      queued.value = false
    }, 3000)
  }
}
</script>

<template>
  <button class="report-btn" :class="{ queued }" :title="queued ? 'Saved — submit when online' : 'Report an issue with this exercise'" @click="report">
    <template v-if="queued">Saved for later</template>
    <template v-else>Report issue</template>
  </button>
</template>

<style scoped>
.report-btn {
  font-size: 0.78rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.3rem 0.55rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.report-btn:hover {
  color: var(--text);
  border-color: var(--muted);
}
.report-btn.queued {
  color: var(--good);
  border-color: var(--good);
}
</style>
