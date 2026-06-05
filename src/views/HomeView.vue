<script setup>
// Home: the launchpad for every session type, plus the current learning /
// mastery batch status. The learning batch is chosen by the user (on first
// visit and after completing a batch); the mastery batch is auto-selected.
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { state as progress } from '../stores/progress.js'

const router = useRouter()

function startSession(type, size) {
  if (!progress.learning) {
    // Carry the session intent so batch selection continues into practice
    // rather than dropping the learner back on the home screen.
    const query = { level: 'learning', next: 'session', type }
    if (size) query.size = size
    router.push({ path: '/batch', query })
    return
  }
  router.push({ path: '/session', query: size ? { type, size } : { type } })
}

// Open-ended standalone drills (no progress tracking) — kept reachable as free
// practice alongside the tracked session flow.
const DRILLS = [
  { to: '/vocab', label: 'Vocabulary' },
  { to: '/declension', label: 'Nouns' },
  { to: '/adjectives', label: 'Adjectives' },
  { to: '/pronouns', label: 'Pronouns' },
  { to: '/verbs', label: 'Verbs' },
  { to: '/numbers', label: 'Numbers' },
  { to: '/phrases', label: 'Phrases' },
  { to: '/listening', label: 'Listening' },
  { to: '/speaking', label: 'Speaking' },
]

function openDrill(to) {
  router.push(to)
}


const learningBatch = computed(() => progress.learning)
const masteryBatch = computed(() => progress.mastery)

const FOCUSED = [
  { type: 'speaking', label: 'Speaking', icon: '🗣️' },
  { type: 'listening', label: 'Listening', icon: '🎧' },
  { type: 'words', label: 'Words', icon: '📚' },
  { type: 'phrases', label: 'Phrases', icon: '💬' },
  { type: 'grammar', label: 'Grammar', icon: '🧩' },
]
</script>

<template>
  <section class="grid" style="gap: 1.25rem">
    <!-- Current batches -->
    <div class="batches">
      <!-- Learning: prompt to choose when none is set; display-only when active -->
      <button
        v-if="!learningBatch"
        class="batch-card learn"
        @click="router.push({ path: '/batch', query: { level: 'learning' } })"
      >
        <span class="batch-kind">Learning</span>
        <span class="muted">Choose words to learn →</span>
      </button>
      <div v-else class="batch-card learn">
        <span class="batch-kind">Learning</span>
        <strong>{{ learningBatch.name }}</strong>
      </div>

      <!-- Mastery: display-only, auto-selected from learned words -->
      <div v-if="masteryBatch" class="batch-card master">
        <span class="batch-kind">Mastering</span>
        <strong>{{ masteryBatch.name }}</strong>
      </div>
    </div>

    <!-- Standard session: Quick / Normal / Super -->
    <div class="card standard">
      <h2>Practice</h2>
      <p class="muted">A balanced mix — half new words, half reinforcement.</p>
      <div class="row sizes">
        <button class="primary size quick" @click="startSession('standard', 'quick')">
          Quick<small>4</small>
        </button>
        <button class="primary size normal" @click="startSession('standard', 'normal')">
          Normal<small>12</small>
        </button>
        <button class="primary size super" @click="startSession('standard', 'super')">
          Super<small>20</small>
        </button>
      </div>
    </div>

    <!-- Focused sessions -->
    <div class="row focused">
      <button
        v-for="f in FOCUSED"
        :key="f.type"
        class="focus-btn"
        @click="startSession(f.type)"
      >
        <span class="icon">{{ f.icon }}</span>{{ f.label }}
      </button>
    </div>

    <!-- Open-ended free-practice drills -->
    <details class="free">
      <summary>Free practice</summary>
      <p class="muted">Open-ended drills — these don't track progress.</p>
      <div class="row links">
        <button v-for="d in DRILLS" :key="d.to" class="pill drill" @click="openDrill(d.to)">
          {{ d.label }}
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.batches {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.batch-card {
  display: grid;
  gap: 0.2rem;
  text-align: left;
  padding: 0.9rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--card);
}
.batch-card.learn {
  border-left: 4px solid var(--good);
}
.batch-card.master {
  border-left: 4px solid var(--gold);
}
.batch-kind {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.batch-card strong {
  font-size: 1.1rem;
}
.standard h2 {
  margin: 0 0 0.25rem;
}
.sizes {
  margin-top: 0.75rem;
}
.size {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.9rem 0.5rem;
}
.size small {
  opacity: 0.8;
  font-weight: 400;
}
.focused {
  gap: 0.5rem;
}
.focus-btn {
  flex: 1 1 6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
}
.icon {
  font-size: 1.3rem;
}
.free summary {
  cursor: pointer;
  color: var(--muted);
}
.free .links {
  margin-top: 0.5rem;
  gap: 0.4rem;
}
.drill {
  cursor: pointer;
  background: var(--bg-soft);
  color: var(--text);
}
</style>
