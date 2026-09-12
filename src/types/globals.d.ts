// Browser globals the app really uses that TypeScript's DOM lib does not declare.
//
// These are declarations, not suppressions: each one names a thing that exists
// at runtime in a browser we support, and the code already guards every use.
// Without them the `checkJs` probe (#666) reports a genuine-looking error for
// code that is correct, which is the fastest way to teach people to ignore it.

interface Window {
  // Safari has never shipped the unprefixed constructors. Both call sites
  // (src/lib/recognition.js, src/lib/feedbackSound.js) read the standard name
  // first and fall back to the prefixed one, so these are optional.

  /** Prefixed Web Speech API — Safari and older Chromium. */
  webkitSpeechRecognition?: typeof SpeechRecognition

  /** Unprefixed Web Speech API. Absent in Firefox, hence optional. */
  SpeechRecognition?: typeof SpeechRecognition

  /** Prefixed Web Audio constructor — Safari. */
  webkitAudioContext?: typeof AudioContext

  /**
   * Deterministic-RNG seam for end-to-end tests (src/lib/seed.js, #322).
   * Set only by Playwright via addInitScript; never present in normal use.
   */
  __SLOVARCHIK_SEED__?: number | string
}

/**
 * Declared so `typeof SpeechRecognition` above resolves. TypeScript's DOM lib
 * does not ship Web Speech API types; the app only ever constructs it and
 * attaches event handlers, so an opaque constructor is enough and pretending
 * to know more would be worse.
 */
declare const SpeechRecognition: {
  new (): any
  prototype: any
}

/**
 * Build-time constants (`define` in vite.config.js): the commit the running
 * bundle was built from and the instant it was built. Declared `string | null`
 * because `gitCommitHash()` returns null outside a git checkout — and read
 * through `typeof` guards anyway (src/lib/appVersion.js), since neither exists
 * when a file is loaded outside a Vite pipeline.
 */
declare const __APP_COMMIT_HASH__: string | null
/** @see __APP_COMMIT_HASH__ */
declare const __APP_BUILD_DATE__: string | null
