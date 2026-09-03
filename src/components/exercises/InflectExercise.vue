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
import { paradigmFor } from '../../lib/paradigm.js'
import { isTableClean, markTableClean } from '../../stores/progress.js'
import { isCleanTable } from '../../lib/tableStage.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint, setHintAllowed } from '../../stores/keyboard.js'
import { playFeedback } from '../../stores/settings.js'
import DragTable from '../inflection/DragTable.vue'
import BlindEndings from '../inflection/BlindEndings.vue'
import SpeakButton from '../SpeakButton.vue'
import WordFacts from '../WordFacts.vue'
import CelebrationBurst from '../CelebrationBurst.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// `variant` names which of the word's tables this exercise drills — its short
// form, participles/gerund or short passive — or null for the primary paradigm
// (#575). Only the name is stored on the exercise; the table is rebuilt here.
const paradigm = computed(() => {
  const word = vocabState.words.find((w) => w.key === props.exercise.wordKey)
  return word ? paradigmFor(word, props.exercise.variant) : null
})

const isKeyboard = computed(() => props.exercise.mode === 'keyboard')
const component = computed(() => (isKeyboard.value ? BlindEndings : DragTable))

// A table the learner has never assembled cleanly is built one column at a time
// (#645) — masculine, then neuter, then feminine, then plural — so the bank
// offers a handful of forms rather than the whole paradigm at once.
const staged = computed(
  () => !isKeyboard.value && !isTableClean(props.exercise.wordKey, props.exercise.variant),
)

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

function onGraded(correct, records = []) {
  graded.value = true
  wasCorrect.value = !!correct
  playFeedback(!!correct)
  if (double.value) showFire.value = true
  // A word-bank table assembled with nothing to correct graduates to the whole
  // table next time — and unlocks typing its endings (#645).
  if (!isKeyboard.value && isCleanTable(records)) {
    markTableClean(props.exercise.wordKey, props.exercise.variant)
  }
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
      <!-- Which table, when it isn't the word's main one — a learner asked for
           закры́т needs to know the short form is wanted, not the declension. -->
      <span v-if="paradigm?.variantLabel" class="pill">{{ paradigm.variantLabel }}</span>
      <SpeakButton :text="exercise.lemma" />
    </div>

    <!-- Re-key on the exercise id so the sub-component fully resets per item. -->
    <component
      :is="component"
      v-if="paradigm"
      :key="exercise.id"
      :paradigm="paradigm"
      :staged="staged"
      :allow-retry="isKeyboard"
      @retry="onRetry"
      @graded="onGraded"
    />
    <p v-else class="muted">No inflection table available.</p>

    <!-- About this word (#586) — once the table is graded, right or wrong: the
         breakdown and the word's family explain the forms just filled in. -->
    <WordFacts v-if="graded && exercise.wordKey" :word-key="exercise.wordKey" />

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
