// Learner-selected words for the next learning batch (#753). This is separate
// from the Progress screen's GitHub request cart for words missing from lessons.
import * as idb from '../../lib/idb.js'
import { state, WISHLIST_META_KEY } from './state.js'

/** Add an existing learnable word to the next-batch queue. */
export async function queueForNextBatch(key) {
  if (typeof key !== 'string' || !key || state.learningWishlist.includes(key)) return false
  const next = [...state.learningWishlist, key]
  await idb.setMeta(WISHLIST_META_KEY, next)
  state.learningWishlist = next
  return true
}

export async function removeFromNextBatch(key) {
  if (!state.learningWishlist.includes(key)) return false
  const next = state.learningWishlist.filter((saved) => saved !== key)
  await idb.setMeta(WISHLIST_META_KEY, next)
  state.learningWishlist = next
  return true
}

/** A chosen learning batch fulfils only the requests it actually contains. */
export async function clearChosenWishlistWords(keys) {
  const used = new Set(keys)
  const next = state.learningWishlist.filter((key) => !used.has(key))
  if (next.length === state.learningWishlist.length) return
  await idb.setMeta(WISHLIST_META_KEY, next)
  state.learningWishlist = next
}
