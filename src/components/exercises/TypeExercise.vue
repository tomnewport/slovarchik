<script setup>
// Usage / dictation exercise: spell the Russian with the hintable on-screen
// keyboard. Covers spell-word, spell-phrase and dictation (where the prompt is
// heard, not seen). Hints never penalise — grading only looks at the answer.
import { computed, onMounted, ref, watch } from 'vue'

import { phraseCorrect, typingSequence } from '../../lib/phrases.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint } from '../../stores/keyboard.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'
import CelebrationBurst from '../CelebrationBurst.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const typed = ref('')
const checked = ref(false)
const wasCorrect = ref(false)
// On a first wrong answer offer one retry before revealing. Once the learner
// has retried (or they got it right), this stays true so we don't loop.
const retried = ref(false)
// Whether the learner switched the keyboard hint on at any point this exercise.
// A correct answer with the hint untouched counts double (and gets a little 🔥).
const hintUsed = ref(false)
const showFire = ref(false)
watch(
  () => keyboard.on,
  (on) => {
    if (on) hintUsed.value = true
  },
)
// Correct and never reached for the hint — the answer the learner truly knew.
const double = computed(() => wasCorrect.value && !hintUsed.value)

const answer = computed(() => typingSequence(props.exercise.ru))

function check() {
  if (checked.value) return
  const targets = [props.exercise.ru, ...(props.exercise.alsoRu ?? [])]
  wasCorrect.value = phraseCorrect(typed.value, targets)
  if (!wasCorrect.value && !retried.value) {
    retried.value = true
    typed.value = ''
    playFeedback(false)
    return
  }
  checked.value = true
  playFeedback(wasCorrect.value)
  if (double.value) showFire.value = true
  // Read the Russian aloud once the answer is resolved so the learner hears the
  // correct pronunciation — especially helpful after a spelling exercise.
  if (!props.exercise.audio) speak(props.exercise.ru)
}

function next() {
  emit('done', { correct: wasCorrect.value, double: double.value })
}

onMounted(() => {
  resetHint()
  if (props.exercise.audio) speak(props.exercise.ru)
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="prompt">
      <template v-if="exercise.audio">
        <span class="muted">Type what you hear</span>
        <SpeakButton :text="exercise.ru" />
      </template>
      <template v-else>
        <span class="cue">{{ exercise.en }}</span>
        <small v-if="exercise.note" class="muted">({{ exercise.note }})</small>
        <small v-else-if="exercise.ambiguousEn?.length" class="muted">
          (one of {{ exercise.ambiguousEn.length + 1 }} Russian words for this)
        </small>
      </template>
    </div>

    <form @submit.prevent="check">
      <input
        v-model="typed"
        type="text"
        lang="ru"
        class="answer-input"
        :data-answer="answer"
        :disabled="checked"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="по-русски…"
      />
    </form>

    <p v-if="retried && !checked" class="retry-hint">Not quite — try again</p>

    <div v-if="checked" class="feedback-block">
      <div class="feedback" :class="wasCorrect ? 'ok' : 'no'">
        <strong>{{ wasCorrect ? 'Correct' : 'Answer:' }}</strong>
        <span lang="ru" class="answer-text">{{ exercise.ru }}</span>
        <SpeakButton :text="exercise.ru" />
      </div>
      <p v-if="exercise.audio && exercise.en" class="translation-hint">{{ exercise.en }}</p>
    </div>

    <div class="row check-row">
      <CelebrationBurst :show="showFire" emoji="🔥" />
      <button v-if="!checked" class="primary check" :disabled="!typed.trim()" @click="check">
        Check
      </button>
      <button v-else class="primary next" @click="next">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.3rem;
}
.answer-input {
  width: 100%;
  padding: 0.6rem;
  font-size: 1.2rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
}
.retry-hint {
  margin: 0;
  color: var(--bad);
  font-size: 0.9rem;
}
.feedback-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.feedback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.translation-hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.feedback.ok strong {
  color: var(--good);
}
.feedback.no strong {
  color: var(--bad);
}
.answer-text {
  font-size: 1.2rem;
}
/* Anchor the 🔥 burst over the Check/Next button. */
.check-row {
  position: relative;
}
</style>
