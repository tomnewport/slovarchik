<script setup>
// The help control for the typing drills (#725): one button that says how the
// learner is doing and what help is left.
//
//   🔥 | Hints    working unaided — the fire is the badge for it, and pressing
//                 it is the first ask for help: the keyboard hint comes on.
//   🤔 | Pass     help has been taken — the fire greys out, fades and is
//                 replaced by a thinking face, and the remaining escape is the
//                 old "I don't know": give up on the question.
//
// It replaces the "I don't know" link rather than sitting beside it, so there
// is one place to look for help and its state is the answer to "am I still
// doing this on my own?". Giving up stays a deliberate act — this button only
// *opens* that door; the caller still confirms before anything is revealed.
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  // Whether help has been taken for this exercise (the keyboard hint switched
  // on, or unlocked for an aided retry). Once true it never goes back.
  hinted: { type: Boolean, default: false },
  // Whether giving up is offered at all. An exercise with nothing to reveal
  // shows the spent fire and no action.
  canPass: { type: Boolean, default: true },
})
const emit = defineEmits(['hints', 'pass'])

// How long the fire takes to go out before the thinking face takes its place.
// Matches the CSS transition below, so the swap lands on a face already grey.
const BURN_OUT_MS = 450

// Mounted already hinted (a repeat of an exercise that was helped): the fire
// was never lit here, so there is no going-out to animate.
const face = ref(props.hinted ? '🤔' : '🔥')
let timer = null

watch(
  () => props.hinted,
  (hinted) => {
    if (!hinted || face.value !== '🔥') return
    timer = setTimeout(() => {
      face.value = '🤔'
    }, BURN_OUT_MS)
  },
)

onBeforeUnmount(() => clearTimeout(timer))

function onClick() {
  if (props.hinted) emit('pass')
  else emit('hints')
}
</script>

<template>
  <button
    type="button"
    class="hint-pass"
    :class="{ spent: hinted }"
    :disabled="hinted && !canPass"
    @click="onClick"
  >
    <span class="face" :class="{ out: hinted }" aria-hidden="true">{{ face }}</span>
    <span class="label">{{ hinted ? 'Pass' : 'Hints' }}</span>
  </button>
</template>

<style scoped>
.hint-pass {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--muted);
  font-size: 0.85rem;
  overflow: hidden;
}
.face {
  display: flex;
  align-items: center;
  padding: 0.35rem 0.5rem;
  font-size: 1rem;
  line-height: 1;
  transition:
    filter 0.45s ease,
    opacity 0.45s ease;
}
.face.out {
  filter: grayscale(1);
  opacity: 0.45;
}
.label {
  display: flex;
  align-items: center;
  padding: 0.35rem 0.7rem;
  border-left: 1px solid var(--border);
}
.hint-pass:disabled {
  opacity: 0.6;
}
.hint-pass:disabled .label {
  display: none;
}
</style>
