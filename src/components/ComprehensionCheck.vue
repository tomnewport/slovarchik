<script setup>
// The comprehension probe shown after a correct Russian→English answer (#597):
// "what does the Russian say that your English does not?"
//
// Informational, never graded. The learner's translation was already correct, so
// there is nothing left to mark — a wrong pick reveals the explanation and moves
// on, and nothing is recorded against the word. See lib/comprehension.js for why
// the question is asked separately rather than by bending the English until it
// carries the distinction.
//
// Renders nothing at all for a sentence with no probe, which is most of them, so
// a caller can drop it in unconditionally.
import { computed, ref, watch } from 'vue'

import { state, wordsByKey } from '../stores/vocab.js'
import { comprehensionCheck } from '../lib/comprehension.js'

const props = defineProps({
  // `{ ru, source }` — a shaped phrase, or any object carrying those two.
  phrase: { type: Object, default: null },
})
const emit = defineEmits(['answered'])

const check = computed(() =>
  comprehensionCheck(props.phrase, {
    byKey: wordsByKey.value,
    annotations: state.contextPhrases,
  }),
)

const picked = ref(null)
// A new sentence is a new question: without this the previous answer would still
// be showing when the drill advances.
watch(
  () => props.phrase,
  () => {
    picked.value = null
  },
)

const correct = computed(() => picked.value != null && picked.value === check.value?.answer)

function pick(id) {
  if (picked.value != null) return
  picked.value = id
  emit('answered', { kind: check.value.kind, correct: id === check.value.answer })
}

defineExpose({ check })
</script>

<template>
  <div v-if="check" class="probe card">
    <p class="ask muted">{{ check.question }}</p>
    <div class="grid options">
      <button
        v-for="o in check.options"
        :key="o.id"
        type="button"
        class="option"
        :class="{
          picked: picked === o.id,
          answer: picked != null && o.id === check.answer,
        }"
        :disabled="picked != null"
        @click="pick(o.id)"
      >
        {{ o.text }}
      </button>
    </div>
    <!-- The verdict is deliberately mild: "not quite" rather than a cross. The
         graded question was the translation, and that one was right. -->
    <p v-if="picked != null" class="why">
      <strong>{{ correct ? 'Yes' : 'Not quite' }}</strong> — {{ check.why }}
    </p>
  </div>
</template>

<style scoped>
.probe {
  text-align: left;
}
.ask {
  margin: 0 0 0.5rem;
}
.options {
  gap: 0.5rem;
}
.option {
  text-align: left;
  font: inherit;
}
/* Once answered, the right one is marked whichever was picked — the point is to
   show the reading, not to score it. */
.option.answer {
  border-color: var(--good, currentColor);
  font-weight: 600;
}
.option.picked:not(.answer) {
  opacity: 0.6;
}
.option:disabled {
  cursor: default;
}
.why {
  margin: 0.6rem 0 0;
  line-height: 1.4;
}
</style>
