import { test, expect } from '@playwright/test'

// The offline claim, actually exercised (#665).
//
// "An offline-first PWA" is the README's headline, and until this spec existed
// nothing had ever run it: the other projects use the dev server, where
// vite-plugin-pwa registers no service worker at all, so the workbox config,
// the precache manifest and the runtime caching rule had never been executed by
// a test. This project runs against `vite preview` over the production build,
// where the service worker is real.
//
// Two things this spec had to learn the hard way, both worth knowing before
// changing it:
//
//   - Offline capability arrives on the *second* visit, not the first. On a
//     cold load the worker installs and activates, but the page that installed
//     it is not yet controlled by it, so an offline reload at that point gets
//     ERR_INTERNET_DISCONNECTED. `primeCaches` reloads once while still online,
//     which is what a real returning learner does anyway.
//   - What actually carries the words across the network cut is IndexedDB, not
//     the service worker's `slovarchik-vocab` runtime cache. The store reads
//     IndexedDB first, so on the second visit it never re-fetches the JSON and
//     the SW runtime cache is never populated at all. Asserting on that cache
//     here would hang. (That the corpus is cached twice, and that one copy goes
//     unused on this path, is #670.)

test.setTimeout(120_000)

/** Number of vocab documents the store has in IndexedDB. */
async function cachedDocCount(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('slovarchik')
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    // Store names mirror src/lib/idb.js.
    if (!db.objectStoreNames.contains('vocab-files')) return 0
    return new Promise((res, rej) => {
      const req = db.transaction('vocab-files').objectStore('vocab-files').getAll()
      req.onsuccess = () => res(req.result.filter((r) => r.doc).length)
      req.onerror = () => rej(req.error)
    })
  })
}

/**
 * Get the app into the state a returning learner is in: service worker
 * installed and controlling the page, corpus in IndexedDB. Everything after
 * this can have the network cut from under it.
 */
async function primeCaches(page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })

  // First visit: the worker installs and activates, but does not control the
  // page that registered it.
  await page.waitForFunction(
    async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
    null,
    { timeout: 60_000 },
  )

  // Second visit: now it controls the page, and the precache serves the shell.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 60_000,
  })

  // Wait for the corpus to finish arriving, not merely to start. `syncFromNetwork`
  // downloads the files one after another, so a count taken mid-flight keeps
  // growing afterwards and any later comparison against it races.
  let stable = -1
  await expect
    .poll(
      async () => {
        const n = await cachedDocCount(page)
        const settled = n > 0 && n === stable
        stable = n
        return settled
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true)
}

test('the app boots and Home renders with the network cut', async ({ page, context }) => {
  await primeCaches(page)

  await context.setOffline(true)
  await page.reload()

  // The shell comes from the precache and the words from IndexedDB. A broken
  // precache partition shows up right here, as a failed navigation.
  await expect(page).toHaveTitle(/Slovarchik/)
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Quick/ })).toBeVisible()
  await expect(page.getByText('Learning')).toBeVisible()
})

test('the corpus survives the network cut, so a drill has words to deal', async ({
  page,
  context,
}) => {
  await primeCaches(page)
  const before = await cachedDocCount(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })

  // A booting shell with an empty dictionary would still render Home, so the
  // word count is the assertion that matters: `initVocab` reached `ready` from
  // the cache alone rather than degrading to `empty`.
  expect(before).toBeGreaterThan(0)
  expect(await cachedDocCount(page)).toBe(before)
})

test('a route never visited online still opens offline', async ({ page, context }) => {
  await primeCaches(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })

  // Route chunks are lazy. This is the test that the precache covers all of
  // them and not just the ones the priming visit happened to pull in —
  // otherwise the app is only offline-capable on the pages you opened first.
  await page.getByRole('button', { name: /Words/ }).click()
  await expect(page.locator('#app')).not.toBeEmpty()
  await expect(page).toHaveURL(/#\//)
})

test('the service worker claiming a first visit does not reload the page', async ({ page }) => {
  // main.js reloads when a *new* worker takes over, but must not reload on the
  // first visit, when the page simply had no controller yet — that would bounce
  // a first-time learner mid-render. Guarded explicitly in main.js.
  //
  // A window sentinel is the reliable way to ask "did this document survive?":
  // counting navigation events also catches the router's hash pushes, which are
  // same-document and not what this is about.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => {
    window.__slovarchikDocumentSentinel = 'first-visit'
  })

  await page.waitForFunction(
    async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
    null,
    { timeout: 60_000 },
  )
  // Give an erroneous reload time to happen before asserting that it did not.
  await page.waitForTimeout(3_000)

  expect(await page.evaluate(() => window.__slovarchikDocumentSentinel)).toBe('first-visit')
})
