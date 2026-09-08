# Why the corpus is cached twice

A decision record for #670. The short version: **both copies stay**, the
runtime cache is now bounded, and `manifest.json` has been taken out of it.

## What exists

The vocabulary is held in two places at once:

| Where                              | What                     | Size                         | Written by                                                          |
| ---------------------------------- | ------------------------ | ---------------------------- | ------------------------------------------------------------------- |
| Cache Storage (`slovarchik-vocab`) | the JSON bytes as served | ~1.15 MB gzipped on the wire | the service worker's `StaleWhileRevalidate` rule (`vite.config.js`) |
| IndexedDB (`vocab-files`)          | the **parsed** documents | ~5.9 MB structured-cloned    | `src/stores/vocab.js`                                               |

They are not the same thing, and that is the point: IndexedDB holds documents
the app can use without parsing, Cache Storage holds bytes the network layer
can replay. The duplication is real but the two copies do different jobs.

## When the service worker copy is actually consulted

Measured against the preview build with a real worker (`e2e/offline.spec.js`):

1. **Offline.** Not consulted. `initVocab` checks `navigator.onLine` and never
   reaches the network, so the words come from IndexedDB. The SW cache is
   inert on the path it looks most useful for.
2. **Online, corpus unchanged.** Only the manifest is fetched; every word file
   is skipped on its content hash, so nothing reaches the SW rule.
3. **Online, a file changed.** The one clear win: the changed file is served
   from cache immediately and revalidated in the background, so a deploy does
   not stall the first launch after it.
4. **Online but failing** (captive portal, flaky 4G, a 500). The SW answers
   from cache where the network would have thrown. The app survives either way
   — a failed refresh leaves `initVocab` at `ready` on the IndexedDB copy — so
   this is a latency win, not a correctness one.

## The decision

**Keep both.** Case 3 is a genuine benefit on exactly the launch a learner is
most likely to notice, and the cost is bounded disk on a device that has
already accepted a ~6 MB corpus in IndexedDB. Removing the SW cache would save
~1.15 MB and make the first launch after every deploy slower.

Two things did change:

- **The cache is bounded** — `expiration: { maxEntries: 20 }`. There are twelve
  word files; 20 leaves room to add parts of speech without evicting a live
  one. Before this there was no upper bound at all, so a file dropped from the
  manifest or renamed by a deploy sat in Cache Storage forever.
- **`manifest.json` is excluded from the rule.** This was a real bug, not
  tidying. The manifest lives under `vocab/`, so it matched the
  `StaleWhileRevalidate` pattern. A service worker intercepts a request
  regardless of the `cache: 'no-cache'` the store passes to `fetch` — that
  option controls the HTTP cache, not the worker — so every launch was answered
  from the previous launch's manifest. The manifest's content hashes are the
  only signal that a word file changed, so **a deploy's vocab change was
  invisible until the launch after next.** Excluding it costs nothing: offline
  the store never asks for it, and a failed manifest fetch is already handled.

## What holds this in place

`e2e/offline.spec.js`, in the `offline` Playwright project (the preview build,
where the worker is real):

- `the manifest is never served from the service worker cache` — fails against
  the pre-#670 config, which is how we know it is testing something.
- `the vocab runtime cache is bounded`.

The precache/runtime split itself — `vocab/**` staying out of the precache
manifest, the #266 decision — is guarded separately by
`scripts/check-precache.mjs` in CI.
