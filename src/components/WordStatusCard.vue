<script setup>
// One of the home screen's two status cards — at-risk or slipped words.
//
// The rows are the batch rows' equal: each opens the word's progress card, and
// each says on its face what dropped and what would put it back (the count on
// an unmet pip, the plan's sentence underneath). Both cards render from the same
// `buildStatusWordList` rows, so "at risk" and "slipped" differ in their copy
// and colour, not in how much they explain.
const props = defineProps({
  /** 'risk' | 'slipped' — decides the accent colour and the heading copy. */
  kind: { type: String, required: true },
  /** Rows from `buildStatusWordList` (lib/homeDashboard.js). */
  words: { type: Array, required: true },
})
defineEmits(['select'])

const COPY = {
  risk: { label: 'At risk', blurb: 'one wrong answer from slipping' },
  slipped: { label: 'Slipped', blurb: 'dropped below their best state' },
}

const copy = COPY[props.kind] ?? COPY.risk
</script>

<template>
  <div class="card status-card" :class="`${kind}-card`">
    <div class="status-header">
      <span class="status-label" :class="`${kind}-label`">{{ copy.label }}</span>
      <span class="muted status-count">
        {{ words.length }} word{{ words.length === 1 ? '' : 's' }} — {{ copy.blurb }}
      </span>
    </div>
    <div class="word-scroll">
      <div
        v-for="w in words"
        :key="w.key"
        class="word-row clickable"
        role="button"
        tabindex="0"
        @click="$emit('select', w.key)"
        @keydown.enter="$emit('select', w.key)"
        @keydown.space.prevent="$emit('select', w.key)"
      >
        <div class="row-main">
          <div class="word-label" :title="w.fullEn">
            <span class="word-ru">{{ w.ru }}</span>
            <span class="word-en muted">{{ w.en }}</span>
          </div>
          <div class="word-dims">
            <span
              v-for="d in w.dims"
              :key="d.name"
              class="dim-pip"
              :class="[
                d.met ? 'dim-met' : d.attempts > 0 ? 'dim-partial' : 'dim-empty',
                { 'dim-missing': d.need > 0, 'dim-risk': !d.need && d.atRisk },
              ]"
              :title="d.hint"
            >
              <span class="dim-glyph">{{ d.label }}</span>
              <!-- The badge carries the figure rather than a bare cross: "two
                   more correct answers" is actionable, "✕" is not. -->
              <span v-if="d.need > 0" class="dim-need">{{ d.need }}</span>
              <span v-else-if="d.atRisk" class="dim-need risk-need">!</span>
            </span>
          </div>
        </div>
        <p class="row-plan">{{ w.plan.headline }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The row scaffolding (.word-scroll, .word-row, .word-label, .dim-pip and the
   met/partial/empty opacities, .status-header, .status-label) is global — see
   src/style.css. Only what a status card does differently lives here. */
.status-card {
  display: grid;
  gap: 0.6rem;
}
.risk-card {
  border-left: 4px solid var(--warn, #f59e0b);
}
.slipped-card {
  border-left: 4px solid var(--bad, #ef4444);
}
.risk-label {
  color: var(--warn, #f59e0b);
}
.slipped-label {
  color: var(--bad, #ef4444);
}
.status-count {
  font-size: 0.82rem;
}
/* These rows are two lines tall — the pips, then the plan — so they need more
   room per row and more of the card to scroll through. */
.word-scroll {
  gap: 0.55rem;
  max-height: 15rem;
}
.word-row {
  display: grid;
  gap: 0.1rem;
}
.row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
/* The sentence is the point of the row, so it wraps rather than ellipsising —
   "Slipped from Mastered back to Learned — 2 corr…" is the half that matters
   cut off. */
.row-plan {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--muted);
}
/* The count badge sits in a pip's top-right corner, so the pips need a little
   more air between them here than in a batch row, which has no badges. */
.word-dims {
  gap: 0.35rem;
}
/* Keep the pip itself at full opacity so its badge stays crisp, and fade only
   the glyph behind it. */
.dim-missing,
.dim-risk {
  opacity: 1;
}
.dim-missing .dim-glyph {
  opacity: 0.4;
  filter: grayscale(0.5);
}
.dim-need {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  min-width: 0.85rem;
  height: 0.85rem;
  padding: 0 0.12rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: var(--bad, #ff5c5c);
  border-radius: 999px;
  box-shadow: 0 0 0 1.5px var(--card, #1d2745);
}
.risk-need {
  background: var(--warn, #f59e0b);
}
</style>
