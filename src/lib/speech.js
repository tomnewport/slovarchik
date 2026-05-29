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
// out loud. Returns true if speech was started.
export function speak(text, lang = 'ru-RU', rate = 0.9) {
  if (!speechSupported()) return false
  const clean = String(text ?? '').trim()
  if (!clean) return false
  try {
    window.speechSynthesis.cancel()
    const utter = new window.SpeechSynthesisUtterance(clean)
    utter.lang = lang
    utter.rate = rate
    window.speechSynthesis.speak(utter)
    return true
  } catch {
    // Never let a speech failure break the drill.
    return false
  }
}
