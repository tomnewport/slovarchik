# Curriculum parts — splitting CEFR levels into learnable chunks

_Design note for #674 (split CEFR levels) and #675 (show words already seen)._

## The problem

A CEFR level is too big to be a goal. B1 alone is 2,081 learnable words — years
of study behind a single unmoving progress bar. #674 asks for chunks of about
500 words, "aspirational for several months to a year", with halfway and
completion called out and celebrated.

These chunks are **not** CEFR sub-levels and carry no external meaning. They are
this app's own unit of curriculum, named for the level they sit in: "A2 Part I",
"B1 Part III".

## The shape of a part

A part is a **bundle of topic collections within one CEFR level**. Collections
are what `batches.js` already anchors batch names on, so a part stays
topically legible: "A2 Part I" is recognisably food, people and communication
rather than an arbitrary slice of the dictionary.

| | |
| --- | --- |
| Target size | 500 words |
| Minimum | 250 — waived when the whole CEFR level holds fewer (C1 has 25) |
| Maximum | 750 |
| Membership | a word's CEFR level plus its first-listed collection |

Sizes count **every learnable word**, including the 246 that carry no
collection at all — pronouns, prepositions, conjunctions, interjections,
numerals. Those are real vocabulary and a coverage bar that omitted them would
understate what the learner knows. They cannot *anchor* a part (they have no
collection to bundle), so they join the first part of their level; `batches.js`
already trickles them into every batch regardless via `GLUE_POS`.

As of writing, the corpus packs into nine parts, every one inside the bounds:

| Part | Words | Composition |
| --- | ---: | --- |
| A1 Part I | 552 | glue 119, daily life 64, in the kitchen 32, calendar 25, +38 |
| A2 Part I | 483 | daily life 146, food and drink 48, people 44, communication 43, +6 |
| A2 Part II | 443 | clothes 24, nationalities 22, home 20, nature 20, +37 |
| B1 Part I | 462 | daily life 330, feelings and sensations 132 |
| B1 Part II | 439 | communication 124, work 100, abstract 77, people 70, +1 |
| B1 Part III | 493 | food and drink 67, nature 66, measurement 62, technology 59, +5 |
| B1 Part IV | 687 | character 39, the law 36, sickness and health 35, +38 |
| B2 Part I | 665 | nature 43, faith 39, the law 35, +50 |
| C1 Part I | 25 | the whole level — under the floor, which the waiver allows |

## Why the parts are committed data, not derived

Bin-packing is not stable under insertion: adding one word to one collection can
reshuffle several *other* collections between parts. Derived live from the
corpus, parts would churn on every vocab edit — the opposite of a stable goal a
learner spends months inside.

So `public/vocab/parts.yml` is **maintainer-owned committed data**, reviewed
like any other corpus change. A script proposes a packing; a human accepts it.

This is the same split the repo already draws between gates and worklists: the
machine says when something is wrong, a person decides what to do about it.

### Defragmentation, not strict clustering

A collection may be **split across parts** when it is large enough to warrant
it — B1 `daily life` is 330 words, 71% of its part, and splitting it is more
sensible than letting one topic dictate a part's whole shape.

What we are avoiding is *fragmentation*: a 20-word collection landing 10 in one
part and 10 in another helps nobody. So a fragment has a floor (40 words in the
current packer). Below that the packer shunts the whole collection to the next
part instead of cutting it.

With that floor, today's corpus needs **zero splits** — every part above is
whole collections. Splitting is capability held in reserve, and it first
matters when B1 `daily life` reaches ~420 and forces its part past 750.

### Redistribution is minimal, not a repack

When a bound is breached the fix moves **the absolute minimum**: every
collection stays in its current part, and only what the bounds require is
moved, splitting only when no whole-collection move is legal.

A free repack would be easier to write and much worse to live with — a learner
who has never touched B1 would watch their finished A2 parts rearrange for
reasons invisible to them.

## Growth, and why milestones are stamped

Adding words to a part the learner has already completed is normal and expected.
The bar honestly reopens (499/500) and they can top it up.

What must **not** happen is the completion being revoked. Today it would be:
`earnedSet` recomputes achievements from live counts every time, so
`cefr-A1` is earned exactly while `learned >= total` — meaning adding A1 words
to the corpus silently un-earns an achievement the learner already saw, and
`seenAchievements` ensures it never re-fires.

Parts make this far more frequent (nine smaller denominators instead of five
large ones), so it is fixed first, on its own, before either issue lands:
**an achievement records when it was first earned and keeps it.** Part ids are
stable strings (`part-B1-3`) since `seenAchievements` persists them.

## Where new vocabulary goes

New words should prioritise the **lowest unfilled part** — the earliest part in
curriculum order still under the 500 target. Because membership follows
collection, that resolves to a concrete instruction: not "add A2 words" but
"add 17 words to `daily life`, `food and drink`, `people` or `communication`
at A2".

Right now that is **A2 Part I, at 483/500**.

## What gets built

| Piece | Kind | Job |
| --- | --- | --- |
| `public/vocab/parts.yml` | committed data | part → level, ordinal, collections |
| `src/lib/curriculum.js` | pure module | word → part, sizes, names, ordering, lowest-unfilled |
| `check:parts` | **CI gate** | every word in exactly one part; bounds held; no fragment below the floor |
| repack script | worklist | proposes the minimal redistribution when the gate fails |
| fill worklist | worklist | names the lowest unfilled part and its collections |

Only `check:parts` fails the build. The other two rank findings for a human, in
the repo's usual sense.

### The engine change

`batches.js` step 2 currently refines the eligible pool to the lowest **CEFR
level** present. Under parts it refines to the lowest **part** — that one
function is the behavioural core of #674, and what makes a part a real goal
rather than a label on a chart.

## Words already seen (#675)

The visualisation gains a third series *before* the parts land, because it
changes only what is counted, not what is taught.

A learner meets far more words than their batches teach — in phrases, banks and
listening boards. #675 counts those as **encountered**, and an encounter has to
be earned: the word was identified, spelled or said *correctly*.

Two constraints shaped the implementation:

- **An encounter is not an attempt.** `recordAttempt` fires only for
  `ex.targets`, one word per exercise; everything else in the phrase left no
  trace. Closing that gap by writing `events` would have been wrong twice over:
  an event flips `wordState` to `learning` and hands the word to the scheduler,
  and `lost` / `atRisk` / `recentlyLearned` / the analytics history all walk
  `Object.keys(state.records)`, so every encounter would become a record those
  computeds have to consider and reject.

  So the log lives outside `records` entirely, as a single meta blob in
  `stores/progress/encounters.js` — word key → when it was first met, bounded by
  the learnable corpus (~4,250 keys) rather than by how much drilling happens.

- **A word the app gave away was not recalled.** Hint *taps* turned out not to
  be tracked at all, so the gate is built from what is observable per exercise
  instead: the keyboard hint (already reported as the absence of `double`), the
  ❓ Dictionary panel (which glosses precisely the encounter candidates and costs
  no points, so it needed a new `dictUsed` flag), and the inline glosses under a
  word-bank cue — not opt-in at all, which is why only that drill's *audio*
  variant can prove anything.

The surface-form index (`formIndex`, built once per vocab load since #686) maps
the inflected forms in a phrase back to dictionary keys. A token matching more
than one sense is skipped rather than guessed at: crediting the wrong half of a
homograph would overstate what the learner has seen, and being one word short is
the cheaper error. Gloss-only entries are gated out, so the log stays bounded by
the curriculum.

The three counts are derived so they nest by construction — `met` counts
anything ever attempted *plus* anything the log names — rather than stored
separately and trusted to stay consistent.

The spoken drills stay out: their grade comes from the Web Speech API, which is
language-model-assisted and will return the expected sentence from imperfect
input. That makes a "correct" there much weaker evidence than a typed one, and
crediting it would overstate the bars in the flattering direction. So of the
issue's three routes — identified, spelled, said — the first two are wired and
the third is declined on purpose.

**Mind the name.** `encounterCount` in `stores/progress/sessions.js` already
means something else: how many identification events a *batch* word has, which
gates when its spelling drill unlocks (`MIN_ENCOUNTERS_FOR_SPELLING`). #675's
sense — a word met incidentally, outside anything teaching it — needs its own
vocabulary, or the two will be read as one.

## Order of work

1. **Stamp achievements** — record `earnedAt` instead of recomputing from live
   counts. Fixes a live defect, and part milestones would inherit it.
2. **#675 encounters** — additive; changes nothing about what is taught.
3. **#674 parts** — changes the batch pool *and* the chart's unit, and lands on
   encounter data so a part shows all three segments from the start.
