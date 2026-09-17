<script setup>
// A combined learned/mastered list, with the same word card as the Home screen.
// Searching broadens the list to the whole installed dictionary (gloss-only
// entries included); a local wishlist handles words absent from that corpus.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { state as progress, learnedWords, lost, atRisk } from '../stores/progress.js'
import { state as vocabState, wordsByKey } from '../stores/vocab.js'
import { stateOf } from '../stores/progress.js'
import { problemKeys, progressWordRow, searchProgressWords, sortProgressWords } from '../lib/progressWords.js'
import { addWishlistItem, buildWishlistIssueUrl, WISHLIST_LIMIT } from '../lib/wordWishlist.js'
import WordProgressModal from './WordProgressModal.vue'

const STORAGE_KEY = 'slovarchik:vocabulary-wishlist:v1'
const tab = ref('known')
const query = ref('')
const order = ref('status')
const visibleCount = ref(80)
const selectedWord = ref(null)
const wishlist = ref([])
const wishlistDetails = ref(null)
const online = ref(typeof navigator === 'undefined' || navigator.onLine)

const knownKeys = computed(() => learnedWords()) // mastered is already a subset
const problems = computed(() => problemKeys(lost.value, atRisk.value))
const problemSet = computed(() => new Set(problems.value))
const searching = computed(() => !!query.value.trim())
const searchKeys = computed(() => searchProgressWords(vocabState.words, query.value))

const rows = computed(() => {
  const keys = searching.value ? searchKeys.value : tab.value === 'problem' ? problems.value : knownKeys.value
  const now = Date.now()
  return sortProgressWords(keys.map((key) =>
    progressWordRow(key, wordsByKey.value.get(key), progress.records[key], stateOf(key), problemSet.value.has(key), now),
  ), order.value)
})
const visibleRows = computed(() => rows.value.slice(0, visibleCount.value))
watch([query, tab, order], () => (visibleCount.value = 80))

function sameRussian(a, b) {
  const clean = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
  return clean(a) === clean(b)
}

// A partial dictionary match does not prevent a request for the exact word
// typed, but a word already authored in the corpus should not be requested twice.
const requestableQuery = computed(() => {
  const q = query.value.trim()
  if (!q || q.length > 80 || !/\p{Script=Cyrillic}/u.test(q)) return ''
  return vocabState.words.some((w) => sameRussian(w.headword || w.ru || '', q)) ? '' : q
})

onMounted(() => {
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(saved)) {
      wishlist.value = saved.reduce((items, item) => addWishlistItem(items, item), [])
    }
  } catch { /* Browsing still works when storage is unavailable. */ }
})
onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})

function updateOnline() { online.value = navigator.onLine }

function persistWishlist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(wishlist.value)) } catch { /* Keep the current cart in memory. */ }
}

function addToWishlist(ru, en = '') {
  wishlist.value = addWishlistItem(wishlist.value, { ru, en })
  persistWishlist()
  if (wishlistDetails.value) wishlistDetails.value.open = true
}

function isWishlisted(ru) { return wishlist.value.some((item) => sameRussian(item.ru, ru)) }

function removeFromWishlist(ru) {
  wishlist.value = wishlist.value.filter((item) => item.ru !== ru)
  persistWishlist()
}

function checkout() {
  const url = buildWishlistIssueUrl(wishlist.value)
  if (url) window.open(url, '_blank', 'noopener')
}

function stateLabel(row) {
  if (!row.learnable) return 'Gloss only'
  return { mastered: 'Mastered', learned: 'Learned', learning: 'Learning', unknown: 'Not learned' }[row.state]
}

function seenLabel(lastAt) {
  return lastAt ? `Seen ${new Date(lastAt).toLocaleDateString()}` : 'Never seen'
}
</script>

<template>
  <div class="card explorer">
    <div class="explorer-head">
      <div>
        <h2>Your words</h2>
        <p class="muted">Learned and mastered words together. Search to inspect any word in the dictionary.</p>
      </div>
      <div class="explorer-tabs" aria-label="Word lists">
        <button :class="{ active: tab === 'known' }" :aria-pressed="tab === 'known'" @click="tab = 'known'; query = ''">
          Known ({{ knownKeys.length }})
        </button>
        <button :class="{ active: tab === 'problem' }" :aria-pressed="tab === 'problem'" @click="tab = 'problem'; query = ''">
          Problem words ({{ problems.length }})
        </button>
      </div>
    </div>

    <div class="explorer-controls">
      <label class="search-label">
        Search Russian or English
        <input v-model="query" type="search" placeholder="Find any word…" autocomplete="off" />
      </label>
      <label class="sort-label">
        Sort by
        <select v-model="order">
          <option value="status">Status</option>
          <option value="recent">Most recently seen</option>
          <option value="oldest">Least recently seen</option>
          <option value="most-incorrect">Most incorrect attempts</option>
          <option value="least-incorrect">Least incorrect attempts</option>
          <option value="cefr">CEFR level</option>
          <option value="english">English A–Z</option>
          <option value="russian">Russian А–Я</option>
        </select>
      </label>
    </div>

    <p v-if="searching && searchKeys.length === 100" class="muted result-note">Showing the first 100 matches. Narrow your search to see more.</p>
    <ul v-if="visibleRows.length" class="explorer-list">
      <li v-for="w in visibleRows" :key="w.key" class="explorer-item">
        <button v-if="w.learnable" class="explorer-row" @click="selectedWord = w.key">
          <span class="row-primary" :title="w.fullEn">
            <span class="word-ru" lang="ru">{{ w.ru }}</span>
            <span class="word-en muted">{{ w.en }}</span>
          </span>
          <span class="status-icon" :title="w.status.label" :aria-label="w.status.label">{{ w.status.icon }}</span>
          <span class="row-secondary muted">{{ stateLabel(w) }}<template v-if="w.cefr"> · {{ w.cefr }}</template> · {{ seenLabel(w.lastAt) }} · {{ w.incorrect }} incorrect</span>
        </button>
        <div v-else class="explorer-row">
          <span class="row-primary" :title="w.fullEn">
            <span class="word-ru" lang="ru">{{ w.ru }}</span>
            <span class="word-en muted">{{ w.en }}</span>
          </span>
          <span class="status-icon" title="New word" aria-label="New word">🌱</span>
          <span class="row-secondary muted">Gloss only · not in lessons</span>
        </div>
        <button v-if="searching && !w.learnable" class="wishlist-add" :disabled="isWishlisted(w.ru) || wishlist.length >= WISHLIST_LIMIT" @click="addToWishlist(w.ru, w.fullEn)">
          {{ isWishlisted(w.ru) ? '✓ Wishlisted' : '+ Wishlist' }}
        </button>
      </li>
    </ul>
    <p v-else class="muted empty-list">{{ searching ? 'No dictionary matches.' : tab === 'problem' ? 'No problem words.' : 'No learned words yet.' }}</p>
    <button v-if="rows.length > visibleCount" class="show-more" @click="visibleCount += 80">Show more ({{ rows.length - visibleCount }} remaining)</button>

    <button v-if="requestableQuery" class="request-word" :disabled="isWishlisted(requestableQuery) || wishlist.length >= WISHLIST_LIMIT" @click="addToWishlist(requestableQuery)">
      {{ isWishlisted(requestableQuery) ? '✓ On wishlist' : `+ Add “${requestableQuery}” to wishlist` }}
    </button>
    <details ref="wishlistDetails" class="wishlist">
      <summary>🛒 Wishlist ({{ wishlist.length }})</summary>
      <p class="muted">Request words to add to lessons. Checkout opens a prefilled GitHub issue for you to submit.</p>
      <ul v-if="wishlist.length">
        <li v-for="item in wishlist" :key="item.ru">
          <span lang="ru">{{ item.ru }}</span><span v-if="item.en" class="muted"> — {{ item.en }}</span>
          <button :aria-label="`Remove ${item.ru} from wishlist`" @click="removeFromWishlist(item.ru)">Remove</button>
        </li>
      </ul>
      <button class="checkout" :disabled="!wishlist.length || !online" @click="checkout">Checkout on GitHub</button>
      <span v-if="wishlist.length && !online" class="muted">Available when online.</span>
    </details>

    <WordProgressModal
      v-if="selectedWord"
      :word-key="selectedWord"
      @close="selectedWord = null"
      @left="selectedWord = null"
      @open-word="selectedWord = $event"
    />
  </div>
</template>

<style scoped>
.explorer { display: grid; gap: 0.8rem; min-width: 0; }
.explorer h2 { margin: 0 0 0.2rem; }
.explorer p { margin: 0; font-size: 0.85rem; }
.explorer-head { display: flex; align-items: start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.explorer-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.explorer-tabs button.active { border-color: var(--primary); }
.explorer-controls { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.explorer-controls label { display: grid; gap: 0.25rem; font-size: 0.8rem; color: var(--muted); }
.search-label { flex: 1 1 12rem; }
.sort-label { flex: 1 1 10rem; }
.explorer-controls input, .explorer-controls select { width: 100%; min-width: 0; font-size: 0.9rem; }
.explorer-list { list-style: none; padding: 0; margin: 0; display: grid; max-height: 24rem; overflow-y: auto; border-top: 1px solid var(--border); }
.explorer-item { display: flex; align-items: center; border-bottom: 1px solid var(--border); min-width: 0; }
.explorer-row { flex: 1; min-width: 0; text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.15rem 0.5rem; padding: 0.55rem 0.4rem; border: 0; background: transparent; color: var(--text); }
button.explorer-row { cursor: pointer; }
button.explorer-row:hover, button.explorer-row:focus-visible { background: var(--bg-soft); }
.row-primary { display: flex; align-items: baseline; gap: 0.4rem; min-width: 0; overflow: hidden; }
.row-secondary { grid-column: 1 / -1; font-size: 0.72rem; }
.status-icon { font-size: 1rem; }
.wishlist-add, .show-more, .request-word { font-size: 0.8rem; }
.wishlist-add { flex-shrink: 0; }
.empty-list { padding: 0.6rem 0; }
.show-more, .request-word { justify-self: start; }
.wishlist { border-top: 1px solid var(--border); padding-top: 0.7rem; font-size: 0.85rem; }
.wishlist summary { cursor: pointer; font-weight: 600; }
.wishlist p { margin: 0.5rem 0; }
.wishlist ul { list-style: none; padding: 0; margin: 0.4rem 0; display: grid; gap: 0.35rem; }
.wishlist li { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
.wishlist li button { margin-left: auto; font-size: 0.75rem; }
.checkout { margin: 0.3rem 0; }
@media (max-width: 430px) {
  .explorer-item { flex-wrap: wrap; }
  .wishlist-add { margin: 0 0.3rem 0.4rem auto; }
}
</style>
