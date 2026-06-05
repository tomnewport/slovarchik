// User preferences that aren't learning progress. Currently just the
// end-of-exercise feedback sounds (issue #111): which bright sound plays after
// a correct answer and which neutral sound plays after a slip, or 'off' for
// silence. Persisted in the IndexedDB `meta` store so the choice survives
// reloads and rides along with the same offline-first storage as everything
// else.
import { reactive } from 'vue'

import * as idb from '../lib/idb.js'
import { SUCCESS_SOUNDS, NEUTRAL_SOUNDS, playSound } from '../lib/feedbackSound.js'

const META_KEY = 'feedbackSounds'

/** Sentinel value meaning "no sound" for either feedback slot. */
export const OFF = 'off'

export const settings = reactive({
  successSound: SUCCESS_SOUNDS[0].id,
  errorSound: NEUTRAL_SOUNDS[0].id,
  loaded: false,
})

function valid(kind, id) {
  if (id === OFF) return true
  const list = kind === 'success' ? SUCCESS_SOUNDS : NEUTRAL_SOUNDS
  return list.some((s) => s.id === id)
}

// The slot played after a slip is the "neutral" kind throughout (the
// NEUTRAL_SOUNDS list); the UI labels it "with mistakes".

/** Load saved preferences (defaults stay in place when nothing is stored). */
export async function loadSettings() {
  if (settings.loaded) return settings
  const stored = (await idb.getMeta(META_KEY)) ?? {}
  if (valid('success', stored.successSound)) settings.successSound = stored.successSound
  if (valid('neutral', stored.errorSound)) settings.errorSound = stored.errorSound
  settings.loaded = true
  return settings
}

function persist() {
  return idb.setMeta(META_KEY, {
    successSound: settings.successSound,
    errorSound: settings.errorSound,
  })
}

/** Choose the sound played after a correct answer (or OFF to disable it). */
export async function setSuccessSound(id) {
  if (!valid('success', id)) return
  settings.successSound = id
  await persist()
}

/** Choose the sound played after a slip (or OFF to disable it). */
export async function setErrorSound(id) {
  if (!valid('neutral', id)) return
  settings.errorSound = id
  await persist()
}

/**
 * Play the configured feedback for an exercise result: the bright sound when
 * `correct`, the neutral one otherwise. Returns false (no-op) when that slot is
 * disabled or audio isn't available.
 */
export function playFeedback(correct) {
  const id = correct ? settings.successSound : settings.errorSound
  if (!id || id === OFF) return false
  return playSound(correct ? 'success' : 'neutral', id)
}
