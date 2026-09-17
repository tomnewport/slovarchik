// A local cart of dictionary requests. Checkout opens the same pre-filled
// GitHub issue composer used by exercise reports; the learner submits it there.
const NEW_ISSUE = 'https://github.com/tomnewport/slovarchik/issues/new'
export const WISHLIST_LIMIT = 20

function identity(ru) {
  return ru.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
}

export function addWishlistItem(items, { ru, en = '' }) {
  const name = String(ru ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name || items.length >= WISHLIST_LIMIT || items.some((item) => identity(item.ru) === identity(name))) {
    return items
  }
  return [...items, { ru: name, en: String(en ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }]
}

export function buildWishlistIssueUrl(items) {
  if (!items.length) return null
  const title = `Vocabulary wishlist: ${items[0].ru}${items.length > 1 ? ` (+${items.length - 1})` : ''}`
  const body = [
    '## Words I would like to learn',
    '',
    ...items.map((item) => `- ${item.ru}${item.en ? ` — ${item.en}` : ''}`),
    '',
    'Please consider adding these words to the learning vocabulary.',
  ].join('\n')
  return `${NEW_ISSUE}?${new URLSearchParams({ title, body })}`
}
