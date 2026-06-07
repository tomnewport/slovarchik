<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { keyboard, toggleHint } from '../stores/keyboard.js'
import { nextChar, hintKeys, RU_LETTERS } from '../lib/phrases.js'

// Standard ЙЦУКЕН layout — the same arrangement as a physical Russian keyboard,
// where ё sits on its own key in the top-left corner (rendered as its own row
// below), above the йцукен row.
const ROWS = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
  ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
  ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю'],
]

// The input the keyboard currently types into. Russian inputs opt in with
// lang="ru"; we follow focus so a single shared keyboard serves every field.
const target = ref(null)
const shift = ref(false)
// Reactive mirror of the focused field used to drive the next-letter hint: the
// expected answer (from data-answer) and what the learner has typed so far.
const answer = ref('')
const typed = ref('')

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
    answer.value = e.target.dataset.answer ?? ''
    typed.value = e.target.value
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
    answer.value = ''
    typed.value = ''
  }
}

// Keep the hint in step with the field as the learner types — on-screen taps
// and physical keys both fire `input`, and data-answer can change per question.
function onInput(e) {
  if (e.target === target.value) {
    typed.value = e.target.value
    answer.value = e.target.dataset.answer ?? ''
  }
}

onMounted(() => {
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('input', onInput)
})

onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  document.removeEventListener('input', onInput)
})

// Keys to light when the hint is switched on: the next correct character plus a
// couple of decoys. Empty unless the learner turned the hint on and the focused
// field declares the answer it expects (via data-answer).
const hint = computed(() => {
  if (!keyboard.on || !answer.value) return new Set()
  return new Set(hintKeys(nextChar(answer.value, typed.value), RU_LETTERS))
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
  // Give the focused field a chance to handle Enter itself — an inflection table
  // advances to its next empty box (and cancels the event). If nothing cancels
  // it, fall back to submitting the surrounding form (the typing quiz checks).
  const handled = !el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  if (!handled) el.closest('form')?.requestSubmit?.()
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
      <div class="kbd-row kbd-row-yo">
        <button
          type="button"
          class="kbd-key kbd-yo"
          :class="{ hint: hint.has('ё') }"
          @click="press('ё')"
        >
          {{ shift ? 'Ё' : 'ё' }}
        </button>
      </div>
      <div v-for="(row, i) in ROWS" :key="i" class="kbd-row">
        <button
          v-for="letter in row"
          :key="letter"
          type="button"
          class="kbd-key"
          :class="{ hint: hint.has(letter) }"
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
        <button
          type="button"
          class="kbd-key kbd-mod"
          :class="{ active: keyboard.on }"
          :aria-pressed="keyboard.on"
          aria-label="Toggle hint"
          @click="toggleHint"
        >
          💡
        </button>
        <button type="button" class="kbd-key kbd-space" :class="{ hint: hint.has(' ') }" @click="space">
          ␣
        </button>
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

/* The next character to type (and its decoys) when the hint is switched on. */
.kbd-key.hint {
  background: color-mix(in srgb, var(--primary) 22%, var(--card));
  border-color: var(--primary);
  font-weight: 700;
}

.kbd-key.hint:active:not(:disabled) {
  background: var(--primary);
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

/* ё lives on its own key in the top-left corner of a physical Russian keyboard,
   so it sits left-aligned at normal key width rather than stretching the row. */
.kbd-row-yo {
  justify-content: flex-start;
}

.kbd-yo {
  flex: 0 0 auto;
  min-width: 2.6rem;
}
</style>
