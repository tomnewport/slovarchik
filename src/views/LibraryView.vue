<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { SHELVES } from '../lib/bookPack.js'
import { library, loadCatalog, downloadBook, removeBook } from '../stores/library.js'

const shelves = computed(() => SHELVES.map((name) => ({ name, books: library.books.filter((book) => book.shelf === name) })))
onMounted(() => { void loadCatalog() })

async function download(entry) {
  try { await downloadBook(entry) } catch { /* The error is shown beside the library. */ }
}
</script>

<template>
  <section class="library">
    <h1>Literature</h1>
    <p class="muted">Russian books to read at your own pace. Download a title once, then read it offline.</p>
    <p v-if="library.status === 'loading'">Opening library…</p>
    <p v-if="library.status === 'unavailable'" role="alert">The catalog is unavailable. Reconnect to see available titles.</p>
    <p v-if="library.error" role="alert">{{ library.error }}</p>
    <section v-for="shelf in shelves" :key="shelf.name" class="library-shelf">
      <h2>{{ shelf.name }}</h2>
      <p v-if="!shelf.books.length" class="muted">No titles on this shelf yet.</p>
      <div v-for="entry in shelf.books" :key="entry.id" class="library-book card">
        <div><strong>{{ entry.title }}</strong><span class="muted">{{ entry.author }}</span><small class="muted">{{ entry.summary }}</small></div>
        <div class="library-actions">
          <RouterLink v-if="library.installed[entry.id]" :to="`/reader/${entry.id}`">Read</RouterLink>
          <button v-if="!library.installed[entry.id] || library.installed[entry.id].packVersion !== entry.packVersion || library.installed[entry.id].translationVersion !== entry.translationVersion" :disabled="!!library.busyId" @click="download(entry)">{{ library.busyId === entry.id ? 'Downloading…' : library.installed[entry.id] ? 'Update' : 'Download' }}</button>
          <button v-if="library.installed[entry.id]" :disabled="!!library.busyId" @click="removeBook(entry.id)">Remove download</button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.library { display: grid; gap: 1rem; }
.library h1, .library h2, .library p { margin: 0; }
.library-shelf { display: grid; gap: .6rem; }
.library-shelf h2 { font-size: 1.1rem; }
.library-book { display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
.library-book > div:first-child { display: grid; }
.library-book small { margin-top: .3rem; }
.library-actions { display: flex; gap: .5rem; flex-wrap: wrap; justify-content: end; }
.library-actions a { align-self: center; }
.library-actions button { font-size: .85rem; padding: .4rem .6rem; }
@media (max-width: 540px) { .library-book { align-items: start; flex-direction: column; } }
</style>
