// Coalescing wrapper for the boot loaders (#659).
//
// `main.js` fires `initVocab`, `loadProgress` and `loadSettings` without
// awaiting them, and every view that can be deep-linked into repeats the call
// in its own `onMounted`. The call-site guards those views use —
// `if (!vocabState.words.length) await initVocab()` — cannot work: the flag
// they test is only set at the *end* of the boot they are racing, so both calls
// see it empty and both run. A call site can't guard against a call it didn't
// make, so the guard belongs to the loader itself.
//
// Wrapping a loader here makes a second call during the first one join it
// instead of starting a duplicate: same promise, same result, same rejection.
// The slot is released once it settles, so a *later* call still re-runs — this
// is de-duplication of concurrent work, not a once-only latch or a cache.

/**
 * Wrap an async function so concurrent calls share one in-flight run.
 *
 * Arguments come from whichever call started the run; the loaders this is used
 * on take none. A rejection propagates to every joined caller and clears the
 * slot, so a failed boot can be retried.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn  the async function to guard
 * @returns {F}   same signature, de-duplicated while in flight
 */
export function coalesce(fn) {
  let inflight = null
  return /** @type {F} */ (
    function coalesced(...args) {
      if (inflight) return inflight
      // Wrapped in an async IIFE so a synchronous throw inside `fn` rejects the
      // shared promise (and clears the slot) rather than escaping past it and
      // leaving `inflight` set forever.
      inflight = (async () => fn.apply(this, args))().finally(() => {
        inflight = null
      })
      return inflight
    }
  )
}
