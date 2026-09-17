<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import * as idb from '../lib/idb.js'
import { pageEnd, pageParagraphs, pageStart } from '../lib/readerPage.js'
import { previewBook } from '../lib/readerPreview.js'

const book = ref(previewBook)
const start = ref(0)
const end = ref(0)
const theme = ref('dark')
const typeface = ref('serif')
const readingPage = ref(null)
const measuringPage = ref(null)
const visibleParagraphs = computed(() => pageParagraphs(book.value.sentences.slice(start.value, end.value)))
const progress = computed(() => Math.round(100 * end.value / book.value.sentences.length))
let observer
let resizeFrame

function fits(from, to) {
  const node = measuringPage.value
  if (!node) return false
  node.replaceChildren()
  for (const group of pageParagraphs(book.value.sentences.slice(from, to))) {
    const paragraph = document.createElement('p')
    paragraph.className = 'reader-paragraph'
    for (const sentence of group.sentences) paragraph.append(document.createTextNode(`${sentence.ru} `))
    node.append(paragraph)
  }
  return node.scrollHeight <= node.clientHeight
}

function layout() {
  if (!measuringPage.value || !book.value.sentences.length) return
  end.value = pageEnd(book.value.sentences.length, start.value, fits)
}

function scheduleLayout() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(layout)
}

async function move(to) {
  start.value = to
  await idb.setMeta(`reader:position:${book.value.id}`, book.value.sentences[to].id)
  layout()
  readingPage.value?.scrollTo(0, 0)
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
  const [saved, savedTheme, savedTypeface] = await Promise.all([
    idb.getMeta(`reader:position:${book.value.id}`),
    idb.getMeta('reader:theme'),
    idb.getMeta('reader:typeface'),
  ])
  const index = book.value.sentences.findIndex((sentence) => sentence.id === saved)
  start.value = Math.max(0, index)
  if (['light', 'dark'].includes(savedTheme)) theme.value = savedTheme
  if (['serif', 'sans'].includes(savedTypeface)) typeface.value = savedTypeface
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
  <section class="reader" :class="[`reader-${theme}`, `reader-${typeface}`]">
    <div class="reader-top">
      <RouterLink to="/" class="reader-back" aria-label="Back to home">←</RouterLink>
      <div class="reader-title"><strong>{{ book.title }}</strong><small>{{ book.author }}</small></div>
      <div class="reader-options" aria-label="Reading appearance">
        <button :aria-pressed="theme === 'dark'" aria-label="Dark mode" @click="chooseTheme('dark')">☾</button>
        <button :aria-pressed="theme === 'light'" aria-label="Light mode" @click="chooseTheme('light')">☀</button>
        <button :aria-pressed="typeface === 'serif'" aria-label="Serif type" @click="chooseTypeface('serif')">Aa</button>
        <button :aria-pressed="typeface === 'sans'" aria-label="Sans serif type" @click="chooseTypeface('sans')">A</button>
      </div>
    </div>

    <div class="reader-body">
      <article ref="readingPage" class="reader-page" aria-label="Russian text">
        <p v-for="paragraph in visibleParagraphs" :key="paragraph.id" class="reader-paragraph">
          <span v-for="sentence in paragraph.sentences" :key="sentence.id">{{ sentence.ru }} </span>
        </p>
      </article>
      <div ref="measuringPage" class="reader-page reader-measure" aria-hidden="true" />
    </div>

    <nav class="reader-bottom" aria-label="Reading pages">
      <button :disabled="start === 0" aria-label="Previous page" @click="previous">←</button>
      <span role="status">{{ progress }}% · {{ Math.min(start + 1, book.sentences.length) }} / {{ book.sentences.length }}</span>
      <button :disabled="end >= book.sentences.length" aria-label="Next page" @click="next">→</button>
    </nav>
  </section>
</template>

<style>
.reader { --paper: #111723; --ink: #e9e5dd; --subtle: #a9a9a7; --rule: #39414d; display: flex; flex-direction: column; height: 100dvh; min-height: 22rem; margin: -1.5rem -1rem 0; padding: 0 1rem; background: var(--paper); color: var(--ink); }
.reader-light { --paper: #f9f5eb; --ink: #272a2b; --subtle: #626466; --rule: #d7d0c3; }
.reader-sans { font-family: system-ui, sans-serif; }
.reader-serif { font-family: Georgia, 'Times New Roman', serif; }
.reader-top { display: flex; align-items: center; gap: .7rem; min-height: 4rem; border-bottom: 1px solid var(--rule); font-family: system-ui, sans-serif; }
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
.reader-bottom { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 3.5rem; border-top: 1px solid var(--rule); color: var(--subtle); font: .82rem system-ui, sans-serif; }
.reader-bottom button { font-size: 1.5rem; min-width: 3rem; }
@media (max-width: 540px) { .reader-top { gap: .3rem; } .reader-options { max-width: 6.6rem; } .reader-page { padding: 1.2rem .3rem; } }
</style>
