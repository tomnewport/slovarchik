<script setup>
// An on-screen keyboard for the phrase drill's intermediate level. Unlike the
// global RussianKeyboard it lives inline in the page, works for either alphabet
// and visually highlights a small set of keys (the correct next letter plus a
// couple of decoys) to nudge the learner along.
import { computed } from 'vue'

const props = defineProps({
  // 'ru' for a ЙЦУКЕН layout, 'en' for QWERTY.
  layout: { type: String, default: 'ru' },
  // Lowercase keys to highlight; ' ' highlights the space bar.
  highlight: { type: Array, default: () => [] },
})

const emit = defineEmits(['press', 'space', 'backspace', 'enter'])

const LAYOUTS = {
  ru: [
    [...'йцукенгшщзхъ'],
    [...'фывапролджэ'],
    [...'ячсмитьбюё'],
  ],
  en: [[...'qwertyuiop'], [...'asdfghjkl'], [...'zxcvbnm']],
}

const rows = computed(() => LAYOUTS[props.layout] ?? LAYOUTS.ru)
const lit = computed(() => new Set(props.highlight))

// Keys steal focus on click by default; prevent it so taps don't blur anything.
function keep(e) {
  e.preventDefault()
}
</script>

<template>
  <div class="hint-kbd" role="group" aria-label="On-screen keyboard" @mousedown="keep">
    <div v-for="(row, i) in rows" :key="i" class="hint-row">
      <button
        v-for="letter in row"
        :key="letter"
        type="button"
        class="hint-key"
        :class="{ lit: lit.has(letter) }"
        @click="emit('press', letter)"
      >
        {{ letter }}
      </button>
    </div>
    <div class="hint-row">
      <button type="button" class="hint-key hint-mod" aria-label="Backspace" @click="emit('backspace')">
        ⌫
      </button>
      <button
        type="button"
        class="hint-key hint-space"
        :class="{ lit: lit.has(' ') }"
        @click="emit('space')"
      >
        ␣
      </button>
      <button type="button" class="hint-key hint-mod" aria-label="Enter" @click="emit('enter')">
        ⏎
      </button>
    </div>
  </div>
</template>

<style scoped>
.hint-kbd {
  display: grid;
  gap: 0.35rem;
}

.hint-row {
  display: flex;
  gap: 0.3rem;
  justify-content: center;
}

.hint-key {
  flex: 1 1 0;
  min-width: 0;
  padding: 0.65rem 0.2rem;
  border-radius: 8px;
  font-size: 1.05rem;
  background: var(--card);
  border: 1px solid var(--border);
}

.hint-key:active:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}

/* The nudge: the next correct key and its decoys glow. */
.hint-key.lit {
  border-color: var(--primary);
  background: rgba(79, 125, 255, 0.22);
  box-shadow: 0 0 0 1px var(--primary);
}

.hint-mod {
  flex: 0 0 auto;
  min-width: 3rem;
  color: var(--muted);
}

.hint-space {
  flex: 3 1 0;
}
</style>
