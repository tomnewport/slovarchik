# Why the corpus is cached once

A decision record for #670. The short version: **the service-worker copy is
gone.** IndexedDB holds the corpus; nothing else does.

## What the question was

The vocabulary used to be held in two places at once:

| Where                              | What                                                | Written by                                                  |
| ---------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Cache Storage (`slovarchik-vocab`) | the JSON bytes as served                            | the worker's `StaleWhileRevalidate` rule (`vite.config.js`) |
| IndexedDB (`vocab-files`)          | the **parsed** documents, ~5.9 MB structured-cloned | `src/stores/vocab.js`                                       |

The stated reasoning was that the two did different jobs — IndexedDB holding
documents the app can use without parsing, Cache Storage holding bytes the
network layer can replay — and that the worker's copy earned its space by
making a deploy's first launch fast, and by surviving a network that fails
while `navigator.onLine` still reads `true`.

## What the measurement said

`e2e/offline.spec.js` (#665) put a real service worker under test for the first
time, in the `offline` Playwright project against the preview build. The
`slovarchik-vocab` cache comes back **empty** on the path a learner takes.

Two things keep it empty, and both are structural rather than incidental:

1. **First visit.** The worker installs and activates, but does not control the
   page that registered it. `syncFromNetwork`'s twelve fetches therefore go
   straight to the network — the worker never sees them, so nothing is cached.
2. **Every visit after that.** The corpus is in IndexedDB and the manifest
   hashes match, so `syncFromNetwork` skips every file (`vocab.js:106`). No
   request is issued, so there is still nothing for the worker to cache.

Offline, `initVocab` checks `navigator.onLine` and never fetches at all.

The rule was not broken, which is worth stating precisely because it is the
tempting misreading. A request that _does_ reach the worker is cached exactly as
configured — fetch a word file from an already-controlled page and it lands in
`slovarchik-vocab` on the next tick. Point (1) is therefore a race rather than a
law: on a slow enough first visit the worker could take control before the
downloads finished, and then the cache would fill. That race used to fall the
other way, and coalescing the boot loaders (#676) and fetching the stale files
together (#677) is what moved it — the downloads now reliably win.

Which is the argument for removal rather than against it. The cache's contents
were nondeterministic, decided by a race that unrelated performance work could
flip either way; and whatever landed in it was never read, because from the
second launch onward the store answers from IndexedDB without asking the
network. A cache you have to synthesise traffic to exercise is not serving
traffic.

So the rule could only ever populate itself in a narrow window — a deploy that
changed a word file, on a visit where the worker already controlled the page —
and even then the store immediately wrote the same bytes into IndexedDB, which
is what every later launch reads.

The earlier version of this note asserted the deploy-day win as measured. It
was not: it was inferred from the config. The test is what settled it, and it
settled it the other way.

## The decision

**Remove the rule.** Bounding a cache that never fills is a more precise
description of something that should not be there. What remains is one copy
with one invalidation rule — the manifest's content hashes — which is the whole
of the story a future reader has to hold.

This also fixes a real bug outright rather than by exception. `manifest.json`
lives under `vocab/`, so it matched the `StaleWhileRevalidate` pattern. A
service worker intercepts a request regardless of the `cache: 'no-cache'` the
store passes to `fetch` — that option controls the HTTP cache, not the worker —
so every launch was answered from the previous launch's manifest. Since those
hashes are the only signal that a word file changed, **a deploy's vocab change
was invisible until the launch after next.** With no rule, there is nothing to
exclude the manifest from.

## What is given up

The case for keeping it was a network that fails while `navigator.onLine` still
reads `true` — a captive portal, a dead zone — where the worker would have
served a stale word file instead of the fetch throwing. That case is real, and
it is already handled one layer up: a failed sync leaves `initVocab` on the
IndexedDB copy at `status: 'ready'` (`vocab.js:148-151`). The learner sees the
corpus they had before, which is exactly what the stale cache would have given
them.

The other loss is latency on the first launch after a vocab deploy. That launch
now fetches the changed files rather than reading them from Cache Storage —
which is what it did anyway, since the cache was empty.

## What holds this in place

`scripts/check-precache.mjs`, in CI after `build`:

- the `vocab/**` precache partition, which is #266 and was always its job;
- **no vocab runtime cache in the generated `dist/sw.js`** — the cache name, or
  a `registerRoute()` whose pattern matches `/vocab/`. Either one fails the
  build.

That second check has to read the built worker rather than run in a browser,
and the reason is the trap this whole issue fell into. Workbox opens a runtime
cache lazily, on the first request it actually handles. No vocab request ever
reaches the worker — that is the finding — so the cache is never created, and
`caches.keys()` is empty whether or not the rule exists. Every runtime
assertion about that cache passes either way.

The first attempt at this work was a Playwright test asserting the cache was
bounded. It went green while proving nothing, and its one honest line — a
sanity check that the cache contained _something_ — is what exposed the empty
cache and turned this issue around. The replacement was checked in both
directions: it fails against a build with the rule restored, and passes without
it.

`e2e/offline.spec.js` still covers the claim that matters — the app boots, a
route opens and a drill has words with the network cut — plus
`the corpus that survives the cut is the one in IndexedDB`, which pins the copy
those tests silently depend on.

**#266 is untouched.** The app shell is still precached and the vocab still is
not, so a word change does not re-ship the shell.
