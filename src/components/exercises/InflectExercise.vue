<script setup>
// Mastery exercise: fill an inflection table. Reuses the existing inflection
// sub-components — DragTable for the word-bank variant (inflect-bank) and
// BlindEndings for the keyboard variant (inflect-keyboard).
//
// The keyboard variant carries the same try-before-hint discipline as the
// learning-level spelling drills (#keyboard-hints): the keyboard hint is
// withheld for the first, unaided attempt; a wrong first check marks the
// slipped cells and unlocks the hint for one aided retry. A table completed
// without ever reaching for the hint counts double, exactly like TypeExercise.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { state as vocabState } from '../../stores/vocab.js'
import { buildParadigm } from '../../lib/paradigm.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint, setHintAllowed } from '../../stores/keyboard.js'
import { playFeedback } from '../../stores/settings.js'
import DragTable from '../inflection/DragTable.vue'
import BlindEndings from '../inflection/BlindEndings.vue'
import SpeakButton from '../SpeakButton.vue'
import CelebrationBurst from '../CelebrationBurst.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const paradigm = computed(() => {
  const word = vocabState.words.find((w) => w.key === props.exercise.wordKey)
  return word ? buildParadigm(word) : null
})

const isKeyboard = computed(() => props.exercise.mode === 'keyboard')
const component = computed(() => (isKeyboard.value ? BlindEndings : DragTable))

const graded = ref(false)
const wasCorrect = ref(false)
// A wrong first check spent the one built-in retry; the second check grades for
// real. A retry success is never first-try evidence, so it can't count double
// (#447).
const retried = ref(false)
// Whether the learner switched the keyboard hint on at any point. A table
// typed correctly with the hint untouched counts double (and gets a 🔥).
const hintUsed = ref(false)
const showFire = ref(false)
watch(
  () => keyboard.on,
  (on) => {
    if (on) hintUsed.value = true
  },
)

const double = computed(
  () =>
    isKeyboard.value &&
    wasCorrect.value &&
    !hintUsed.value &&
    !retried.value &&
    !!paradigm.value,
)

// First unaided check slipped: unlock the keyboard hint for the aided retry.
function onRetry() {
  retried.value = true
  setHintAllowed(true)
  playFeedback(false)
}

function onGraded(correct) {
  graded.value = true
  wasCorrect.value = !!correct
  playFeedback(!!correct)
  if (double.value) showFire.value = true
}

function next() {
  // No paradigm to drill (shouldn't happen — the builder filters these out) is
  // an auto-pass, not a wrong answer, so the runner can't get stuck re-queuing
  // an unanswerable exercise forever.
  // Preserve the first miss: a table corrected on the built-in retry reports the
  // initial failure (`correct: false`) flagged `correctedOnRetry` (#447).
  emit('done', {
    correct: paradigm.value ? (retried.value ? false : wasCorrect.value) : true,
    correctedOnRetry: retried.value && wasCorrect.value,
    double: double.value,
  })
}

onMounted(() => {
  // The lemma is the subject of the table — read it aloud as it appears.
  speak(props.exercise.lemma)
  if (isKeyboard.value) {
    resetHint()
    // Withhold the keyboard hint for the first, unaided attempt.
    setHintAllowed(false)
  }
})

// Restore the default so the next exercise's keyboard isn't left locked if this
// one is left (e.g. completed correctly first try, with the hint never unlocked).
onBeforeUnmount(() => {
  if (isKeyboard.value) setHintAllowed(true)
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
      :allow-retry="isKeyboard"
      @retry="onRetry"
      @graded="onGraded"
    />
    <p v-else class="muted">No inflection table available.</p>

    <div class="row next-row">
      <CelebrationBurst :show="showFire" emoji="🔥" />
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
/* Anchor the 🔥 burst over the Next button. */
.next-row {
  position: relative;
}
</style>
