<script setup>
// Mastery exercise: fill an inflection table. Reuses the existing inflection
// sub-components — DragTable for the word-bank variant (inflect-bank) and
// BlindEndings for the keyboard variant (inflect-keyboard).
import { computed, onMounted, ref } from 'vue'

import { state as vocabState } from '../../stores/vocab.js'
import { buildParadigm } from '../../lib/paradigm.js'
import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import DragTable from '../inflection/DragTable.vue'
import BlindEndings from '../inflection/BlindEndings.vue'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const paradigm = computed(() => {
  const word = vocabState.words.find((w) => w.key === props.exercise.wordKey)
  return word ? buildParadigm(word) : null
})

const component = computed(() => (props.exercise.mode === 'keyboard' ? BlindEndings : DragTable))

const graded = ref(false)
const wasCorrect = ref(false)

function onGraded(correct) {
  graded.value = true
  wasCorrect.value = !!correct
  playFeedback(!!correct)
}

function next() {
  // No paradigm to drill (shouldn't happen — the builder filters these out) is
  // an auto-pass, not a wrong answer, so the runner can't get stuck re-queuing
  // an unanswerable exercise forever.
  emit('done', { correct: paradigm.value ? wasCorrect.value : true })
}

onMounted(() => {
  // The lemma is the subject of the table — read it aloud as it appears.
  speak(props.exercise.lemma)
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="prompt">
      <span class="muted">Complete the table for</span>
      <strong lang="ru">{{ exercise.lemma }}</strong>
      <SpeakButton :text="exercise.lemma" />
    </div>

    <!-- Re-key on the exercise id so the sub-component fully resets per item. -->
    <component
      :is="component"
      v-if="paradigm"
      :key="exercise.id"
      :paradigm="paradigm"
      @graded="onGraded"
    />
    <p v-else class="muted">No inflection table available.</p>

    <div class="row">
      <button v-if="graded || !paradigm" class="primary next" @click="next">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.2rem;
}
</style>
