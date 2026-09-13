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
import { ASPECT_LABEL, MOTION_LABEL } from '../lib/phraseContext.js'
import WordFacts from './WordFacts.vue'

const props = defineProps({
  wordKey: { type: String, required: true },
})
const emit = defineEmits(['close', 'left', 'open-word'])

const DIM_META = {
  identification: { icon: '👁️', name: 'Identification' },
  usage: { icon: '✍️', name: 'Usage' },
  hearing: { icon: '👂', name: 'Hearing' },
  speaking: { icon: '🗣️', name: 'Speaking' },
  context: { icon: '🛠️', name: 'Context' },
}
const LEVEL_LABEL = { learning: 'Learning', mastery: 'Mastery' }
// What each status card's rows are told, said again in full on the card they
// open: a heading that names the drop, and a line per skill saying its price.
const RECOVERY_COPY = {
  slipped: {
    badge: 'Slipped',
    lead: 'This word has dropped below the best state it reached. To win it back:',
  },
  'at-risk': {
    badge: 'At risk',
    lead: 'Still meeting every criterion, but the last answer here was wrong — one more miss drops it. To secure it:',
  },
}
const STATE_LABEL = {
  unknown: 'Not started',
  learning: 'Learning',
  learned: 'Learned',
  mastered: 'Mastered',
}
// The confirmation review (#313) in a badge, per status. `none` has no entry:
// the word has never been learned (or has slipped back below it), so there is
// nothing to confirm and the line is left off rather than shown as pending.
const CONFIRM_BADGE = {
  confirmed: { label: 'Confirmed', cls: 'good' },
  waived: { label: 'Waived', cls: 'good' },
  waiting: { label: 'Unconfirmed', cls: 'wait' },
  due: { label: 'Review due', cls: 'wait' },
  failed: { label: 'Not retained', cls: 'bad' },
}

const word = computed(() => vocabState.words.find((w) => w.key === props.wordKey) ?? null)
const parsed = computed(() => parseKey(props.wordKey))
const headword = computed(() => word.value?.headword || word.value?.ru || parsed.value.ru)

// The home dashboard's rows are abbreviated so their dimension pips stay on
// screen; this card is where the word gets explained in full. So take the
// authored meaning whole — its parenthetical clarification included — rather
// than the short gloss the rows and drills share.
const meaning = computed(() => {
  const w = word.value
  return w?.meaningFull || w?.meaning || w?.en || parsed.value.en
})

/** Alternative renderings of the same word, kept out of the row entirely. */
const altMeanings = computed(() => word.value?.meaningsAlt ?? [])

/**
 * The grammatical contrast the row could only abbreviate to "impf." / "det.",
 * said in full. A chip rather than a second parenthetical: the meaning already
 * carries one, and stacking them reads as a typo.
 */
const contrast = computed(() => {
  const w = word.value
  if (w?.aspectPair && ASPECT_LABEL[w.aspect]) return ASPECT_LABEL[w.aspect]
  if (w?.motionPair && MOTION_LABEL[w.motion]) return MOTION_LABEL[w.motion]
  return null
})

const detail = computed(() => wordProgressDetail(props.wordKey))

// The recovery plan, but only when there is something to recover — a steady
// word gets no panel rather than a reassuring empty one.
const recovery = computed(() => {
  const plan = detail.value.recovery
  return plan && RECOVERY_COPY[plan.status] ? plan : null
})
const recoveryCopy = computed(() => (recovery.value ? RECOVERY_COPY[recovery.value.status] : null))

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
  // Against a ratio criterion only the answers inside its window count, so show
  // that figure — a word with seven lifetime correct answers and two recent
  // misses is at 2/3, and reading "7/3" beside an unfinished dimension looks
  // like the engine has lost count.
  return {
    cls: dim.attempts ? 'partial' : 'empty',
    text: `${dim.windowCorrect ?? dim.correct}/${need}`,
    title: 'Correct answers in the recent window',
  }
}

// Where the word stands with the memory scheduler: when each skill is next
// expected, and whether it has held overnight. The rows come ordered
// most-overdue-first — the order the due queue itself draws in — so the top row
// is the skill a session would reach for next.
const review = computed(() => detail.value.review)
const confirmBadge = computed(() => CONFIRM_BADGE[review.value.confirmation.status] ?? null)
// Worth a panel at all? A word with neither a schedule nor anything to say about
// confirmation has not been answered yet, and an empty "Spaced review" heading
// explains less than no heading.
const hasReview = computed(() => review.value.scheduled || !!confirmBadge.value)

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
        <div v-if="altMeanings.length" class="meaning-alt muted">
          also: {{ altMeanings.join('; ') }}
        </div>
        <div class="head-meta">
          <span v-if="word?.cefr" class="chip">{{ word.cefr }}</span>
          <span v-if="word?.pos" class="chip">{{ word.pos }}</span>
          <span v-if="contrast" class="chip">{{ contrast }}</span>
          <span class="chip state" :class="detail.state">{{ STATE_LABEL[detail.state] }}</span>
        </div>
      </header>

      <!-- What dropped, and what would put it back — the same answer the
           slipped / at-risk rows give in one line, said here in full. -->
      <section v-if="recovery" class="recovery" :class="recovery.status">
        <p class="recovery-head">
          <span class="recovery-badge">{{ recoveryCopy.badge }}</span>
          <span v-if="recovery.from" class="recovery-move">
            {{ recovery.from }} → {{ recovery.to }}
          </span>
        </p>
        <p class="recovery-lead">{{ recoveryCopy.lead }}</p>
        <ul class="recovery-steps">
          <li v-for="s in recovery.steps" :key="`${s.level}:${s.dimension}`" class="recovery-step">
            <span class="step-icon">{{ DIM_META[s.dimension]?.icon }}</span>
            <span class="step-name">
              {{ s.name }}
              <small class="muted">{{ LEVEL_LABEL[s.level].toLowerCase() }}<template v-if="s.ask"> · {{ s.ask }}</template></small>
            </span>
            <span class="step-need">{{ s.text }}</span>
          </li>
        </ul>
        <p v-if="recovery.steps.some((s) => s.anotherDay)" class="recovery-note muted">
          A skill that needs answers on two different days can't be finished in one sitting — the
          engine wants proof the word survived a night.
        </p>
      </section>

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

      <!-- The other half of the spaced-repetition model: not what the learner
           has done, but when the engine expects each skill back, and whether the
           word survived its first night (#313). -->
      <section v-if="hasReview" class="review">
        <h4 class="level-title">Spaced review</h4>
        <p v-if="confirmBadge" class="confirm-line" :class="confirmBadge.cls">
          <span class="confirm-badge">{{ confirmBadge.label }}</span>
          <span class="confirm-text">
            {{ review.confirmation.text }}
            <template v-if="review.confirmation.status === 'confirmed'">
              ({{ fmtDate(review.confirmation.at) }})
            </template>
            <template v-else-if="review.confirmation.status === 'waiting'">
              (from {{ fmtDate(review.confirmation.eligibleAt) }})
            </template>
            <template v-else-if="review.confirmation.status === 'failed'">
              ({{ fmtDate(review.confirmation.at) }})
            </template>
          </span>
        </p>
        <div v-if="review.scheduled" class="dim-grid">
          <div
            v-for="d in review.dimensions"
            :key="d.dimension"
            class="dim review-dim"
            :class="{ due: d.dueNow }"
          >
            <span class="dim-icon">{{ DIM_META[d.dimension]?.icon }}</span>
            <span class="dim-name">
              {{ DIM_META[d.dimension]?.name ?? d.dimension }}
              <small class="muted">every {{ d.interval }}</small>
            </span>
            <span class="dim-status" :title="`Next review ${fmtDate(d.due)}`">{{ d.when }}</span>
          </div>
        </div>
        <p v-else class="muted review-note">
          No reviews scheduled yet — the clock starts on this word's next answer.
        </p>
        <p v-if="review.scheduled" class="muted review-note">
          A skill that isn't due yet is still practised when it comes up — being due only moves it
          to the front of the queue.
        </p>
      </section>

      <!-- What there is to say about the word itself (#586) — this modal is
           already the "everything about this word" surface, so the facts belong
           beside the mastery figures. Tapping a related word opens its card. -->
      <WordFacts :word-key="wordKey" navigable @open-word="emit('open-word', $event)" />

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
            <template v-if="detail.inBatch">
              Remove <strong>{{ headword }}</strong> from your current batch?
            </template>
            <!-- Reached from the slipped / at-risk cards, a word need not be in
                 a batch at all; saying "remove from your batch" would describe
                 something that isn't about to happen. -->
            <template v-else>
              Set <strong>{{ headword }}</strong> aside for later?
            </template>
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
.meaning-alt {
  font-size: 0.82rem;
  opacity: 0.8;
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
.recovery {
  display: grid;
  gap: 0.4rem;
  padding: 0.7rem 0.8rem;
  border-radius: 10px;
  border-left: 3px solid var(--bad, #ef4444);
  background: color-mix(in srgb, var(--bad, #ef4444) 9%, transparent);
}
.recovery.at-risk {
  border-left-color: var(--warn, #f59e0b);
  background: color-mix(in srgb, var(--warn, #f59e0b) 10%, transparent);
}
.recovery-head {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.recovery-badge {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  color: var(--bad, #ef4444);
}
.at-risk .recovery-badge {
  color: var(--warn, #f59e0b);
}
.recovery-move {
  font-size: 0.85rem;
  font-weight: 600;
}
.recovery-lead {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.recovery-steps {
  list-style: none;
  margin: 0.15rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}
.recovery-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.step-icon {
  flex-shrink: 0;
}
.step-name {
  flex: 1;
  min-width: 0;
  font-size: 0.86rem;
  display: grid;
}
.step-name small {
  font-size: 0.68rem;
  text-transform: lowercase;
}
.step-need {
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: right;
}
.recovery-note {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
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
.review {
  display: grid;
  gap: 0.4rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
}
.confirm-line {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
}
.confirm-badge {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  flex-shrink: 0;
}
.confirm-line.good .confirm-badge {
  color: var(--good, #22c55e);
}
.confirm-line.wait .confirm-badge {
  color: var(--warn, #f59e0b);
}
.confirm-line.bad .confirm-badge {
  color: var(--bad, #ef4444);
}
.confirm-text {
  flex: 1;
  min-width: 0;
  color: var(--muted);
}
.review-dim .dim-name {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.review-dim .dim-name small {
  font-size: 0.7rem;
}
.review-dim .dim-status {
  font-weight: 500;
  color: var(--muted);
}
/* Due is the one state worth colouring: it is what the next session acts on. */
.review-dim.due .dim-status {
  font-weight: 600;
  color: var(--warn, #f59e0b);
}
.review-note {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
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
