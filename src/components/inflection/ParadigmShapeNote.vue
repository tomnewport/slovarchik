<script setup>
// Why this table is a different shape from the last one.
//
// A pruned paradigm — a perfective with no Present column, нача́ться with no
// «я / ты» rows — reads as a bug unless something says otherwise. This is that
// something: one or two sentences under the headword, in every place a table is
// drilled (free practice and the mastery session alike). It is never behind a
// disclosure and never gives an answer away: it explains the *slots*, which the
// learner can already see, not the forms that go in them.
import { computed } from 'vue'

import { paradigmNotes } from '../../lib/paradigmShape.js'

const props = defineProps({ paradigm: { type: Object, default: null } })

const notes = computed(() => paradigmNotes(props.paradigm))
</script>

<template>
  <aside v-if="notes.length" class="shape-note">
    <p class="shape-heading">🧩 Why this table is a different shape</p>
    <p v-for="note in notes" :key="note.key" class="shape-text">
      {{ note.text }}
      <b v-if="note.ru" lang="ru">{{ note.ru }}</b>
    </p>
  </aside>
</template>

<style scoped>
.shape-note {
  display: grid;
  gap: 0.35rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  text-align: left;
}
.shape-heading {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.shape-text {
  margin: 0;
  font-size: 0.9rem;
}
</style>
