<script setup>
// A modal showing everything the engine knows about one word's learning
// progress — its state, per-dimension mastery at both levels, and key dates —
// plus a "Leave for later" action that pops the word out of its current batch.
// Leaving discards the word's progress by default (so the app stays in sync with
// study happening elsewhere); an opt-in keeps it.
import { computed, ref } from 'vue'

import { state as vocabState } from '../stores/vocab.js'
import { wordProgressDetail, leaveForLater, markKnown, unmarkKnown } from '../stores/progress.js'
import { parseKey } from '../lib/vocabBuild.js'

const props = defineProps({
  wordKey: { type: String, required: true },
})
const emit = defineEmits(['close', 'left'])

const DIM_META = {
  identification: { icon: '👁️', name: 'Identification' },
  usage: { icon: '✍️', name: 'Usage' },
  hearing: { icon: '👂', name: 'Hearing' },
  speaking: { icon: '🗣️', name: 'Speaking' },
  context: { icon: '🛠️', name: 'Context' },
}
const LEVEL_LABEL = { learning: 'Learning', mastery: 'Mastery' }
const STATE_LABEL = {
  unknown: 'Not started',
  learning: 'Learning',
  learned: 'Learned',
  mastered: 'Mastered',
}

const word = computed(() => vocabState.words.find((w) => w.key === props.wordKey) ?? null)
const parsed = computed(() => parseKey(props.wordKey))
const headword = computed(() => word.value?.headword || word.value?.ru || parsed.value.ru)
const meaning = computed(() => word.value?.meaning || word.value?.en || parsed.value.en)

const detail = computed(() => wordProgressDetail(props.wordKey))

// Non-empty (level, dimensions) pairs, in learning-then-mastery order.
const sections = computed(() =>
  ['learning', 'mastery']
    .map((level) => ({ level, label: LEVEL_LABEL[level], dims: detail.value.levels[level] ?? [] }))
    .filter((s) => s.dims.length),
)

function dimStatus(dim) {
  if (dim.met) return { cls: 'met', text: '✓', title: 'Complete' }
  const need = dim.crit?.need ?? 0
  if (dim.crit?.type === 'attempts') {
    return { cls: dim.attempts ? 'partial' : 'empty', text: `${Math.min(dim.attempts, need)}/${need}`, title: 'Attempts' }
  }
  return { cls: dim.attempts ? 'partial' : 'empty', text: `${dim.correct}/${need}`, title: 'Correct answers' }
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const confirming = ref(false)
const keepProgress = ref(false)
const busy = ref(false)

async function confirmLeave() {
  if (busy.value) return
  busy.value = true
  await leaveForLater(props.wordKey, { keepProgress: keepProgress.value })
  emit('left', props.wordKey)
  emit('close')
}

async function markKnownWord() {
  if (busy.value) return
  busy.value = true
  try {
    await markKnown(props.wordKey)
  } finally {
    busy.value = false
  }
}

async function unmarkKnownWord() {
  if (busy.value) return
  busy.value = true
  try {
    await unmarkKnown(props.wordKey)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal card" role="dialog" aria-modal="true" aria-label="Word progress">
      <button class="modal-close" aria-label="Close" @click="emit('close')">✕</button>

      <header class="word-head">
        <div class="headword">{{ headword }}</div>
        <div class="meaning muted">{{ meaning }}</div>
        <div class="head-meta">
          <span v-if="word?.cefr" class="chip">{{ word.cefr }}</span>
          <span v-if="word?.pos" class="chip">{{ word.pos }}</span>
          <span class="chip state" :class="detail.state">{{ STATE_LABEL[detail.state] }}</span>
        </div>
      </header>

      <div v-if="sections.length" class="progress-body">
        <section v-for="s in sections" :key="s.level" class="level">
          <h4 class="level-title">{{ s.label }}</h4>
          <div class="dim-grid">
            <div
              v-for="d in s.dims"
              :key="d.dimension"
              class="dim"
              :class="dimStatus(d).cls"
            >
              <span class="dim-icon">{{ DIM_META[d.dimension]?.icon }}</span>
              <span class="dim-name">{{ DIM_META[d.dimension]?.name ?? d.dimension }}</span>
              <span class="dim-status" :title="dimStatus(d).title">{{ dimStatus(d).text }}</span>
            </div>
          </div>
        </section>
      </div>
      <p v-else class="muted no-progress">No progress recorded yet.</p>

      <dl class="stats">
        <div><dt>Best reached</dt><dd>{{ STATE_LABEL[detail.peak] }}</dd></div>
        <div><dt>Learned</dt><dd>{{ fmtDate(detail.learnedAt) }}</dd></div>
        <div v-if="detail.masteredAt"><dt>Mastered</dt><dd>{{ fmtDate(detail.masteredAt) }}</dd></div>
        <div><dt>Attempts</dt><dd>{{ detail.totalAttempts }}</dd></div>
        <div><dt>Last seen</dt><dd>{{ fmtDate(detail.lastAt) }}</dd></div>
      </dl>

      <div class="known-control" :class="{ on: detail.known }">
        <template v-if="!detail.known">
          <button class="know" :disabled="busy" @click="markKnownWord">✓ I already know this word</button>
          <p class="muted know-note">
            One correct answer per exercise will confirm it — no repeated drilling.
          </p>
        </template>
        <div v-else class="known-badge">
          <p class="known-line">✓ Marked as known — one correct answer per exercise confirms it.</p>
          <button class="linkish" :disabled="busy" @click="unmarkKnownWord">Undo</button>
        </div>
      </div>

      <footer class="actions">
        <template v-if="!confirming">
          <button class="ghost" @click="emit('close')">Close</button>
          <button class="leave" @click="confirming = true">Leave for later</button>
        </template>
        <div v-else class="confirm">
          <p class="confirm-msg">
            Remove <strong>{{ headword }}</strong> from your current batch?
          </p>
          <label class="keep">
            <input v-model="keepProgress" type="checkbox" />
            Keep my progress on this word
          </label>
          <p class="muted keep-note">
            {{ keepProgress ? 'Progress is kept — the word just leaves the batch.' : 'Progress on this word will be erased.' }}
          </p>
          <div class="confirm-row">
            <button class="ghost" :disabled="busy" @click="confirming = false">Cancel</button>
            <button class="leave" :disabled="busy" @click="confirmLeave">Leave for later</button>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  /* `margin: auto` on the modal centres it when it fits and lets the backdrop
     scroll (top reachable) when it's taller than the viewport — unlike
     align-items: center, which would clip the top on short screens. */
  overflow-y: auto;
  z-index: 60;
  padding: 1rem;
}
.modal {
  position: relative;
  margin: auto;
  width: 100%;
  max-width: 24rem;
  display: grid;
  gap: 1.1rem;
}
.modal-close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--muted);
  cursor: pointer;
}
.word-head {
  display: grid;
  gap: 0.25rem;
  padding-right: 2rem;
}
.headword {
  font-size: 1.5rem;
  font-weight: 600;
}
.meaning {
  font-size: 0.95rem;
}
.head-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.3rem;
}
.chip {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--bg-soft);
  color: var(--muted);
}
.chip.state {
  font-weight: 600;
}
.chip.state.learned {
  background: color-mix(in srgb, var(--good) 20%, transparent);
  color: var(--good);
}
.chip.state.mastered {
  background: color-mix(in srgb, var(--gold) 22%, transparent);
  color: var(--gold);
}
.chip.state.learning {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--primary);
}
.progress-body {
  display: grid;
  gap: 0.9rem;
}
.level-title {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.dim-grid {
  display: grid;
  gap: 0.4rem;
}
.dim {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  background: var(--bg-soft);
}
.dim-icon {
  font-size: 1rem;
  flex-shrink: 0;
}
.dim-name {
  flex: 1;
  font-size: 0.88rem;
}
.dim-status {
  font-size: 0.82rem;
  font-weight: 600;
  flex-shrink: 0;
}
.dim.met .dim-status {
  color: var(--good);
}
.dim.partial {
  opacity: 0.9;
}
.dim.empty {
  opacity: 0.55;
}
.no-progress {
  font-size: 0.9rem;
  margin: 0;
}
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1rem;
  margin: 0;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
}
.stats div {
  display: grid;
  gap: 0.05rem;
}
.stats dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
}
.stats dd {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
}
.known-control {
  display: grid;
  gap: 0.35rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
}
.know {
  justify-self: start;
  background: color-mix(in srgb, var(--good) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--good) 45%, transparent);
  border-radius: 8px;
  color: var(--good);
  font-weight: 600;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}
.know:disabled {
  opacity: 0.6;
  cursor: default;
}
.know-note {
  margin: 0;
  font-size: 0.78rem;
}
.known-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.known-line {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--good);
}
.linkish {
  background: none;
  border: none;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.8rem;
  flex-shrink: 0;
}
.linkish:disabled {
  opacity: 0.6;
  cursor: default;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border);
}
.confirm {
  width: 100%;
  display: grid;
  gap: 0.5rem;
}
.confirm-msg {
  margin: 0;
  font-size: 0.92rem;
}
.keep {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.keep-note {
  margin: 0;
  font-size: 0.78rem;
}
.confirm-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.2rem;
}
.ghost {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}
.leave {
  background: var(--bad, #ef4444);
  border: 1px solid transparent;
  border-radius: 8px;
  color: #fff;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}
.leave:disabled,
.ghost:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
