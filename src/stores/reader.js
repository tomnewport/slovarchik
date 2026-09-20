// What the reader remembers between visits: where each book was left open, the
// sentences saved out of it, and how the page should look.
//
// This used to live in the view, as `idb.setMeta` calls scattered through
// ReaderView. That worked, but it meant nothing else in the app could see the
// data: removing a book left its bookmarks behind for ever, and nothing could
// be unit-tested without mounting a component. Reading state is app state, so
// it belongs in a store beside the others (#782 follow-up).
import { reactive } from 'vue'

import * as idb from '../lib/idb.js'
import { coalesce } from '../lib/coalesce.js'

/** Reading-size choices, smallest first; the index is what is stored. */
export const FONT_SIZES = Object.freeze(['Small', 'Default', 'Large', 'Extra large'])
export const THEMES = Object.freeze(['dark', 'light'])
export const TYPEFACES = Object.freeze(['serif', 'sans'])

const DEFAULTS = Object.freeze({ theme: 'dark', typeface: 'serif', fontSize: 1, illustrations: true })

/**
 * How the page looks. One setting for every book: a learner who has chosen
 * large serif type has chosen it for reading, not for one title.
 */
/** @type {{theme: string, typeface: string, fontSize: number, illustrations: boolean, loaded: boolean}} */
export const appearance = reactive({ ...DEFAULTS, loaded: false })

const positionKey = (bookId) => `reader:position:${bookId}`
const bookmarksKey = (bookId) => `reader:bookmarks:${bookId}`

/** Keep a stored value only when it is still one of the offered choices. */
function oneOf(choices, value, fallback) {
  return choices.includes(value) ? value : fallback
}

async function readAppearance() {
  const [theme, typeface, fontSize, illustrations] = await Promise.all([
    idb.getMeta('reader:theme'),
    idb.getMeta('reader:typeface'),
    idb.getMeta('reader:font-size'),
    idb.getMeta('reader:illustrations'),
  ])
  appearance.illustrations = typeof illustrations === 'boolean' ? illustrations : DEFAULTS.illustrations
  appearance.theme = oneOf(THEMES, theme, DEFAULTS.theme)
  appearance.typeface = oneOf(TYPEFACES, typeface, DEFAULTS.typeface)
  appearance.fontSize = Number.isInteger(fontSize) && fontSize >= 0 && fontSize < FONT_SIZES.length
    ? fontSize
    : DEFAULTS.fontSize
  appearance.loaded = true
  return appearance
}

/** Load the shared appearance settings once, however many callers ask. */
export const loadAppearance = coalesce(readAppearance)

export async function setTheme(value) {
  appearance.theme = oneOf(THEMES, value, appearance.theme)
  await idb.setMeta('reader:theme', appearance.theme)
}

export async function setTypeface(value) {
  appearance.typeface = oneOf(TYPEFACES, value, appearance.typeface)
  await idb.setMeta('reader:typeface', appearance.typeface)
}

/**
 * Turn the emoji illustrations on or off.
 *
 * On by default: a picture every few sentences is what the feature is for, and
 * a reader who would rather have the page bare finds the switch in the same
 * menu as the typeface.
 */
export async function setIllustrations(value) {
  appearance.illustrations = !!value
  await idb.setMeta('reader:illustrations', appearance.illustrations)
}

/** Step the reading size, clamped to the offered range. */
export async function stepFontSize(delta) {
  const next = Math.max(0, Math.min(FONT_SIZES.length - 1, appearance.fontSize + delta))
  if (next === appearance.fontSize) return appearance.fontSize
  appearance.fontSize = next
  await idb.setMeta('reader:font-size', next)
  return next
}

/**
 * Where a book was left and what was saved out of it.
 *
 * The position is a sentence id rather than a page number, so a change of
 * type size or window width cannot lose the learner's place (#755).
 * @param {string} bookId
 * @returns {Promise<{positionId: string|null, bookmarks: string[]}>}
 */
export async function loadBookState(bookId) {
  const [positionId, bookmarks] = await Promise.all([
    idb.getMeta(positionKey(bookId)),
    idb.getMeta(bookmarksKey(bookId)),
  ])
  return {
    positionId: typeof positionId === 'string' ? positionId : null,
    bookmarks: Array.isArray(bookmarks) ? bookmarks.filter((id) => typeof id === 'string') : [],
  }
}

/** Remember the first sentence of the page now open. */
export async function savePosition(bookId, sentenceId) {
  await idb.setMeta(positionKey(bookId), sentenceId)
}

/** Add or remove one bookmark, returning the list as it now stands. */
export async function toggleBookmark(bookId, bookmarks, sentenceId) {
  const next = bookmarks.includes(sentenceId)
    ? bookmarks.filter((saved) => saved !== sentenceId)
    : [...bookmarks, sentenceId]
  await idb.setMeta(bookmarksKey(bookId), next)
  return next
}

/**
 * Forget a book's place and bookmarks — called when its download is removed,
 * so deleting a book deletes what the reader knew about it rather than leaving
 * meta rows nothing will ever read again.
 */
export async function forgetBook(bookId) {
  await Promise.all([idb.deleteMeta(positionKey(bookId)), idb.deleteMeta(bookmarksKey(bookId))])
}
