<script setup>
// Render a Russian phrase word by word, making words the learner hasn't learned
// yet (and isn't actively drilling) hintable — see stores/hints.js for the rule.
//
// Two presentations:
//   tap    (default) hintable words are buttons; tapping one reveals its English
//          meaning in a little tooltip and reads it aloud slowly.
//   inline hintable words always show their meaning underneath — used while the
//          learner assembles a translation, so unknown words don't block them.
import { computed, ref } from 'vue'

import { hintTokensFor } from '../stores/hints.js'
import { speak } from '../lib/speech.js'

const props = defineProps({
  text: { type: String, required: true },
  mode: { type: String, default: 'tap' }, // 'tap' | 'inline'
})

// A single hinted word is read slower than a whole phrase so each sound is clear.
const SLOW_RATE = 0.6

const tokens = computed(() => hintTokensFor(props.text))

// Index of the tap-mode word whose tooltip is open, or -1 for none.
const open = ref(-1)

function toggle(i, token) {
  open.value = open.value === i ? -1 : i
  if (open.value === i) speak(token.text, 'ru-RU', SLOW_RATE)
}
</script>

<template>
  <span class="phrase" lang="ru">
    <template v-for="(t, i) in tokens" :key="i">
      <span v-if="!t.hint" class="word">{{ t.text }}</span>

      <span v-else-if="mode === 'inline'" class="word hinted inline">
        <span class="ru">{{ t.text }}</span>
        <small class="gloss" lang="en">{{ t.hint.en }}</small>
      </span>

      <button
        v-else
        type="button"
        class="word hinted tap"
        :class="{ open: open === i }"
        :aria-expanded="open === i"
        @click="toggle(i, t)"
      >
        <span class="ru">{{ t.text }}</span>
        <small v-if="open === i" class="gloss tip" lang="en">{{ t.hint.en }}</small>
      </button>
    </template>
  </span>
</template>

<style scoped>
.phrase {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.1em 0.35em;
}
.word {
  display: inline-flex;
}
.hinted {
  flex-direction: column;
  align-items: center;
}
/* Hinted words are dotted-underlined to signal there's a meaning to reveal. */
.hinted .ru {
  border-bottom: 2px dotted var(--primary);
}
.tap {
  position: relative;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.tap.open .ru {
  color: var(--primary);
}
.gloss {
  color: var(--muted);
  font-size: 0.7em;
  line-height: 1.2;
}
/* The tap tooltip floats above the word so it doesn't shift the phrase layout. */
.gloss.tip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 0.3em;
  padding: 0.2em 0.5em;
  white-space: nowrap;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  z-index: 5;
}
</style>
