<script setup>
// A lightweight confetti burst shown briefly when an answer is correct.
defineProps({ show: { type: Boolean, default: false } })

const COLORS = ['#4f7dff', '#2ecc71', '#ffd166', '#ff6b6b', '#c77dff', '#4fd1ff']

// Pre-compute pieces fanning out evenly in every direction.
const pieces = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2
  const dist = 80 + (i % 4) * 18
  return {
    background: COLORS[i % COLORS.length],
    '--dx': `${Math.round(Math.cos(angle) * dist)}px`,
    '--dy': `${Math.round(Math.sin(angle) * dist)}px`,
    '--rot': `${(i % 2 ? 1 : -1) * (160 + i * 22)}deg`,
    '--delay': `${(i % 5) * 25}ms`,
  }
})
</script>

<template>
  <div v-if="show" class="celebrate" aria-hidden="true">
    <span class="celebrate__ring"></span>
    <span v-for="(p, i) in pieces" :key="i" class="celebrate__bit" :style="p"></span>
  </div>
</template>

<style scoped>
.celebrate {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 5;
}

.celebrate__ring {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 3px solid var(--good);
  animation: ring 0.7s ease-out forwards;
}

.celebrate__bit {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  opacity: 0;
  animation: fly 0.85s ease-out forwards;
  animation-delay: var(--delay);
}

@keyframes ring {
  0% {
    transform: scale(0.2);
    opacity: 0.9;
  }
  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}

@keyframes fly {
  0% {
    transform: translate(0, 0) rotate(0);
    opacity: 1;
  }
  100% {
    transform: translate(var(--dx), var(--dy)) rotate(var(--rot));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .celebrate__bit,
  .celebrate__ring {
    animation: none;
    opacity: 0;
  }
}
</style>
