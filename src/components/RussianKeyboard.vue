<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Standard ЙЦУКЕН layout — the same arrangement as a physical Russian keyboard.
const ROWS = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
  ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
  ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ё'],
]

// The input the keyboard currently types into. Russian inputs opt in with
// lang="ru"; we follow focus so a single shared keyboard serves every field.
const target = ref(null)
const shift = ref(false)

function isRussianInput(el) {
  return (
    el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
    el.getAttribute('lang') === 'ru' &&
    !el.disabled
  )
}

function onFocusIn(e) {
  if (isRussianInput(e.target)) {
    target.value = e.target
    // Suppress the device's native virtual keyboard so only ours shows on
    // touch screens; physical keys (backspace, arrows…) keep working.
    e.target.setAttribute('inputmode', 'none')
    // Make sure the field isn't hidden behind the fixed keyboard panel.
    requestAnimationFrame(() => e.target.scrollIntoView?.({ block: 'center' }))
  }
}

function onFocusOut(e) {
  if (e.target === target.value) {
    e.target.removeAttribute('inputmode')
    target.value = null
    shift.value = false
  }
}

onMounted(() => {
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
})

onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
})

// Replace the current selection (or insert at the caret) and let Vue's v-model
// pick up the change by dispatching the native input event it listens for.
function replaceSelection(text, caretDelta) {
  const el = target.value
  if (!el) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  el.value = el.value.slice(0, start) + text + el.value.slice(end)
  const caret = caretDelta != null ? start + caretDelta : start + text.length
  el.selectionStart = el.selectionEnd = caret
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function press(letter) {
  replaceSelection(shift.value ? letter.toUpperCase() : letter)
  shift.value = false // shift is one-shot, like a real keyboard
}

function space() {
  replaceSelection(' ')
}

function backspace() {
  const el = target.value
  if (!el) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  if (start === end) {
    if (start === 0) return
    el.value = el.value.slice(0, start - 1) + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start - 1
  } else {
    el.value = el.value.slice(0, start) + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function enter() {
  const el = target.value
  if (!el) return
  // Submit the surrounding form if there is one (the typing quiz checks here).
  el.closest('form')?.requestSubmit?.()
}

function hide() {
  target.value?.blur()
}

// Keys steal focus on click by default, which would blur the input and drop the
// caret. Prevent the default mousedown so the field stays focused.
function keep(e) {
  e.preventDefault()
}
</script>

<template>
  <div v-if="target" class="kbd" role="group" aria-label="Russian keyboard" @mousedown="keep">
    <div class="kbd-inner">
      <div v-for="(row, i) in ROWS" :key="i" class="kbd-row">
        <button
          v-for="letter in row"
          :key="letter"
          type="button"
          class="kbd-key"
          @click="press(letter)"
        >
          {{ shift ? letter.toUpperCase() : letter }}
        </button>
      </div>
      <div class="kbd-row">
        <button
          type="button"
          class="kbd-key kbd-mod"
          :class="{ active: shift }"
          :aria-pressed="shift"
          @click="shift = !shift"
        >
          ⇧
        </button>
        <button type="button" class="kbd-key kbd-space" @click="space">␣</button>
        <button type="button" class="kbd-key kbd-mod" aria-label="Backspace" @click="backspace">
          ⌫
        </button>
        <button type="button" class="kbd-key kbd-mod" aria-label="Enter" @click="enter">⏎</button>
        <button type="button" class="kbd-key kbd-mod" aria-label="Hide keyboard" @click="hide">
          ⌄
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kbd {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  padding: 0.5rem 0.5rem calc(0.5rem + env(safe-area-inset-bottom));
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
}

.kbd-inner {
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 0.35rem;
}

.kbd-row {
  display: flex;
  gap: 0.3rem;
  justify-content: center;
}

.kbd-key {
  flex: 1 1 0;
  min-width: 0;
  padding: 0.65rem 0.2rem;
  border-radius: 8px;
  font-size: 1.05rem;
  background: var(--card);
  border: 1px solid var(--border);
}

.kbd-key:active:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}

.kbd-mod {
  flex: 0 0 auto;
  min-width: 2.6rem;
  color: var(--muted);
}

.kbd-mod.active {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}

.kbd-space {
  flex: 2 1 0;
}
</style>
