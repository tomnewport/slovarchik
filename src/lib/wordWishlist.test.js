import { describe, expect, it } from 'vitest'
import { addWishlistItem, buildWishlistIssueUrl, WISHLIST_LIMIT } from './wordWishlist.js'

describe('vocabulary wishlist', () => {
  it('deduplicates stressed and unstressed spelling and caps the cart', () => {
    const items = addWishlistItem([], { ru: 'ко́шка', en: 'cat' })
    expect(addWishlistItem(items, { ru: 'кошка' })).toEqual(items)
    expect(addWishlistItem(Array.from({ length: WISHLIST_LIMIT }, (_, i) => ({ ru: String(i) })), { ru: 'extra' })).toHaveLength(WISHLIST_LIMIT)
  })

  it('prepares one issue for checkout with every requested word', () => {
    const url = new URL(buildWishlistIssueUrl([
      { ru: 'ёжик', en: 'hedgehog' }, { ru: 'мышь', en: '' },
    ]))
    expect(url.pathname).toBe('/tomnewport/slovarchik/issues/new')
    expect(url.searchParams.get('title')).toContain('ёжик (+1)')
    expect(url.searchParams.get('body')).toContain('- мышь')
    expect(buildWishlistIssueUrl([])).toBeNull()
  })
})
