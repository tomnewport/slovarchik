<script setup>
// Identification / hearing exercise: match a column of Russian words to a column
// of English. Covers match-vocab (Russian shown) and listen-match (Russian
// hidden behind a speaker, heard not seen). Tap one tile in each column to pair
// them; a wrong pairing flashes and counts against a perfect score.
import { computed, onBeforeUnmount, ref } from 'vue'

import { shuffle } from '../../lib/quiz.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const left = ref(shuffle(props.exercise.pairs)) // Russian
const right = ref(shuffle(props.exercise.pairs)) // English
const matched = ref(new Set())
const pickedRu = ref(null)
const pickedEn = ref(null)
const wrongFlash = ref(null)
let mistakes = 0
let flashTimer = null

const done = computed(() => matched.value.size === props.exercise.pairs.length)

function tryMatch() {
  if (pickedRu.value == null || pickedEn.value == null) return
  if (pickedRu.value === pickedEn.value) {
    matched.value = new Set([...matched.value, pickedRu.value])
    pickedRu.value = null
    pickedEn.value = null
  } else {
    mistakes++
    const miss = [pickedRu.value, pickedEn.value]
    wrongFlash.value = miss
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      if (wrongFlash.value === miss) wrongFlash.value = null
    }, 500)
    pickedRu.value = null
    pickedEn.value = null
  }
}

function pickRu(key) {
  if (matched.value.has(key)) return
  pickedRu.value = pickedRu.value === key ? null : key
  tryMatch()
}
function pickEn(key) {
  if (matched.value.has(key)) return
  pickedEn.value = pickedEn.value === key ? null : key
  tryMatch()
}

function next() {
  emit('done', { correct: mistakes === 0 })
}

function flashing(key) {
  return wrongFlash.value?.includes(key)
}

onBeforeUnmount(() => clearTimeout(flashTimer))
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <p class="muted">Match the pairs</p>
    <div class="columns">
      <div class="col">
        <button
          v-for="p in left"
          :key="'ru' + p.key"
          type="button"
          class="tile"
          :class="{ matched: matched.has(p.key), picked: pickedRu === p.key, flash: flashing(p.key) }"
          :disabled="matched.has(p.key)"
          @click="pickRu(p.key)"
        >
          <template v-if="exercise.audio">
            <SpeakButton :text="p.ru" />
          </template>
          <span v-else lang="ru">{{ p.ru }}</span>
        </button>
      </div>
      <div class="col">
        <button
          v-for="p in right"
          :key="'en' + p.key"
          type="button"
          class="tile"
          :class="{ matched: matched.has(p.key), picked: pickedEn === p.key, flash: flashing(p.key) }"
          :disabled="matched.has(p.key)"
          @click="pickEn(p.key)"
        >
          {{ p.en }}
        </button>
      </div>
    </div>

    <div class="row">
      <button v-if="done" class="primary next" @click="next">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.col {
  display: grid;
  gap: 0.4rem;
}
.tile {
  padding: 0.6rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 1.05rem;
}
.tile.picked {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 20%, var(--card));
}
.tile.matched {
  opacity: 0.35;
}
.tile.flash {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 20%, var(--card));
}
</style>
