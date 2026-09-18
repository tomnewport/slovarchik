<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import * as idb from '../lib/idb.js'
import { pageEnd, pageParagraphs, pageStart } from '../lib/readerPage.js'
import { lookupReaderWord, readerTokens } from '../lib/readerDictionary.js'
import { formIndex, wordsByKey, state as vocabState } from '../stores/vocab.js'
import { loadBook } from '../stores/library.js'
import { translationIssueUrl } from '../lib/readerReport.js'

const route = useRoute()
const book = ref(null)
const loadError = ref(null)
const loading = ref(true)
const start = ref(0)
const end = ref(0)
const revealedId = ref(null)
const bookmarks = ref([])
const showingBookmarks = ref(false)
const openedWord = ref(null)
const theme = ref('dark')
const typeface = ref('serif')
const readingPage = ref(null)
const measuringPage = ref(null)
const visibleParagraphs = computed(() => pageParagraphs(book.value.sentences.slice(start.value, end.value)))
const progress = computed(() => Math.round(100 * end.value / book.value.sentences.length))
const savedSentences = computed(() => book.value.sentences.filter((sentence) => bookmarks.value.includes(sentence.id)))
const definitions = computed(() => openedWord.value
  ? lookupReaderWord(openedWord.value, formIndex.value, wordsByKey.value)
  : [])
let observer
let resizeFrame
let swipeStart = null
let suppressRevealClick = false

function fits(from, to) {
  const node = measuringPage.value
  if (!node) return false
  node.replaceChildren()
  for (const group of pageParagraphs(book.value.sentences.slice(from, to))) {
    const paragraph = document.createElement('p')
    paragraph.className = `reader-paragraph${book.value.form === 'verse' ? ' reader-verse' : ''}`
    for (const sentence of group.sentences) {
      const line = document.createElement('span')
      line.className = 'reader-sentence'
      for (const token of readerTokens(sentence.ru)) {
        const span = document.createElement('span')
        if (token.word) span.className = 'reader-word'
        span.textContent = token.text
        line.append(span)
      }
      const action = document.createElement('button')
      action.className = 'reader-reveal'
      action.tabIndex = -1
      action.textContent = '↔'
      line.append(action)
      if (revealedId.value === sentence.id && sentence.en) {
        const translation = document.createElement('span')
        translation.className = 'reader-translation'
        translation.lang = 'en'
        translation.textContent = sentence.en
        const actions = document.createElement('span')
        actions.className = 'reader-translation-actions'
        const bookmark = document.createElement('button')
        bookmark.textContent = bookmarks.value.includes(sentence.id) ? 'Bookmarked' : 'Bookmark'
        bookmark.tabIndex = -1
        actions.append(bookmark)
        const query = document.createElement('a')
        query.textContent = ' · Query translation'
        actions.append(query)
        translation.append(actions)
        line.append(translation)
      }
      paragraph.append(line)
      paragraph.append(document.createTextNode(' '))
    }
    node.append(paragraph)
  }
  return node.scrollHeight <= node.clientHeight
}

function layout() {
  if (!measuringPage.value || !book.value.sentences.length) return
  end.value = pageEnd(book.value.sentences.length, start.value, fits)
  // Leave the mirror on the chosen page so browser tests can catch height drift.
  fits(start.value, end.value)
}

function scheduleLayout() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(layout)
}

async function move(to) {
  start.value = to
  openedWord.value = null
  await idb.setMeta(`reader:position:${book.value.id}`, book.value.sentences[to].id)
  layout()
  readingPage.value?.scrollTo(0, 0)
}

async function reveal(sentence) {
  openedWord.value = null
  revealedId.value = revealedId.value === sentence.id ? null : sentence.id
  await nextTick()
  layout()
  const index = book.value.sentences.findIndex((item) => item.id === sentence.id)
  if (revealedId.value && index >= end.value) await move(index)
}

function pointerDown(event) {
  swipeStart = { x: event.clientX, y: event.clientY }
}

function pointerUp(event, sentence) {
  if (!swipeStart) return
  const dx = event.clientX - swipeStart.x
  const dy = event.clientY - swipeStart.y
  swipeStart = null
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    suppressRevealClick = true
    void reveal(sentence)
    setTimeout(() => { suppressRevealClick = false }, 0)
  }
}

function clickReveal(sentence) {
  if (!suppressRevealClick) void reveal(sentence)
}

function openWord(surface) {
  if (suppressRevealClick) return
  openedWord.value = openedWord.value === surface ? null : surface
}

function clickSentence(event) {
  if (!(event.target instanceof Element)) return
  const word = event.target.closest('[data-reader-word]')
  if (word && event.currentTarget.contains(word)) openWord(word.dataset.readerWord)
}

async function toggleBookmark(sentence) {
  const id = sentence.id
  bookmarks.value = bookmarks.value.includes(id)
    ? bookmarks.value.filter((saved) => saved !== id)
    : [...bookmarks.value, id]
  await idb.setMeta(`reader:bookmarks:${book.value.id}`, bookmarks.value)
}

async function visitBookmark(sentence) {
  showingBookmarks.value = false
  const index = book.value.sentences.findIndex((item) => item.id === sentence.id)
  if (index < 0) return
  revealedId.value = sentence.id
  await nextTick()
  await move(index)
}

function next() {
  if (end.value < book.value.sentences.length) void move(end.value)
}

function previous() {
  if (start.value > 0) void move(pageStart(start.value, fits))
}

async function chooseTheme(value) {
  theme.value = value
  await idb.setMeta('reader:theme', value)
}

async function chooseTypeface(value) {
  typeface.value = value
  await idb.setMeta('reader:typeface', value)
  await nextTick()
  layout()
}

function handleKey(event) {
  if (event.target instanceof HTMLElement && event.target.closest('button, a, input')) return
  if (event.key === 'ArrowRight') next()
  if (event.key === 'ArrowLeft') previous()
}

onMounted(async () => {
  try { book.value = await loadBook(String(route.params.bookId)) }
  catch (error) { loadError.value = error.message }
  loading.value = false
  if (!book.value) return
  const [saved, savedTheme, savedTypeface, savedBookmarks] = await Promise.all([
    idb.getMeta(`reader:position:${book.value.id}`),
    idb.getMeta('reader:theme'),
    idb.getMeta('reader:typeface'),
    idb.getMeta(`reader:bookmarks:${book.value.id}`),
  ])
  const index = book.value.sentences.findIndex((sentence) => sentence.id === saved)
  start.value = Math.max(0, index)
  if (['light', 'dark'].includes(savedTheme)) theme.value = savedTheme
  if (['serif', 'sans'].includes(savedTypeface)) typeface.value = savedTypeface
  if (Array.isArray(savedBookmarks)) bookmarks.value = savedBookmarks.filter((id) => typeof id === 'string')
  await nextTick()
  layout()
  observer = new ResizeObserver(scheduleLayout)
  observer.observe(readingPage.value)
  window.addEventListener('keydown', handleKey)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  window.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <section v-if="!book" class="card"><p>{{ loading ? 'Opening book…' : loadError || 'This book is not downloaded.' }}</p><RouterLink to="/library">Back to library</RouterLink></section>
  <section v-else class="reader" :class="[`reader-${theme}`, `reader-${typeface}`]">
    <div class="reader-top">
      <RouterLink to="/library" class="reader-back" aria-label="Back to library">←</RouterLink>
      <div class="reader-title"><strong>{{ book.title }}</strong><small>{{ book.author }}</small></div>
      <button class="reader-saved" :aria-expanded="showingBookmarks" @click="showingBookmarks = !showingBookmarks">⌑ {{ bookmarks.length }}</button>
      <div class="reader-options" aria-label="Reading appearance">
        <button :aria-pressed="theme === 'dark'" aria-label="Dark mode" @click="chooseTheme('dark')">☾</button>
        <button :aria-pressed="theme === 'light'" aria-label="Light mode" @click="chooseTheme('light')">☀</button>
        <button :aria-pressed="typeface === 'serif'" aria-label="Serif type" @click="chooseTypeface('serif')">Aa</button>
        <button :aria-pressed="typeface === 'sans'" aria-label="Sans serif type" @click="chooseTypeface('sans')">A</button>
      </div>
    </div>

    <div v-if="showingBookmarks" class="reader-bookmarks" aria-label="Bookmarked sentences">
      <strong>Bookmarks</strong>
      <p v-if="!savedSentences.length">No sentences bookmarked yet.</p>
      <button v-for="sentence in savedSentences" :key="sentence.id" @click="visitBookmark(sentence)">{{ sentence.ru }}</button>
    </div>

    <div class="reader-body">
      <article ref="readingPage" class="reader-page" aria-label="Russian text">
        <p v-for="paragraph in visibleParagraphs" :key="paragraph.id" class="reader-paragraph" :class="{ 'reader-verse': book.form === 'verse' }">
          <span v-for="sentence in paragraph.sentences" :key="sentence.id" class="reader-sentence" @pointerdown="pointerDown" @pointerup="pointerUp($event, sentence)" @pointercancel="swipeStart = null" @click="clickSentence">
            <span v-for="(token, tokenIndex) in readerTokens(sentence.ru)" :key="tokenIndex" :class="{ 'reader-word': token.word }" :data-reader-word="token.word ? token.text : null">{{ token.text }}</span><button class="reader-reveal" :aria-label="revealedId === sentence.id ? 'Hide translation' : `Reveal translation for ${sentence.ru}`" :aria-expanded="revealedId === sentence.id" @click="clickReveal(sentence)">↔</button>
            <span v-if="revealedId === sentence.id && sentence.en" class="reader-translation" lang="en">
              {{ sentence.en }}
              <span class="reader-translation-actions"><button :aria-pressed="bookmarks.includes(sentence.id)" @click="toggleBookmark(sentence)">{{ bookmarks.includes(sentence.id) ? 'Bookmarked' : 'Bookmark' }}</button> · <a :href="translationIssueUrl(book, sentence.id)" target="_blank" rel="noopener noreferrer">Query translation</a></span>
            </span>
          </span>{{ ' ' }}
        </p>
      </article>
      <div ref="measuringPage" class="reader-page reader-measure" aria-hidden="true" />
      <aside v-if="openedWord" class="reader-dictionary" role="dialog" :aria-label="`Dictionary: ${openedWord}`">
        <button class="reader-dictionary-close" aria-label="Close dictionary" @click="openedWord = null">×</button>
        <strong>{{ openedWord }}</strong>
        <p v-if="vocabState.status === 'loading' && !vocabState.words.length">Loading dictionary…</p>
        <p v-else-if="!definitions.length">No dictionary entry for this form.</p>
        <ul v-else><li v-for="entry in definitions" :key="entry.key"><strong>{{ entry.lemma }}</strong> <small>{{ entry.pos }}</small><br>{{ entry.meaning }}<small v-if="entry.morphology.length" class="reader-morph">{{ entry.morphology.join(' · ') }}</small><small v-for="note in entry.notes" :key="note" class="reader-morph">{{ note }}</small></li></ul>
      </aside>
    </div>

    <nav class="reader-bottom" aria-label="Reading pages">
      <button :disabled="start === 0" aria-label="Previous page" @click="previous">←</button>
      <span role="status">{{ progress }}% · {{ Math.min(start + 1, book.sentences.length) }} / {{ book.sentences.length }}</span>
      <button :disabled="end >= book.sentences.length" aria-label="Next page" @click="next">→</button>
    </nav>
  </section>
</template>

<style>
.reader { --paper: #111723; --ink: #e9e5dd; --subtle: #a9a9a7; --rule: #39414d; position: relative; display: flex; flex-direction: column; height: 100dvh; min-height: 22rem; margin: -1.5rem -1rem 0; padding: 0 1rem; background: var(--paper); color: var(--ink); }
.reader-light { --paper: #f9f5eb; --ink: #272a2b; --subtle: #626466; --rule: #d7d0c3; }
.reader-sans { font-family: system-ui, sans-serif; }
.reader-serif { font-family: Georgia, 'Times New Roman', serif; }
.reader-top { display: flex; align-items: center; gap: .7rem; min-height: 4rem; border-bottom: 1px solid var(--rule); font-family: system-ui, sans-serif; }
.reader-saved { white-space: nowrap; font-size: .8rem; }
.reader-bookmarks { position: absolute; z-index: 2; top: 4rem; left: 1rem; right: 1rem; max-height: 60dvh; overflow: auto; padding: 1rem; background: var(--paper); border: 1px solid var(--rule); box-shadow: 0 .6rem 1.5rem #0004; font: .9rem system-ui, sans-serif; }
.reader-bookmarks button { display: block; width: 100%; text-align: left; border-bottom: 1px solid var(--rule); }
.reader-back { color: var(--ink); font-size: 1.4rem; text-decoration: none; }
.reader-title { display: flex; flex: 1; min-width: 0; flex-direction: column; text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .85rem; }
.reader-title small { color: var(--subtle); }
.reader-options { display: flex; flex-wrap: wrap; justify-content: end; max-width: 10rem; gap: .1rem; }
.reader button { border: 0; padding: .4rem; background: transparent; color: var(--ink); }
.reader button[aria-pressed='true'] { color: var(--ink); text-decoration: underline; text-underline-offset: .3rem; }
.reader button:hover:not(:disabled), .reader a:hover { color: var(--subtle); }
.reader-body { position: relative; flex: 1; min-height: 0; }
.reader-page { position: absolute; inset: 0; overflow: auto; padding: 1.8rem clamp(.2rem, 4vw, 2rem); font-size: clamp(1.2rem, 3.4vw, 1.55rem); line-height: 1.75; overflow-wrap: break-word; }
.reader-measure { visibility: hidden; pointer-events: none; overflow: hidden; }
.reader-paragraph { margin: 0 0 1em; text-indent: 1.2em; }
.reader-sentence { touch-action: pan-y; }
.reader-verse { text-indent: 0; }
.reader-verse .reader-sentence { display: block; white-space: pre-line; }
.reader-reveal { font: .65em system-ui, sans-serif; margin: 0 .12em; vertical-align: baseline; opacity: .5; }
.reader button.reader-reveal { padding: 0 .12em; }
.reader-word { cursor: pointer; }
.reader-word:hover { text-decoration: underline; text-underline-offset: .15em; }
.reader-dictionary { position: absolute; z-index: 1; bottom: 1rem; left: 1rem; right: 1rem; max-width: 28rem; max-height: 50%; overflow: auto; padding: .75rem 1rem; border: 1px solid var(--rule); border-radius: .6rem; background: var(--paper); box-shadow: 0 .4rem 1.5rem #0005; font: .9rem/1.4 system-ui, sans-serif; }
.reader-dictionary p { margin: .5rem 0 0; }
.reader-dictionary ul { margin: .5rem 0 0; padding: 0; list-style: none; }
.reader-dictionary li + li { margin-top: .55rem; padding-top: .55rem; border-top: 1px solid var(--rule); }
.reader-dictionary small { color: var(--subtle); }
.reader-morph { display: block; margin-top: .15rem; }
.reader-dictionary-close { float: right; font-size: 1.3rem; }
.reader-translation { display: block; margin: .25em 0 .7em; padding-left: 1.2em; color: var(--subtle); font: .73em/1.5 Georgia, 'Times New Roman', serif; text-indent: 0; }
.reader-translation-actions { display: block; margin-top: .25em; font: .7rem system-ui, sans-serif; }
.reader-translation-actions button { padding: 0; font-size: inherit; color: var(--subtle); }
.reader-translation-actions a { color: var(--subtle); }
.reader-bottom { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 3.5rem; border-top: 1px solid var(--rule); color: var(--subtle); font: .82rem system-ui, sans-serif; }
.reader-bottom button { font-size: 1.5rem; min-width: 3rem; }
@media (max-width: 540px) { .reader-top { gap: .3rem; } .reader-options { max-width: 6.6rem; } .reader-page { padding: 1.2rem .3rem; } }
</style>
