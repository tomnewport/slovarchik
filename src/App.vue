<script setup>
import { RouterLink, RouterView } from 'vue-router'
import RussianKeyboard from './components/RussianKeyboard.vue'
</script>

<template>
  <header class="row" style="justify-content: space-between; margin-bottom: 1.5rem">
    <RouterLink to="/" style="text-decoration: none; color: inherit">
      <h1 style="margin: 0; font-size: 1.6rem">
        Словарчик <span class="muted" style="font-size: 1rem">· Slovarchik</span>
      </h1>
    </RouterLink>
    <nav class="row">
      <RouterLink to="/vocab">Vocab</RouterLink>
      <RouterLink to="/declension">Declension</RouterLink>
      <RouterLink to="/phrases">Phrases</RouterLink>
      <RouterLink to="/listening">Listening</RouterLink>
    </nav>
  </header>

  <main>
    <RouterView />
  </main>

  <footer class="muted" style="margin-top: 3rem; font-size: 0.85rem; text-align: center">
    Works offline · installable · no tracking, no backend.
  </footer>

  <RussianKeyboard />
</template>
