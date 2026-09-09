# Merge order for the 2026-09 architecture review

Thirteen changes came out of the three tracks (`docs/parallel-tracks.md`). Ten
are open PRs; Red's three are pushed branches with no PR yet. This note is the
order they should be reviewed and merged in, and the three places a conflict is
guaranteed.

Everything below was measured by test-merging the branches, not inferred.

## State as of 2026-09-08

| PR | Issue | Branch | Base | CI |
| --: | --: | --- | --- | --- |
| 680 | #664 | `perf/664-cache-fixture-corpus` | main | green |
| 681 | #663 | `fix/663-gate-url-seed` | main | green |
| 676 | #659 | `fix/659-coalesce-boot-loaders` | main | green |
| 677 | #660 | `fix/660-concurrent-vocab-fetch` | `fix/659-…` | green |
| 678 | #662 | `fix/662-bulk-idb-writes` | `fix/660-…` | green |
| 679 | #667 | `refactor/667-split-progress-store` | `fix/662-…` | green |
| — | #658 | `fix/658-dedupe-form-index` | — | **no PR** |
| — | #668 | `fix/668-canonical-word-index` | — | **no PR** |
| — | #657 | `feat/657-build-time-derived-data` | — | **no PR** |
| 682 | #669 | `feat/669-size-budget` | main | green |
| 683 | #665 | `test/665-offline-coverage` | main | green |
| 684 | #670 | `fix/670-bound-vocab-cache` | `test/665-…` | green |
| 685 | #666 | `chore/666-typecheck-jsdoc` | main | green |

Green and Blue both used **stacked PRs**. A stacked PR must merge after its
base; GitHub retargets the child to `main` automatically as each base lands.

Red's three branches are stacked too (`#658` ← `#668` ← `#657`) but have no PRs
and sit one commit behind `main`. Nothing can merge them until they are opened.

## Merge order

Test-merging this sequence produces exactly **three** conflicting merges, all
identified below. Everything else applies clean.

**Wave 1 — free-standing.** No shared files with anything.

1. **#664** (680) — first, deliberately: it takes ~30 s off the unit run, so
   every CI run after it is cheaper.
2. **#663** (681) — touches only `src/lib/seed.js`.

**Wave 2 — Green's chain, strictly in order.**

3. **#659** (676) → 4. **#660** (677) → 5. **#662** (678) → 6. **#667** (679)

**Wave 3 — Red's chain, strictly in order.** Open the PRs first.

7. **#658** → 8. **#668** → 9. **#657**

**Wave 4 — Blue's infrastructure.**

10. **#669** (682)
11. **#665** (683) — **expect a conflict here** (see below)
12. **#670** (684)

**Wave 5 — last, and not merely last.**

13. **#666** (685) — needs rework, not just resolution (see below)

## The three conflicts, and what each one is

### 1. The second of {#669, #665} — mechanical

Both append a step to `.github/workflows/ci.yml`, a line to `scripts/check-ci.mjs`,
a script to `package.json`, and a paragraph to `AGENTS.md`. Whichever lands
second conflicts on all four. The order between them makes no difference — it is
one conflict either way — and the resolution is "keep both", in the order the
workflow should run them.

`scripts/check-ci.test.mjs` reads `ci.yml` and fails if the two drift apart, so
a resolution that keeps only one side is caught by CI rather than by review.

### 2. #665 vs #657 on `src/stores/vocab.test.js` — mechanical

Both add cases to the same file: #665's offline branches, #657's derived-data
load path. Distinct `describe` blocks; keep both.

### 3. #666 against #667, #657 and #668 — **rework, not resolution**

This is the one that needs a person.

#666 touches 36 files; 31 are uncontested and merge clean. The other five:

| file | contested with | why it is not a merge |
| --- | --- | --- |
| `src/stores/progress.js` | #667 | #667 reduces this file from 1,139 lines to a **16-line barrel**. #666's JSDoc fixes target functions that now live in `src/stores/progress/records.js`, `batches.js` and `sessions.js`. The edits must be **relocated**, not merged. |
| `src/lib/vocabBuild.js` | #658, #657 | both rewrote the signatures #666 is documenting |
| `src/lib/exerciseBuild.js` | #668, #657 | same |
| `src/stores/hints.js` | #658, #668, #657 | same |
| `AGENTS.md` | everyone | trivial |

The `@param` blocks #666 fixed are correct against `main` as it stands today and
wrong against the tree after waves 2–4, because the signatures changed underneath
them. Re-running `npx tsc -p jsconfig.json` after wave 4 and re-fixing what it
reports is more honest — and probably faster — than resolving the merge by hand.

**Do not resolve #666's conflicts mechanically.** A "keep both" here produces
JSDoc that describes the old signature in the new location, which is exactly the
defect #666 exists to remove.

## Review order (different from merge order)

Merge order is forced by the stacks. Review attention should go by risk:

1. **#662** — atomicity and IndexedDB transaction semantics; the only genuine
   data-loss path in the review. Check that a mid-batch failure really does
   leave the store untouched, and that the silent-failure surfacing doesn't
   toast on every answer.
2. **#667** — 1,455 lines moved. The memo must have exactly one owner; the
   check is that `progress.test.js` passes **untouched**.
3. **#657** — check the build-time round-trip assertion actually runs on the
   real corpus, and that a half-updated client cache falls back to deriving
   rather than reading annotations off the wrong sentences.
4. **#659**, **#660** — concurrency: coalescing correctness, and that
   `Promise.allSettled` preserved the partial-success behaviour `Promise.all`
   would have lost.
5. Everything else is small and mostly mechanical: #658, #668, #664, #663,
   #669, #665, #670, #666.

## One thing that turned out not to be a constraint

#669's budget allows 1,200,000 B of gzipped vocab against a 1,148,952 B
baseline — 51 KB of headroom. #657 was expected to eat it. It doesn't: Red ran
the two gating measurements the issue asked for, **rejected** shipping the whole
shaped phrase list (+797.5 KiB, +71.7%) and the pre-built form index (+487.9 KiB,
+43.7%), and ships only the annotations at **12.6 KiB (+1.1%)**. So #669 and
#657 can merge in either order and neither needs its budget raised.

## Still open

- **#661** has no branch and no comment.** It was blocked on #657, which has now
  landed as a branch — so the question it asks is answerable, but nobody has
  answered it. It still needs the real-device measurement the issue describes.
