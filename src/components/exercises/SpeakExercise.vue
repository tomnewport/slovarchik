<script setup>
// Speaking exercise: repeat the word or phrase aloud. Per #79 the speaking
// dimension is attempts-based — the learner just needs to attempt it — so a
// completed attempt counts. The model answer can be heard first.
import { onMounted } from 'vue'

import { speak, speechSupported } from '../../lib/speech.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

function done() {
  emit('done', { correct: true })
}

onMounted(() => {
  if (speechSupported()) speak(props.exercise.ru)
})
</script>

<template>
  <div class="grid speak" style="gap: 1rem">
    <p class="muted">Say it aloud</p>
    <div class="target">
      <span lang="ru" class="ru">{{ exercise.ru }}</span>
      <SpeakButton :text="exercise.ru" />
    </div>
    <p class="muted en">{{ exercise.en }}</p>
    <div class="row">
      <button class="primary next" @click="done">I said it →</button>
    </div>
  </div>
</template>

<style scoped>
.target {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.6rem;
}
.en {
  font-size: 1.1rem;
}
</style>
