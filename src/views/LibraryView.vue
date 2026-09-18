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

async function remove(id) {
  try { await removeBook(id) } catch { /* The error is shown beside the library. */ }
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
      <details v-for="entry in shelf.books" :key="entry.id" class="library-book card" name="library-books">
        <summary class="library-book-summary">
          <span class="library-book-heading"><strong>{{ entry.title }}</strong><span class="muted">{{ entry.author }}</span></span>
          <span v-if="library.installed[entry.id]" class="library-installed">Offline</span>
        </summary>
        <div class="library-book-details">
          <p class="muted">{{ entry.summary }}</p>
          <div class="library-actions">
            <RouterLink v-if="library.installed[entry.id]" class="library-read" :to="`/reader/${entry.id}`">Read <span aria-hidden="true">→</span></RouterLink>
            <button v-if="!library.installed[entry.id] || library.installed[entry.id].packVersion !== entry.packVersion || library.installed[entry.id].translationVersion !== entry.translationVersion" :class="{ primary: !library.installed[entry.id] }" :disabled="!!library.busyId" @click="download(entry)">{{ library.busyId === entry.id ? 'Downloading…' : library.installed[entry.id] ? 'Update' : 'Download' }}</button>
            <button v-if="library.installed[entry.id]" :disabled="!!library.busyId" @click="remove(entry.id)">Remove download</button>
          </div>
          <details class="library-source"><summary>Source and rights</summary><p>{{ entry.source.editionId }} · <a :href="entry.source.url" target="_blank" rel="noopener noreferrer">Wikisource text and attribution</a></p><p>{{ entry.rights.original }} {{ entry.rights.transcription }} {{ entry.rights.translation }}</p></details>
        </div>
      </details>
    </section>
  </section>
</template>

<style scoped>
.library { display: grid; gap: 1rem; }
.library h1, .library h2, .library p { margin: 0; }
.library-shelf { display: grid; gap: .6rem; }
.library-shelf h2 { font-size: 1.1rem; }
.library-book { min-width: 0; padding: 0; overflow: hidden; }
.library-book-summary { display: flex; align-items: center; gap: .75rem; min-height: 4.5rem; padding: .8rem 1rem; list-style: none; cursor: pointer; }
.library-book-summary::-webkit-details-marker { display: none; }
.library-book-summary:hover { background: rgb(255 255 255 / 4%); }
.library-book-summary:focus-visible { outline: 2px solid var(--primary); outline-offset: -3px; }
.library-book-summary::after { content: ''; flex: none; width: .55rem; height: .55rem; margin: -.3rem .2rem 0 0; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform .15s ease; }
.library-book[open] .library-book-summary::after { transform: rotate(225deg); margin-top: .3rem; }
.library-book-heading { display: grid; flex: 1; gap: .1rem; min-width: 0; overflow-wrap: anywhere; }
.library-book-heading strong { font-size: 1.05rem; }
.library-book-heading .muted { font-size: .85rem; }
.library-installed { flex: none; color: var(--good); font-size: .75rem; }
.library-book-details { display: grid; gap: .85rem; min-width: 0; padding: 1rem; border-top: 1px solid var(--border); }
.library-source { min-width: 0; font-size: .78rem; overflow-wrap: anywhere; }
.library-source p { margin-top: .35rem; }
.library-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.library-actions button, .library-read { display: inline-flex; align-items: center; justify-content: center; min-height: 2.5rem; padding: .4rem .75rem; font-size: .85rem; }
.library-read { gap: .4rem; border: 1px solid var(--primary); border-radius: 10px; background: var(--primary); color: white; font-weight: 600; text-decoration: none; }
.library-read:hover { filter: brightness(1.15); }
</style>
