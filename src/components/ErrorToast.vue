<script setup>
import { computed, watch } from 'vue'
import { errorToastState, dismissToast } from '../stores/errorToast.js'

const REPO = 'tomnewport/slovarchik'
const BASE = `https://github.com/${REPO}/issues/new`

// Build identifiers (injected by Vite — see vite.config.js). Stamping them into
// every error report is what tells us which build a crash came from, so a
// report against an already-fixed bug can be spotted as a stale (un-updated
// PWA) cache rather than a live regression.
const APP_COMMIT = typeof __APP_COMMIT_HASH__ === 'string' ? __APP_COMMIT_HASH__ : 'unknown'
const APP_BUILD = typeof __APP_BUILD_DATE__ === 'string' ? __APP_BUILD_DATE__ : 'unknown'

const reportUrl = computed(() => {
  const err = errorToastState.error
  if (!err) return '#'
  const title = `Unexpected error: ${err.message ?? 'unknown'}`
  const stack = (err.stack ?? String(err)).split('\n').slice(0, 12).join('\n')
  const body = [
    '## Unexpected app error',
    '',
    `**Message:** \`${err.message ?? 'unknown'}\``,
    '',
    '**Stack trace:**',
    '```',
    stack,
    '```',
    '',
    `**App version:** \`${APP_COMMIT}\` (built ${APP_BUILD})`,
    `**Browser:** ${navigator?.userAgent ?? 'unknown'}`,
    '',
    '**What were you doing when this happened?**',
    '<!-- Please describe the steps that led to this error -->',
  ].join('\n')
  return `${BASE}?${new URLSearchParams({ title, body })}`
})

let timer = null
watch(
  () => errorToastState.error,
  (err) => {
    clearTimeout(timer)
    if (err) timer = setTimeout(dismissToast, 8000)
  },
)
</script>

<template>
  <Transition name="toast">
    <div v-if="errorToastState.error" class="error-toast" role="alert" aria-live="assertive">
      <p class="toast-msg">Something went wrong — your progress may not have saved.</p>
      <div class="toast-row">
        <a :href="reportUrl" target="_blank" rel="noopener" class="toast-report">Report issue</a>
        <button class="toast-dismiss" aria-label="Dismiss" @click="dismissToast">✕</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.error-toast {
  position: fixed;
  bottom: 1.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  background: var(--card);
  border: 1px solid var(--bad);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  max-width: min(22rem, calc(100vw - 2rem));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
  display: grid;
  gap: 0.5rem;
}
.toast-msg {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text);
}
.toast-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.toast-report {
  font-size: 0.82rem;
  padding: 0.3rem 0.7rem;
  border-radius: 8px;
  background: var(--bad);
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}
.toast-report:hover {
  opacity: 0.88;
}
.toast-dismiss {
  margin-left: auto;
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  font-size: 0.8rem;
  padding: 0.25rem 0.55rem;
  cursor: pointer;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(1rem);
}
</style>
