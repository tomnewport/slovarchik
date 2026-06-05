<script setup>
// Usage / dictation exercise: spell the Russian with the hintable on-screen
// keyboard. Covers spell-word, spell-phrase and dictation (where the prompt is
// heard, not seen). Hints never penalise — grading only looks at the answer.
import { computed, onMounted, ref } from 'vue'

import { phraseCorrect, typingSequence } from '../../lib/phrases.js'
import { speak } from '../../lib/speech.js'
import { resetHint } from '../../stores/keyboard.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const typed = ref('')
const checked = ref(false)
const wasCorrect = ref(false)

const answer = computed(() => typingSequence(props.exercise.ru))

function check() {
  if (checked.value) return
  wasCorrect.value = phraseCorrect(typed.value, props.exercise.ru)
  checked.value = true
  playFeedback(wasCorrect.value)
}

function next() {
  emit('done', { correct: wasCorrect.value })
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

    <div v-if="checked" class="feedback" :class="wasCorrect ? 'ok' : 'no'">
      <strong>{{ wasCorrect ? 'Correct' : 'Answer:' }}</strong>
      <span lang="ru" class="answer-text">{{ exercise.ru }}</span>
      <SpeakButton :text="exercise.ru" />
    </div>

    <div class="row">
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
.feedback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
</style>
