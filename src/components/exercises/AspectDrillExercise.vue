<script setup>
// Verb usage-mastery drill: one aspect pair, a list of English sentences that
// use it in different tenses and aspects. Stage 1 — for each sentence the
// learner picks which member of the pair (imperfective or perfective
// infinitive) the Russian needs; the pick is graded at once and the real
// Russian sentence is revealed (and spoken — it is the authored, correct
// sentence, so it is always safe to voice). Stage 2 — spell one conjugated
// form, reusing the single-sentence context renderer (PhraseFixExercise) for
// the identical slot-and-keyboard interaction.
//
// The exercise counts as correct only if every aspect pick and the spelling
// were right. The descriptor is built by lib/phraseContext.buildAspectDrill.
import { computed, ref } from 'vue'

import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'
import PhraseFixExercise from './PhraseFixExercise.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// item id → the option id the learner picked (locked once made).
const answers = ref({})
const allAnswered = computed(() =>
  props.exercise.items.every((it) => answers.value[it.id] != null),
)
const picksCorrect = computed(() =>
  props.exercise.items.every((it) => answers.value[it.id] === it.answer),
)
const missedCount = computed(
  () => props.exercise.items.filter((it) => answers.value[it.id] !== it.answer).length,
)

// 'pick' (the sentence list) → 'spell' (one conjugated form).
const stage = ref('pick')

function pick(item, opt) {
  if (stage.value !== 'pick' || answers.value[item.id] != null) return
  answers.value = { ...answers.value, [item.id]: opt.id }
  const right = opt.id === item.answer
  playFeedback(right)
  // The authored sentence is correct Russian — reveal and voice it.
  speak(item.ru)
}

function labelFor(aspectId) {
  return props.exercise.options.find((o) => o.id === aspectId)?.label ?? aspectId
}

function toSpell() {
  stage.value = 'spell'
}

// The embedded spelling stage grades itself; combine it with the picks.
function onSpellDone(result) {
  emit('done', { correct: picksCorrect.value && !!result.correct })
}
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <!-- Stage 1 — pick the aspect for each sentence -->
    <template v-if="stage === 'pick'">
      <p class="prompt">
        <span class="muted">Which verb does each sentence need?</span>
      </p>

      <!-- The pair, with its usage cues, as a legend for the whole list. -->
      <div class="pair-legend">
        <p v-for="opt in exercise.options" :key="opt.id" class="pair-line muted">
          <strong lang="ru">{{ opt.label }}</strong> — {{ opt.hint }}
        </p>
      </div>

      <ol class="items">
        <li v-for="item in exercise.items" :key="item.id" class="item">
          <p class="item-en">{{ item.en }}</p>
          <div v-if="answers[item.id] == null" class="row options">
            <button
              v-for="opt in exercise.options"
              :key="opt.id"
              type="button"
              class="aspect-btn"
              lang="ru"
              @click="pick(item, opt)"
            >
              {{ opt.label }}
            </button>
          </div>
          <template v-else>
            <p class="verdict" :class="answers[item.id] === item.answer ? 'good' : 'bad'">
              <template v-if="answers[item.id] === item.answer">✓ {{ labelFor(item.answer) }}</template>
              <template v-else>
                ✗ {{ labelFor(answers[item.id]) }} — it needed
                <strong lang="ru">{{ labelFor(item.answer) }}</strong>
              </template>
            </p>
            <p class="item-ru" lang="ru">
              {{ item.ru }}
              <SpeakButton :text="item.ru" />
            </p>
          </template>
        </li>
      </ol>

      <template v-if="allAnswered">
        <p class="feedback" :class="picksCorrect ? 'good' : 'bad'">
          <template v-if="picksCorrect">✓ All {{ exercise.items.length }} right!</template>
          <template v-else>{{ missedCount }} of {{ exercise.items.length }} missed.</template>
        </p>
        <button class="primary to-spell" @click="toSpell">Now spell a form →</button>
      </template>
    </template>

    <!-- Stage 2 — spell one conjugated form (the shared context renderer) -->
    <template v-else>
      <PhraseFixExercise :exercise="exercise.spell" @done="onSpellDone" />
    </template>
  </div>
</template>

<style scoped>
.prompt {
  font-size: 1.1rem;
  margin: 0;
}
.pair-legend {
  display: grid;
  gap: 0.15rem;
  text-align: left;
}
.pair-line {
  margin: 0;
  font-size: 0.85rem;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.9rem;
  text-align: left;
}
.item {
  display: grid;
  gap: 0.35rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--border, #ccc);
}
.item:last-child {
  border-bottom: 0;
}
.item-en {
  margin: 0;
  font-style: italic;
}
.options {
  gap: 0.5rem;
}
.aspect-btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  background: var(--card);
  font-size: 1rem;
  cursor: pointer;
}
.aspect-btn:hover {
  border-color: var(--primary);
}
.verdict {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}
.verdict.good {
  color: var(--good);
}
.verdict.bad {
  color: var(--bad);
}
.item-ru {
  margin: 0;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.to-spell {
  justify-self: start;
}
</style>
