// Thin wrapper around the Web Speech API for reading Russian words and
// phrases aloud. Speech is a progressive enhancement: when the API is
// unavailable (older browsers, tests, SSR) every call is a safe no-op.

import { spellOutInitialisms } from './initialism.js'

export const SLOW_RATE = 0.5

export function speechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
}

// Pick the best installed voice for a BCP-47 tag (e.g. 'ru-RU' → any ru voice),
// preferring an exact match. Returns null when voices aren't enumerable yet
// (they load asynchronously) so the browser falls back to its default — which is
// why this is best-effort, not required.
function voiceFor(lang) {
  try {
    const voices = window.speechSynthesis.getVoices?.() ?? []
    if (!voices.length) return null
    const base = String(lang).slice(0, 2).toLowerCase()
    return (
      voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ??
      voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ??
      null
    )
  } catch {
    return null
  }
}

// Speak `text` in `lang` (defaults to Russian). The combining stress mark
// (U+0301) is kept so Russian voices place the stress on the right vowel —
// this is what tells heteronyms like сто́ит (costs) from стои́т (stands) apart
// out loud. `opts.onEnd` / `opts.onStart` fire around playback (used by the
// hands-free speaking drill to start listening only once the prompt finishes).
// Returns true if speech was started.
export function speak(text, lang = 'ru-RU', rate = 0.9, opts = {}) {
  if (!speechSupported()) return false
  const clean = String(text ?? '').trim()
  if (!clean) return false
  try {
    window.speechSynthesis.cancel()
    const utter = new window.SpeechSynthesisUtterance(spellOutInitialisms(clean))
    utter.lang = lang
    utter.rate = rate
    const voice = voiceFor(lang)
    if (voice) utter.voice = voice
    if (opts.onStart) utter.onstart = () => opts.onStart()
    if (opts.onEnd) utter.onend = () => opts.onEnd()
    window.speechSynthesis.speak(utter)
    return true
  } catch {
    // Never let a speech failure break the drill.
    return false
  }
}

// Stop any in-progress or queued speech.
export function cancelSpeech() {
  if (!speechSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore — nothing was speaking
  }
}

/**
 * Rough upper bound on how long an utterance takes to read aloud, so a watchdog
 * can rescue a drill when speechSynthesis never fires `onend` (a known flaky
 * case: long utterances, backgrounded tabs, after a `cancel()`).
 *
 * Divided by the playback rate: a slow (0.5×) read takes about twice as long,
 * so the watchdog must wait for it — otherwise the mic opens mid-sentence.
 * @param {string} text
 * @param {number} [rate] playback rate the part is spoken at (1 = normal)
 * @returns {number} milliseconds
 */
export function estimateSpeechMs(text, rate = 1) {
  const base = Math.min(12000, Math.max(2500, String(text ?? '').length * 90 + 1200))
  return base / (rate || 1)
}

/**
 * Total estimated read time for a speech sequence — the sum of its parts, each
 * scaled by its own rate.
 * @param {Array<{ text: string, rate?: number }>} sequence
 * @returns {number} milliseconds
 */
export function sequenceDurationMs(sequence) {
  return (sequence ?? []).reduce((ms, s) => ms + estimateSpeechMs(s.text, s.rate), 0)
}

/**
 * Speak several parts back-to-back, each with its own language, then call
 * `onEnd` once the last finishes. Used for cross-language audio feedback like
 * an English "Correct." followed by the Russian phrase. Empty parts are
 * skipped; if nothing can be spoken `onEnd` still fires so callers can advance.
 * @param {Array<{ text: string, lang?: string, rate?: number }>} parts
 * @param {{ onEnd?: () => void }} [opts]
 * @returns {boolean} true if at least one part was queued
 */
export function speakSequence(parts, { onEnd } = {}) {
  const items = (parts ?? []).filter((p) => String(p?.text ?? '').trim())
  if (!speechSupported() || !items.length) {
    onEnd?.()
    return false
  }
  try {
    window.speechSynthesis.cancel()
    items.forEach((part, i) => {
      const utter = new window.SpeechSynthesisUtterance(spellOutInitialisms(String(part.text).trim()))
      utter.lang = part.lang || 'ru-RU'
      utter.rate = part.rate || 0.9
      const voice = voiceFor(utter.lang)
      if (voice) utter.voice = voice
      if (i === items.length - 1 && onEnd) utter.onend = () => onEnd()
      window.speechSynthesis.speak(utter)
    })
    return true
  } catch {
    onEnd?.()
    return false
  }
}
