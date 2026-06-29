<script setup>
// The progress pill in the app header: live "words learned vs mastered" counts
// from the store. When a count goes up a heart particle whooshes in and the
// number pulses; when it drops a ghost particle floats away. Clicking opens the
// Progress screen.
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'

import { learnedCount, masteredCount, currentStreak } from '../stores/progress.js'

const router = useRouter()

const heart = ref(false)
const ghost = ref(false)
const pulse = ref(false)
let heartTimer, ghostTimer, pulseTimer

function celebrate() {
  heart.value = true
  pulse.value = true
  clearTimeout(heartTimer)
  clearTimeout(pulseTimer)
  heartTimer = setTimeout(() => (heart.value = false), 900)
  pulseTimer = setTimeout(() => (pulse.value = false), 600)
}

function mourn() {
  ghost.value = true
  clearTimeout(ghostTimer)
  ghostTimer = setTimeout(() => (ghost.value = false), 900)
}

function onChange(now, was) {
  if (now > was) celebrate()
  else if (now < was) mourn()
}

watch(learnedCount, onChange)
watch(masteredCount, onChange)

onBeforeUnmount(() => {
  clearTimeout(heartTimer)
  clearTimeout(ghostTimer)
  clearTimeout(pulseTimer)
})

function open() {
  router.push('/progress')
}
</script>

<template>
  <button class="pill-btn" :class="{ pulse }" :aria-label="`Your progress — ${currentStreak}-day streak`" @click="open">
    <span class="count streak" :class="{ lit: currentStreak > 0 }" :title="`${currentStreak}-day streak`">
      <span class="flame" aria-hidden="true">🔥</span>{{ currentStreak }}
    </span>
    <span class="count learn"><span class="dot" />{{ learnedCount }}</span>
    <span class="count master"><span class="dot" />{{ masteredCount }}</span>
    <span v-if="heart" class="particle heart" aria-hidden="true">💚</span>
    <span v-if="ghost" class="particle ghost" aria-hidden="true">👻</span>
  </button>
</template>

<style scoped>
.pill-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  font-weight: 600;
  overflow: visible;
}
.pill-btn.pulse {
  animation: pulse 0.6s ease-out;
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.count.streak {
  gap: 0.15rem;
}
.streak .flame {
  font-size: 0.95rem;
  filter: grayscale(1) opacity(0.5);
}
.streak.lit .flame {
  filter: none;
}
.streak:not(.lit) {
  opacity: 0.55;
}
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
}
.learn .dot {
  background: var(--good);
}
.master .dot {
  background: var(--gold);
}
.particle {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
  font-size: 1.1rem;
}
.particle.heart {
  animation: whoosh 0.9s ease-out forwards;
}
.particle.ghost {
  animation: float-away 0.9s ease-in forwards;
}
@keyframes pulse {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.18);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes whoosh {
  0% {
    transform: translate(-50%, 60px) scale(0.6);
    opacity: 0;
  }
  30% {
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.1);
    opacity: 0;
  }
}
@keyframes float-away {
  0% {
    transform: translate(-50%, -50%);
    opacity: 0.9;
  }
  100% {
    transform: translate(-50%, -36px);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pill-btn.pulse,
  .particle {
    animation: none;
  }
}
</style>
