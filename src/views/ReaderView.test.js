import { describe, expect, it, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import { setImmediate } from 'node:timers'
import { flushPromises, mount } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import { appearance, loadBookState, savePosition } from '../stores/reader.js'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: 'fable' } }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
const spoken = []
vi.mock('../lib/speech.js', () => ({
  speechSupported: () => true,
  speak: (text) => spoken.push(text),
  cancelSpeech: () => {},
}))

import ReaderView from './ReaderView.vue'

const pack = {
  schemaVersion: 1, id: 'fable', title: 'Fable', author: 'Author', shelf: 'Children’s',
  form: 'prose', packVersion: 1, translationVersion: 1,
  source: { editionId: 'source-1', url: 'https://example.org/source' },
  rights: { original: 'public domain', translation: 'original translation' },
  sentences: [
    { id: 'fable:01', paragraph: 'p1', ru: 'Зима пришла.', en: 'Winter came.' },
    { id: 'fable:02', paragraph: 'p1', ru: 'Снег идёт.', en: 'Snow is falling.' },
  ],
}

const settings = (wrapper, label) =>
  wrapper.findAll('.reader-appearance button').find((button) => button.attributes('aria-label') === label)

const words = [{
  key: 'зима=winter', ru: 'зима', headword: 'зима́', meaning: 'winter', pos: 'noun',
  gender: 'f', forms: { sg: { nom: 'зима́' } },
}]

/** Mount and let the IndexedDB reads settle — fake-indexeddb needs a macrotask. */
async function openReader() {
  const wrapper = mount(ReaderView)
  await settle()
  return wrapper
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    await flushPromises()
  }
}

/**
 * The page the learner reads.
 *
 * The view keeps a second, hidden copy of the page to measure candidate page
 * breaks against, so a bare `find` would as happily return the mirror's
 * buttons — which are inert, and do nothing when clicked.
 */
const page = (wrapper) => wrapper.find('article.reader-page')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  spoken.length = 0
  Object.assign(appearance, { theme: 'dark', typeface: 'serif', fontSize: 1, loaded: false })
  vocabState.words = words
  vocabState.status = 'ready'
  await idb.putBook({
    id: 'fable', packVersion: 1, translationVersion: 1,
    blob: new NodeBlob([JSON.stringify(pack)]),
  })
})

describe('ReaderView', () => {
  it('opens a downloaded book and makes its words tappable', async () => {
    const wrapper = await openReader()
    expect(wrapper.text()).toContain('Зима пришла')
    expect(page(wrapper).findAll('[data-reader-word]').length).toBeGreaterThan(2)
  })

  it('explains a tapped word, and offers to say it', async () => {
    const wrapper = await openReader()
    await page(wrapper).find('[data-reader-word="Зима"]').trigger('click')

    const popup = wrapper.find('[role="dialog"]')
    expect(popup.text()).toContain('зима́')
    expect(popup.text()).toContain('winter')
    await popup.find('.reader-say-word').trigger('click')
    expect(spoken).toEqual(['зима́'])
  })

  it('says so plainly when a word has no entry, rather than showing nothing', async () => {
    const wrapper = await openReader()
    await page(wrapper).find('[data-reader-word="пришла"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').text()).toContain('No dictionary entry')
  })

  it('reveals one translation at a time', async () => {
    const wrapper = await openReader()
    const reveals = page(wrapper).findAll('.reader-reveal')

    await reveals[0].trigger('click')
    expect(wrapper.text()).toContain('Winter came')

    await reveals[1].trigger('click')
    expect(wrapper.text()).toContain('Snow is falling')
    expect(wrapper.text()).not.toContain('Winter came')
  })

  it('saves a bookmark through the store, where a later visit can find it', async () => {
    const wrapper = await openReader()
    await page(wrapper).findAll('.reader-reveal')[0].trigger('click')
    const actions = page(wrapper).findAll('.reader-translation-actions button')
    await actions.find((button) => button.text() === 'Bookmark').trigger('click')
    await settle()

    expect(await loadBookState('fable')).toMatchObject({ bookmarks: ['fable:01'] })
    expect(wrapper.find('.reader-saved').text()).toContain('1')
  })

  it('opens where the reader left off, by sentence rather than by page number', async () => {
    await savePosition('fable', 'fable:02')
    const wrapper = await openReader()
    expect(page(wrapper).text()).toContain('Снег идёт')
    expect(page(wrapper).text()).not.toContain('Зима пришла')
  })

  it('draws a picture between the sentences, and takes it away again', async () => {
    const wrapper = await openReader()
    // Winter, from a sentence that says so — and one picture, not one each.
    expect(page(wrapper).findAll('.reader-illustration').map((node) => node.text())).toEqual(['❄️'])

    await settings(wrapper, 'Hide illustrations').trigger('click')
    await settle()
    expect(page(wrapper).findAll('.reader-illustration')).toHaveLength(0)

    await settings(wrapper, 'Show illustrations').trigger('click')
    await settle()
    expect(page(wrapper).findAll('.reader-illustration')).toHaveLength(1)
  })

  it('remembers that the illustrations were turned off', async () => {
    await idb.setMeta('reader:illustrations', false)
    const wrapper = await openReader()
    expect(page(wrapper).findAll('.reader-illustration')).toHaveLength(0)
    expect(settings(wrapper, 'Hide illustrations').attributes('aria-pressed')).toBe('true')
  })

  it('measures the page with the pictures it is about to draw', async () => {
    // The hidden mirror is what pagination trusts; a picture missing from it
    // would make every page one illustration too long.
    const wrapper = await openReader()
    expect(wrapper.find('.reader-measure').findAll('.reader-illustration').length)
      .toBe(page(wrapper).findAll('.reader-illustration').length)
  })

  it('dresses the page in the appearance the store loaded', async () => {
    await idb.setMeta('reader:theme', 'light')
    await idb.setMeta('reader:typeface', 'sans')
    const wrapper = await openReader()
    expect(wrapper.find('.reader').classes()).toEqual(
      expect.arrayContaining(['reader-light', 'reader-sans']),
    )
  })
})
