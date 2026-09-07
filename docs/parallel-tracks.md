# Three parallel tracks for the 2026-09 architecture review

All fourteen open issues (#657–#670) came out of one architecture review on
2026-09-06. They are not independent: seven of them touch `src/stores/vocab.js`
and three touch `src/stores/progress.js`, so handing them out at random would
produce three agents fighting over two files.

This note splits them into **red**, **green** and **blue** tracks that can run
concurrently, and says where the seams are thin enough to need care.

## Priority order (ignoring parallelism)

Ranked by learner-visible impact against cost. The track each one lands in is in
the last column.

| # | Issue | Why it ranks here | Cost | Track |
| --: | --- | --- | --- | --- |
| 1 | #659 duplicate vocab boot | A deep link downloads the whole 1.15 MB corpus **twice** and writes IndexedDB twice. A real defect, reproduced in the issue, and the fix is an in-flight-promise wrapper. | S | green |
| 2 | #658 `formIndex` built twice | 240 ms off the entry to every phrase-bearing drill, at the moment the learner is watching a blank screen. Pure de-duplication, no behaviour change. | S | red |
| 3 | #660 serialised vocab fetch | 13 stacked round trips on first install (~1.3 s of pure latency on 4G). `Promise.allSettled` over the stale entries. | S | green |
| 4 | #664 fixture corpus re-parsed 78× | ~30 s off a 78 s unit run. Doesn't reach a learner, but it compounds with every other item on this list, so it goes early. | S | blue |
| 5 | #663 `?seed=` live in production | A shared URL silently pins every batch, session and flashcard draw for a real learner. Low severity, ~5 lines, and the symptom ("it keeps offering the same words") is near-undiagnosable. | XS | blue |
| 6 | #662 non-atomic `importData` | A failed restore leaves the store half-written **after** `clearProgress()` — the only genuine data-loss path in the review. The silent-streak-loss half is the same fix's second act. | M | green |
| 7 | #669 size/startup ratchet | Cheap, and it is what makes #657, #660 and #661 verifiable rather than asserted. Set the budget while the numbers are healthy. | S | blue |
| 8 | #665 nothing tests offline | The README's headline claim, plus `CLAUDE.md:47` currently describes a Playwright config that doesn't exist. | M | blue |
| 9 | #657 build-time derived data | The largest single win (~0.9 s per launch), but it opens with a measurement gate — payload cost could reverse the conclusion — so it is a real piece of work, not a patch. | L | red |
| 10 | #668 five private `wordsByKey` | Mechanical; the cost is drift risk, not the 4.4 ms. | S | red |
| 11 | #670 double corpus cache | One-liner (`maxEntries: 20`) plus a decision to record. Its acceptance leans on the precache test from #665. | S | blue |
| 12 | #666 JSDoc has drifted | 96 `tsc --checkJs` errors, ~30 of them `@param` blocks that mislead callers. Valuable, but cross-cutting — it wants a quiet tree. | M | blue |
| 13 | #667 split `progress.js` | Maintainability only, no behaviour change, largest blast radius in the repo. Deliberately last. | L | green |
| 14 | #661 lazy corpus loading | Explicitly blocked on #657, and may well resolve to "do nothing". Needs a real-device measurement nobody in the review could take. | ? | red |

## The tracks

### 🔴 Red — the vocab derivation pipeline

**Owns:** `src/stores/vocab.js` lines 39–70 (the derived computeds and
`rebuild`), `src/stores/hints.js`, `src/lib/vocabBuild.js`,
`src/lib/promptDisambiguation.js`, `src/lib/phraseHint.js`,
`scripts/gen-manifest.mjs`.

**Order — strictly sequential, each one sets up the next:**

1. **#658** — move `buildFormIndex` into `stores/vocab.js` beside `wordsByKey`,
   thread it into `shapePhrases`, have `hints.js` import it. Recovers 240 ms on
   its own and is the cheap half of #657.
2. **#668** — point the five private key→word maps at the exported one, and hand
   `buildExercises` a pre-shaped vocab. Small, and it establishes "the store
   publishes the canonical view" before #657 adds more of them.
3. **#657** — the build-time move. Start with the two measurements the issue
   asks for (gzipped payload of a pre-shaped `phrases.json`; cost of
   reconstructing a 39.5 k-entry `Map` from JSON). If either comes back badly,
   take the fallback — get `shapePhrases` off the critical path — and say so.
4. **#661** — only if #657 lands. Likely outcome is a measured "option 1, close
   it"; do not build the CEFR re-split speculatively.

**Why these are one track:** #658 ⊂ #657, and #661 is unreachable without #657.
Splitting them means the second agent rebases onto the first all day.

### 🟢 Green — load, persist, lifecycle

**Owns:** `src/stores/progress.js`, `src/stores/settings.js`,
`src/stores/reports.js`, `src/lib/idb.js`, `src/stores/vocab.js` lines 90–156
(`syncFromNetwork`, `initVocab`).

**Order:**

1. **#659** — coalesce on the in-flight promise in `initVocab`, `loadProgress`,
   `loadSettings`, `loadReports`. Add the wrapper; do not restructure the
   functions it wraps (see the seam note below).
2. **#660** — `Promise.allSettled` over the stale manifest entries, keeping
   partial success and handing each doc to `idb.putFile` as it arrives.
   Independent of #659 but in the same region of the same file, so same agent.
3. **#662** — `putAllProgress` in one transaction, `importData` on top of it,
   per-day activity records, and a persistence failure the learner can see.
4. **#667** — the `progress.js` split, **last**, so it absorbs #659 and #662
   rather than colliding with them. The `migrations.js` extraction is the part
   worth having even if the rest is deferred.

**Why these are one track:** every one of them writes to `progress.js` or the
`vocab.js` I/O half. #667 rewrites the file wholesale, so nothing else may be in
flight against it.

### 🔵 Blue — test and CI infrastructure

**Owns:** `src/test/fixtures.js`, `e2e/`, `playwright.config.js`,
`vite.config.js`, `.github/workflows/ci.yml`, `scripts/`, `src/lib/seed.js`.

**Order:**

1. **#664** — memoise the parsed fixture documents (option 1 in the issue; keep
   `buildWords` fresh per call). Land this first: it takes ~30 s off every run
   red and green will do for the rest of the week.
2. **#663** — gate the URL seed paths on `import.meta.env.DEV`, leaving
   `window.__SLOVARCHIK_SEED__` working in every build.
3. **#669** — `scripts/size-summary.mjs` + a committed budget file, published to
   the job summary. Set the numbers against **`main`**, not against a branch.
4. **#665** — the offline tests, in the issue's stated order of value: the
   precache-partition assertion (4) and the `initVocab`-offline unit tests (1)
   are nearly free; the real offline e2e (2) is the goal. Fix `CLAUDE.md:47`
   while here.
5. **#670** — bound the runtime cache and verify the manifest's SW interaction.
   Sits directly after #665 because its acceptance test is #665's.
6. **#666** — the `tsc --checkJs` sweep, **last**. It reports errors across files
   red and green are actively rewriting, so doing it early means fixing the same
   `@param` blocks twice.

**Why these are one track:** nothing here changes runtime behaviour except
#663 and #670, and none of it touches `progress.js` or the vocab derivation.

## Seams to be careful about

Four places where two tracks touch the same file. None is a blocker; all four
want a word before the first push.

- **`src/stores/vocab.js` — red and green.** Red works in lines 39–70 (derived
  computeds, `rebuild`); green works in lines 90–156 (`syncFromNetwork`,
  `initVocab`). Disjoint regions of a 156-line file, so git merges them cleanly
  *provided* green adds its coalescing as a wrapper rather than reorganising the
  file. If green needs to restructure, it goes first and red rebases.
- **`vite.config.js` — blue only, deliberately.** #670's `runtimeCaching` change
  and #665's PWA `devOptions` are both blue's, which is why #670 sits in blue
  rather than with the other vocab-caching work.
- **#669's vocab budget vs #657.** If red ships a pre-shaped `phrases.json`, the
  vocab payload grows and blue's budget fails. That is the ratchet working as
  designed: red raises the number in its own PR, with the before/after in the
  commit message.
- **`CLAUDE.md`'s project map — all three.** Every track will add a line
  (`stores/progress/`, a new `src/lib/` module, a new script). Expect a trivial
  conflict there on each merge; resolve by keeping both.

## Suggested merge order

`#664` → `#659` → `#658` → then whatever is ready. Getting the fast test suite
and the two boot fixes in early makes every later branch cheaper to validate.

## What this plan does not know

- **Whether #657 pays.** Its own two gating measurements are unrun. Red could
  spend a day and correctly conclude the fallback is the right answer.
- **#661 needs a real mid-range Android**, cold and warm, with the SW cache
  primed and empty. No agent in a container can produce that number, so #661 may
  end up parked on a measurement request rather than closed.
- **The size of #667 in practice.** 1,139 lines across seven sections is a large
  mechanical move; `progress.test.js` (1,576 lines) passing untouched is the only
  real check, and if it needs edits the split has changed behaviour.
