// Thin wrapper around the Web Speech API for reading Russian words and
// phrases aloud. Speech is a progressive enhancement: when the API is
// unavailable (older browsers, tests, SSR) every call is a safe no-op.

export function speechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
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
    const utter = new window.SpeechSynthesisUtterance(clean)
    utter.lang = lang
    utter.rate = rate
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
      const utter = new window.SpeechSynthesisUtterance(String(part.text).trim())
      utter.lang = part.lang || 'ru-RU'
      utter.rate = part.rate || 0.9
      if (i === items.length - 1 && onEnd) utter.onend = () => onEnd()
      window.speechSynthesis.speak(utter)
    })
    return true
  } catch {
    onEnd?.()
    return false
  }
}
