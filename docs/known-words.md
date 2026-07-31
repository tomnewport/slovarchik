# "I know this word" — self-declared known words

_Alternative to the placement quiz proposed in #321._

## The problem (#321)

A learner who already knows some Russian still starts from the same A1 batches
as a true beginner and has to grind every word through the full learning
criteria (3-of-4 correct across identification / usage / hearing, three speaking
attempts) — and again through the day-spaced mastery criteria. The only escape
hatch is the manual batch-add search.

Issue #321 proposed a **placement quiz**: sample words across CEFR levels on
first launch and seed whole levels as learned from a binary search. That guesses
at knowledge from a sampled few and bulk-marks their level-mates, which is easy
to get wrong and hard to undo.

## What we do instead

A per-word **"I know this word"** button. The learner self-declares knowledge
one word at a time, and still has to _demonstrate_ it — but only **once per
exercise** rather than grinding the full window. Concretely, a flagged word is
graded on relaxed criteria: a single correct answer in each dimension confirms
it at whichever level it is being drilled (learning → learned, mastery →
mastered), with no overnight day-spacing.

- Nothing is marked learned on a guess: a word never yet attempted stays
  `unknown` until the learner answers one exercise for it.
- It is reversible per word (Undo), and it fast-forwards a part-learned word
  that has already cleared the relaxed bar.
- A known word skips the spaced confirmation review (#313): the learner has
  vouched for it, so it is mastery-eligible immediately.

## How it fits the architecture

The whole thing is a criteria swap in the pure engine — no parallel code path:

- `src/lib/progression.js` — `KNOWN_CRITERIA` (every dimension `need: 1`,
  `window: 1`, no `days`) and `criteriaFor(word)`, which returns the relaxed set
  when `word.known` is set and the standard `CRITERIA` otherwise. Every
  criteria-driven helper (`levelMet`, `dimensionProgress`, `minExercisesToLevel`,
  `levelGapByDimension`, `dimensionAdvancesAt`, `borderlineDimensions`) reads
  through `criteriaFor`, so states, batch progress and session steering all
  honour the flag automatically.
- `src/stores/progress.js` — the flag lives on the per-word progress record and
  is folded onto the vocab record by `wordRecord()`. `markKnown` / `unmarkKnown`
  / `isKnown` manage it; `markKnown` also stamps `learnedAt` / `masteredAt` /
  `peak` when the relaxed bar is already cleared. Persisted in IndexedDB and in
  the JSON backup (export/import).

## Surfaces

- **In a session** — an "I know this word" button next to the skip controls,
  shown only for single-target exercises (a matching board drills many words at
  once, so one button can't speak for all of them). It flags the word; the
  learner just answers the exercise in front of them.
- **Word detail modal** (`WordProgressModal`, reachable by tapping any word in a
  batch on Home) — an "I already know this word" action with an Undo, and the
  per-dimension pills drop to `/1`.
