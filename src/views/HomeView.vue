<script setup>
// Home: the launchpad for every session type, plus the current learning /
// mastery batch status (with prompts to choose a batch when none is set).
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { state as progress, learnedCount } from '../stores/progress.js'
import { MASTERY_UNLOCK_AT } from '../lib/batches.js'

const router = useRouter()

function startSession(type, size) {
  router.push({ path: '/session', query: size ? { type, size } : { type } })
}

function chooseBatch(level) {
  router.push({ path: '/batch', query: { level } })
}

const learningBatch = computed(() => progress.learning)
const masteryBatch = computed(() => progress.mastery)
const masteryUnlocked = computed(() => learnedCount.value >= MASTERY_UNLOCK_AT)

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
      <button
        class="batch-card learn"
        :class="{ empty: !learningBatch }"
        @click="chooseBatch('learning')"
      >
        <span class="batch-kind">Learning</span>
        <strong v-if="learningBatch">{{ learningBatch.name }}</strong>
        <span v-else class="muted">Choose words to learn →</span>
      </button>

      <button
        v-if="masteryUnlocked || masteryBatch"
        class="batch-card master"
        :class="{ empty: !masteryBatch }"
        @click="chooseBatch('mastery')"
      >
        <span class="batch-kind">Mastering</span>
        <strong v-if="masteryBatch">{{ masteryBatch.name }}</strong>
        <span v-else class="muted">Choose words to master →</span>
      </button>
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
</style>
