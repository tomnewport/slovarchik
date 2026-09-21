import { describe, expect, it, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import {
  FONT_SIZES,
  appearance,
  loadAppearance,
  loadBookState,
  savePosition,
  setIllustrations,
  setTheme,
  setTypeface,
  stepFontSize,
  toggleBookmark,
  forgetBook,
} from './reader.js'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  Object.assign(appearance, { theme: 'dark', typeface: 'serif', fontSize: 1, illustrations: true, loaded: false })
})

describe('reading appearance', () => {
  it('starts on the defaults when nothing has been chosen', async () => {
    await loadAppearance()
    expect(appearance).toMatchObject({ theme: 'dark', typeface: 'serif', fontSize: 1 })
  })

  it('reads back what was chosen last time', async () => {
    await setTheme('light')
    await setTypeface('sans')
    await stepFontSize(2)
    Object.assign(appearance, { theme: 'dark', typeface: 'serif', fontSize: 1 })
  
    await loadAppearance()
    expect(appearance).toMatchObject({ theme: 'light', typeface: 'sans', fontSize: 3 })
  })

  it('ignores a stored value that is no longer one of the choices', async () => {
    await idb.setMeta('reader:theme', 'sepia')
    await idb.setMeta('reader:typeface', 'comic')
    await idb.setMeta('reader:font-size', 99)

    await loadAppearance()
    expect(appearance).toMatchObject({ theme: 'dark', typeface: 'serif', fontSize: 1 })
  })

  it('starts with illustrations on, and keeps them off once turned off', async () => {
    await loadAppearance()
    expect(appearance.illustrations).toBe(true)

    await setIllustrations(false)
    Object.assign(appearance, { illustrations: true })
    await loadAppearance()
    expect(appearance.illustrations).toBe(false)
  })

  it('will not step the size past either end', async () => {
    expect(await stepFontSize(-5)).toBe(0)
    expect(await stepFontSize(-1)).toBe(0)
    expect(await stepFontSize(FONT_SIZES.length)).toBe(FONT_SIZES.length - 1)
    expect(await stepFontSize(1)).toBe(FONT_SIZES.length - 1)
  })
})

describe('a book’s place and bookmarks', () => {
  it('has no place and no bookmarks in an unopened book', async () => {
    expect(await loadBookState('tolstoy-plum-stone')).toEqual({ positionId: null, bookmarks: [] })
  })

  it('keeps the place as a sentence id, not a page number', async () => {
    await savePosition('chekhov-fat-thin', 'chekhov-fat-thin:030')
    expect(await loadBookState('chekhov-fat-thin')).toMatchObject({ positionId: 'chekhov-fat-thin:030' })
  })

  it('adds and removes one bookmark at a time', async () => {
    const first = await toggleBookmark('krylov-dragonfly-ant', [], 'krylov-dragonfly-ant:02')
    expect(first).toEqual(['krylov-dragonfly-ant:02'])
    const second = await toggleBookmark('krylov-dragonfly-ant', first, 'krylov-dragonfly-ant:05')
    expect(second).toEqual(['krylov-dragonfly-ant:02', 'krylov-dragonfly-ant:05'])
    expect(await toggleBookmark('krylov-dragonfly-ant', second, 'krylov-dragonfly-ant:02'))
      .toEqual(['krylov-dragonfly-ant:05'])
    expect(await loadBookState('krylov-dragonfly-ant')).toMatchObject({ bookmarks: ['krylov-dragonfly-ant:05'] })
  })

  it('survives a damaged bookmark list rather than handing one to the reader', async () => {
    await idb.setMeta('reader:bookmarks:lenin', ['lenin:001', 42, null])
    await idb.setMeta('reader:position:lenin', 7)
    expect(await loadBookState('lenin')).toEqual({ positionId: null, bookmarks: ['lenin:001'] })
  })

  it('forgets a book entirely, leaving no rows behind', async () => {
    await savePosition('gone', 'gone:04')
    await toggleBookmark('gone', [], 'gone:04')

    await forgetBook('gone')

    expect(await loadBookState('gone')).toEqual({ positionId: null, bookmarks: [] })
    expect(await idb.getMeta('reader:position:gone')).toBeUndefined()
    expect(await idb.getMeta('reader:bookmarks:gone')).toBeUndefined()
  })
})
