<script setup>
// Identification / hearing exercise: rebuild the English translation of a
// Russian phrase by tapping word tiles from a bank (with decoys). Covers
// translate-phrase (source shown) and listen-translate (source heard).
import { computed, onMounted, ref } from 'vue'

import { buildListeningBank, listeningTokens, phraseCorrect } from '../../lib/phrases.js'
import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import HintablePhrase from '../HintablePhrase.vue'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done', 'dispute'])

// A small decoy pool: the other words of the phrase plus a few generic fillers.
const DECOYS = ['the', 'a', 'and', 'to', 'is', 'in', 'of', 'it', 'you', 'we']
const bank = ref(buildListeningBank(props.exercise.en, DECOYS, 3))
const placed = ref([])
const checked = ref(false)
const wasCorrect = ref(false)
// Honesty system: a phrase can have several valid English renderings we don't
// all store. If the learner believes a "wrong" grade was actually right, they
// can override it — crediting the attempt and reporting it for curation.
const overridden = ref(false)

const placedIds = computed(() => new Set(placed.value.map((t) => t.id)))
const assembled = computed(() => placed.value.map((t) => t.text).join(' '))

function pick(tile) {
  if (checked.value || placedIds.value.has(tile.id)) return
  placed.value.push(tile)
}
function unpick(tile) {
  if (checked.value) return
  placed.value = placed.value.filter((t) => t.id !== tile.id)
}

function check() {
  if (checked.value) return
  wasCorrect.value = phraseCorrect(assembled.value, props.exercise.en)
  checked.value = true
  playFeedback(wasCorrect.value)
}

function markCorrect() {
  if (!checked.value || wasCorrect.value) return
  overridden.value = true
  wasCorrect.value = true
  playFeedback(true)
  // Report the disputed grading so a genuinely-missing translation can be
  // folded into the vocab data later.
  emit('dispute', { submitted: assembled.value })
}

function next() {
  emit('done', { correct: wasCorrect.value })
}

onMounted(() => {
  // The Russian is the subject here whether it's heard (listen-translate) or
  // shown (translate-phrase), so read it aloud as soon as the exercise appears.
  speak(props.exercise.ru)
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="prompt">
      <template v-if="exercise.audio">
        <span class="muted">Translate what you hear</span>
        <SpeakButton :text="exercise.ru" />
      </template>
      <HintablePhrase v-else :text="exercise.ru" mode="inline" class="cue" />
    </div>

    <div class="answer-line card" :aria-label="assembled">
      <button
        v-for="tile in placed"
        :key="tile.id"
        type="button"
        class="tile placed"
        :disabled="checked"
        @click="unpick(tile)"
      >
        {{ tile.text }}
      </button>
      <span v-if="!placed.length" class="muted">Tap the words in order…</span>
    </div>

    <div class="bank">
      <button
        v-for="tile in bank"
        :key="tile.id"
        type="button"
        class="tile"
        :disabled="checked || placedIds.has(tile.id)"
        @click="pick(tile)"
      >
        {{ tile.text }}
      </button>
    </div>

    <div v-if="checked" class="feedback" :class="wasCorrect ? 'ok' : 'no'">
      <strong>{{ overridden ? 'Marked correct' : wasCorrect ? 'Correct' : 'Answer:' }}</strong>
      <span>{{ listeningTokens(exercise.en).join(' ') }}</span>
    </div>

    <p v-if="checked && !wasCorrect" class="dispute">
      Sure your translation also works?
      <button type="button" class="link" @click="markCorrect">I was right →</button>
    </p>

    <div class="row">
      <button v-if="!checked" class="primary check" :disabled="!placed.length" @click="check">
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
.answer-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 3rem;
  align-items: center;
}
.bank {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.tile {
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 1.05rem;
}
.tile.placed {
  border-color: var(--primary);
}
.feedback.ok strong {
  color: var(--good);
}
.feedback.no strong {
  color: var(--bad);
}
.dispute {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}
.dispute .link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
}
</style>
