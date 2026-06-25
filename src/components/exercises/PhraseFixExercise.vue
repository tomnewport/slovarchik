<script setup>
// Mastery exercise (context drill): a natural phrase with the target word
// collapsed to its dictionary form. The learner types the correctly inflected
// form the sentence demands. The exercise descriptor is built by
// lib/phraseBattery.js from the phrase-battery carriers.
import { computed, nextTick, ref, onMounted } from 'vue'

import { normalize } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const typed = ref('')
const answered = ref(false)
const wasCorrect = ref(false)
const inputEl = ref(null)

// The slot token shows the lemma before answering; the correct form after.
const slotText = computed(() =>
  answered.value ? props.exercise.answerAccented : props.exercise.lemma,
)

function submit() {
  if (answered.value) return
  wasCorrect.value = normalize(typed.value) === props.exercise.answer
  answered.value = true
  playFeedback(wasCorrect.value)
}

function next() {
  emit('done', { correct: wasCorrect.value })
}

onMounted(() => {
  speak(props.exercise.ru)
  nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <p class="prompt-en muted">{{ exercise.en }}</p>

    <div class="phrase-line" lang="ru">
      <template v-for="(tok, i) in exercise.tokens" :key="i">
        <span v-if="i > 0">{{ ' ' }}</span>
        <button
          v-if="i === exercise.targetIndex && !answered"
          class="target-btn"
          type="button"
          @click="() => inputEl?.focus()"
        >{{ slotText }}</button>
        <mark
          v-else-if="i === exercise.targetIndex"
          :class="wasCorrect ? 'mark-ok' : 'mark-err'"
        >{{ slotText }}</mark>
        <span v-else>{{ tok }}</span>
      </template>
    </div>

    <p class="slot-label muted">
      <em lang="ru">{{ exercise.lemma }}</em> → {{ exercise.slotLabel }}
    </p>

    <form v-if="!answered" @submit.prevent="submit" class="grid">
      <input
        ref="inputEl"
        v-model="typed"
        type="text"
        lang="ru"
        :data-answer="exercise.answerAccented"
        placeholder="наберите правильную форму"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button type="submit" class="primary">Check</button>
    </form>

    <div v-else class="grid">
      <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
        <template v-if="wasCorrect">✓ Correct!</template>
        <template v-else>
          ✗ {{ exercise.answerAccented }}
          <SpeakButton :text="exercise.answerAccented" />
        </template>
      </p>
      <button class="primary next" @click="next">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.prompt-en {
  font-style: italic;
}
.phrase-line {
  font-size: 1.4rem;
  line-height: 1.8;
  text-align: left;
}
.target-btn {
  padding: 0.05rem 0.3rem;
  font-size: inherit;
  font-family: inherit;
  border: 2px solid var(--primary);
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
}
.mark-ok {
  background: color-mix(in srgb, var(--good) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--good);
  font-weight: 600;
}
.mark-err {
  background: color-mix(in srgb, var(--bad) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--bad);
  font-weight: 600;
}
.slot-label {
  font-size: 0.9rem;
}
</style>
