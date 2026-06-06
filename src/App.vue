<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import RussianKeyboard from './components/RussianKeyboard.vue'
import ProgressPill from './components/ProgressPill.vue'
import ErrorToast from './components/ErrorToast.vue'

// The session runner carries its own header (close + progress bar), so the app
// chrome steps out of the way while a session is in progress.
const route = useRoute()
const showHeader = computed(() => route.name !== 'session')
</script>

<template>
  <header v-if="showHeader" class="app-header">
    <RouterLink to="/" class="logo" aria-label="Home — Slovarchik">
      Словарчик
    </RouterLink>
    <ProgressPill />
    <RouterLink to="/data" class="avatar" aria-label="Your data">🧑‍🚀</RouterLink>
  </header>

  <main>
    <RouterView />
  </main>

  <RussianKeyboard />
  <ErrorToast />
</template>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}
.logo {
  justify-self: start;
  font-size: 1.4rem;
  font-weight: 700;
  text-decoration: none;
  color: inherit;
}
.avatar {
  justify-self: end;
  font-size: 1.5rem;
  text-decoration: none;
  width: 2.4rem;
  height: 2.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-soft);
}
</style>
