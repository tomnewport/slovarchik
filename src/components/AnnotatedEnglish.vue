<script setup>
// An English phrase prompt with its ambiguity annotations attached. When the
// learner has to produce the Russian, the English alone often under-determines
// the answer — "Do you want tea?" hides ты vs вы, "I was tired" hides уста́л vs
// уста́ла — so each note is shown as a small parenthetical on the very word it
// disambiguates. Notes with no word to pin to (a bare imperative names nobody)
// trail the phrase. With no notes this renders the plain text, so it is safe to
// use for every English prompt, phrase or word.
import { computed } from 'vue'

import { annotateEnglish } from '../lib/phraseAmbiguity.js'

const props = defineProps({
  text: { type: String, default: '' },
  notes: { type: Array, default: () => [] },
})

const annotated = computed(() => annotateEnglish(props.text, props.notes))
</script>

<template>
  <span lang="en"
    ><template v-for="(part, i) in annotated.parts" :key="i"
      ><span :class="{ ambiguous: part.note }">{{ part.text }}</span
      ><small v-if="part.note" class="note"> ({{ part.note }})</small></template
    ><small v-for="note in annotated.trailing" :key="note" class="note"> ({{ note }})</small></span
  >
</template>

<style scoped>
.note {
  color: var(--muted, #6b7280);
  font-size: 0.7em;
  font-weight: 400;
  white-space: nowrap;
}
/* A dotted underline ties the note to the word it qualifies without competing
   with the phrase itself for attention. */
.ambiguous {
  text-decoration: underline dotted;
  text-underline-offset: 0.2em;
}
</style>
