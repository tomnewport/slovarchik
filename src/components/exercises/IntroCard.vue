<script setup>
// "Here is a new word" — the non-graded step that runs immediately before the
// first exercise to test a word the learner has never met (#587).
//
// Without it, a word's first appearance is a flashcard or a spelling prompt for
// something never seen: a guaranteed miss, recorded as a miss, with the word
// taught by the reveal — the worst possible moment to learn it. The card turns
// that first encounter into an introduction, and the exercise that follows into
// an actual test.
//
// Nothing here is graded. The runner walks past it with `advance()`, so session
// accuracy is exactly what it would have been without the card.
import { computed, onMounted } from 'vue'

import { state as vocabState } from '../../stores/vocab.js'
import { posLabel } from '../../lib/spellPrompt.js'
import { speak } from '../../lib/speech.js'
import SpeakButton from '../SpeakButton.vue'
import WordFacts from '../WordFacts.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done', 'known'])

const GENDER_LABEL = { m: 'masculine', f: 'feminine', n: 'neuter' }

const wordKey = computed(() => (props.exercise.targets ?? [])[0] ?? null)
const word = computed(() => vocabState.words.find((w) => w.key === wordKey.value) ?? null)

const headword = computed(() => word.value?.headword || word.value?.ru || '')
const meaning = computed(() => word.value?.meaning || word.value?.en || '')
const note = computed(() => word.value?.meaningNote || '')

/** The small facts that sit under the headword — only the ones this word has. */
const chips = computed(() => {
  const w = word.value
  if (!w) return []
  return [
    posLabel(w.pos, w.aspect),
    w.pos === 'noun' ? GENDER_LABEL[w.gender] : '',
    w.cefr,
  ].filter(Boolean)
})

/**
 * One example sentence from the word's own `usage:` — the shortest available,
 * since a first meeting is not the place for the longest sentence in the corpus.
 */
const example = computed(() => {
  const usage = (word.value?.usage ?? []).filter((u) => u?.ru && u?.en_gb)
  if (!usage.length) return null
  const shortest = usage.reduce((best, u) => (u.ru.length < best.ru.length ? u : best), usage[0])
  return { ru: shortest.ru, en: shortest.en_gb }
})

onMounted(() => {
  // Heard once as it appears — the sound is half of meeting a word.
  if (headword.value) speak(headword.value)
})
</script>

<template>
  <div class="grid intro-card" style="gap: 1rem">
    <p class="muted new-label">A new word</p>

    <div class="cue">
      <span lang="ru" class="ru">{{ headword }}</span>
      <SpeakButton :text="headword" />
    </div>

    <div class="chips">
      <span v-for="chip in chips" :key="chip" class="chip">{{ chip }}</span>
    </div>

    <p class="meaning">
      {{ meaning }}
      <small v-if="note" class="muted">({{ note }})</small>
    </p>

    <div v-if="example" class="example card">
      <p class="ex-ru">
        <span lang="ru">{{ example.ru }}</span>
        <SpeakButton :text="example.ru" />
      </p>
      <p class="ex-en muted">{{ example.en }}</p>
    </div>

    <!-- The whole point of the card: everything the app can say about the word,
         before it is ever tested. -->
    <WordFacts v-if="wordKey" :word-key="wordKey" />

    <div class="row actions">
      <button class="primary got-it" @click="emit('done')">Got it →</button>
      <button class="ghost known" @click="emit('known')">I know this already</button>
    </div>
  </div>
</template>

<style scoped>
.new-label {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.cue {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  text-align: center;
}
.ru {
  font-size: 2.2rem;
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}
.chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.6rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.meaning {
  margin: 0;
  text-align: center;
  font-size: 1.2rem;
}
.example {
  text-align: left;
}
.ex-ru {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.25rem;
}
.ex-en {
  margin: 0;
  font-size: 0.9rem;
}
.actions {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
