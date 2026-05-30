<script setup>
// Exercise 1 — show one inflected form; the learner selects every cell (row ×
// column) in which that exact form appears, capturing Russian syncretism.
import { computed, onMounted, reactive, ref } from 'vue'

import { cellKey, cellLabel, matchingCells } from '../../lib/paradigm.js'
import { sample } from '../../lib/quiz.js'
import { speak } from '../../lib/speech.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ paradigm: { type: Object, required: true } })
const emit = defineEmits(['graded'])

// Pick a form to identify, biased toward forms that exist (any cell).
const probe = sample(props.paradigm.cells, 1)[0]
const correct = computed(
  () => new Set(matchingCells(props.paradigm, probe.form).map((c) => cellKey(c.row, c.col))),
)

const selected = reactive(new Set())
const checked = ref(false)

function toggle(key) {
  if (checked.value) return
  selected.has(key) ? selected.delete(key) : selected.add(key)
}

function check() {
  if (checked.value) return
  checked.value = true
  const want = correct.value
  const ok = want.size === selected.size && [...want].every((k) => selected.has(k))
  // Record the probe slot, plus every slot wrongly selected.
  const records = [{ slot: cellKey(probe.row, probe.col), correct: ok }]
  for (const key of selected) {
    if (!want.has(key)) records.push({ slot: key, correct: false })
  }
  emit('graded', ok, records)
}

onMounted(() => speak(probe.form))
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="card" style="text-align: center">
      <div class="muted">Which slot(s) could this form be?</div>
      <div style="font-size: 2rem; margin: 0.4rem 0" lang="ru">{{ probe.form }}</div>
      <SpeakButton :text="probe.form" />
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem">
      <button
        v-for="cell in paradigm.cells"
        :key="cellKey(cell.row, cell.col)"
        class="choice"
        :class="
          checked
            ? correct.has(cellKey(cell.row, cell.col))
              ? 'correct'
              : selected.has(cellKey(cell.row, cell.col))
                ? 'wrong'
                : ''
            : selected.has(cellKey(cell.row, cell.col))
              ? 'primary'
              : ''
        "
        @click="toggle(cellKey(cell.row, cell.col))"
      >
        {{ cellLabel(paradigm, cell) }}
      </button>
    </div>

    <div class="row">
      <button v-if="!checked" class="primary" :disabled="selected.size === 0" @click="check">
        Check
      </button>
    </div>
  </div>
</template>
