// Proxy-free deep copies (#534).
//
// Vue's `reactive()` wraps store state in Proxies, which IndexedDB's structured
// clone cannot serialise. This is the one place that undoes that. It replaces
// the `JSON.parse(JSON.stringify(x))` round-trip the stores used to hand-roll:
// that is not a clone — it silently drops `undefined` and mangles `Map`, `Set`,
// `Date`, `BigInt` and `Infinity`/`NaN` — whereas `structuredClone` is the very
// algorithm IndexedDB uses, so anything `toPlain` copies, a `put` can store.

import { toRaw } from 'vue'

/** Objects and arrays we can safely rebuild key-by-key (not Map/Set/Date/…). */
function isPlainContainer(value) {
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Strip Vue proxies, allocating only where one is actually found.
 *
 * `toRaw` unwraps a proxy in one step and that is enough for its whole subtree:
 * `reactive()` unwraps on write, so a proxy's target holds raw values all the
 * way down. What it cannot help with is a hand-built object or array holding
 * proxies pulled out of reactive state (an export snapshot, say) — and
 * `structuredClone` throws `DataCloneError` on a Proxy rather than reading
 * through it — so those containers are walked and rebuilt.
 */
function unwrap(value) {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value)
  if (raw !== value) return raw // a proxy — its target is already raw throughout
  if (!isPlainContainer(raw)) return raw // Map/Set/Date/… — structuredClone's job
  let copy = null
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const item = unwrap(raw[i])
      if (item !== raw[i]) (copy ??= raw.slice())[i] = item
    }
  } else {
    for (const key of Object.keys(raw)) {
      const item = unwrap(raw[key])
      if (item !== raw[key]) (copy ??= { ...raw })[key] = item
    }
  }
  return copy ?? raw
}

/**
 * A structured-clone-safe deep copy with Vue's reactive proxies unwrapped.
 *
 * Unlike the JSON round-trip it replaces, it throws `DataCloneError` on a
 * function or symbol rather than dropping it — a loud failure at the write
 * beats quiet corruption in a backup.
 */
export function toPlain(value) {
  return structuredClone(unwrap(value))
}
