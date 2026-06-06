import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Mock just the audio playback so we can assert routing without a real
// AudioContext; the real preset arrays are kept.
vi.mock('../lib/feedbackSound.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, playSound: vi.fn(() => true) }
})

import * as idb from '../lib/idb.js'
import { SUCCESS_SOUNDS, NEUTRAL_SOUNDS, CELEBRATION_SOUNDS, playSound } from '../lib/feedbackSound.js'
import {
  settings,
  loadSettings,
  setSuccessSound,
  setErrorSound,
  setCelebrationSound,
  playFeedback,
  playCelebration,
  OFF,
} from './settings.js'

beforeEach(() => {
  // Fresh database + reset the in-memory store between tests.
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  settings.successSound = SUCCESS_SOUNDS[0].id
  settings.errorSound = NEUTRAL_SOUNDS[0].id
  settings.celebrationSound = CELEBRATION_SOUNDS[0].id
  settings.loaded = false
  playSound.mockClear()
})

describe('settings store', () => {
  it('defaults to the first sound of each kind', async () => {
    await loadSettings()
    expect(settings.successSound).toBe(SUCCESS_SOUNDS[0].id)
    expect(settings.errorSound).toBe(NEUTRAL_SOUNDS[0].id)
    expect(settings.celebrationSound).toBe(CELEBRATION_SOUNDS[0].id)
  })

  it('persists choices across a reload', async () => {
    await loadSettings()
    await setSuccessSound('bell')
    await setErrorSound(OFF)
    await setCelebrationSound('jingle')

    // Simulate a fresh page load: reset the in-memory store, reload from idb.
    settings.loaded = false
    settings.successSound = SUCCESS_SOUNDS[0].id
    settings.errorSound = NEUTRAL_SOUNDS[0].id
    settings.celebrationSound = OFF
    await loadSettings()

    expect(settings.successSound).toBe('bell')
    expect(settings.errorSound).toBe(OFF)
    expect(settings.celebrationSound).toBe('jingle')
  })

  it('ignores unknown sound ids', async () => {
    await setSuccessSound('not-a-sound')
    expect(settings.successSound).toBe(SUCCESS_SOUNDS[0].id)
    await setCelebrationSound('not-a-sound')
    expect(settings.celebrationSound).toBe(CELEBRATION_SOUNDS[0].id)
  })

  it('plays the success sound on a correct result and the neutral one on a slip', () => {
    settings.successSound = 'bell'
    settings.errorSound = 'tap'

    playFeedback(true)
    expect(playSound).toHaveBeenLastCalledWith('success', 'bell')
    playFeedback(false)
    expect(playSound).toHaveBeenLastCalledWith('neutral', 'tap')
  })

  it('plays the configured celebration sound', () => {
    settings.celebrationSound = 'jingle'
    playCelebration()
    expect(playSound).toHaveBeenLastCalledWith('celebration', 'jingle')
  })

  it('stays silent when a slot is turned off', () => {
    settings.successSound = OFF
    expect(playFeedback(true)).toBe(false)
    expect(playSound).not.toHaveBeenCalled()

    settings.celebrationSound = OFF
    expect(playCelebration()).toBe(false)
    expect(playSound).not.toHaveBeenCalled()
  })
})
