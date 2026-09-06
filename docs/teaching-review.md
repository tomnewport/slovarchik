# Review of the teaching approach

A read of the curriculum and the learning engine as a *pedagogy*, not as code:
what the app teaches, what the corpus can support, where the two don't meet.

Every figure below was measured against the corpus and the real `src/lib`
modules at the time of writing. The throughput numbers come from a simulation
driving the actual engine (`assembleSession` → `buildExercises` → `wordState`),
described in [Throughput](#the-main-deficiency-throughput-and-the-accuracy-cliff).

---

## 1. What the approach is

Four **dimensions** of knowing a word — identification, usage, hearing,
speaking — at two **levels**, learning and mastery (mastery swaps speaking and
hearing for `context`, restoring an inflection inside a natural phrase). A word
is `learned` when all four learning criteria hold, `mastered` when the three
mastery ones do. Criteria are sliding windows (3 of the last 4; 2 of the last 3
across 2 distinct days at mastery), so a word can slip back down.

Words are committed in **batches** — 20 vocabulary + 3 glue words, drawn from
the lowest CEFR level with any eligible words, anchored on a collection. A
**session** is 4/12/20 practices split 25% at-risk, 25% due, 50% current batch,
with a third reserved for mastery when a mastery batch is live. Practice types
are chosen by weighted draw, the weight proportional to how far each dimension
still is from closing its criteria.

Underneath sits a simplified FSRS-style scheduler: per-dimension stability that
grows with spacing (more for an unhinted answer) and halves on a miss.

This is a coherent and unusually well-specified design. Nothing below argues
with its shape.

---

## 2. Corpus quality

### What is genuinely strong

| | |
| --- | --- |
| Learnable entries | 4,249 (+2,501 gloss-only, never drilled) |
| Distinct example sentences | ~16,200 |
| Entries with ≥1 example | 4,243 of 4,249 (6 missing, all nouns/verbs) |
| Grammar rules written | 64, with title + formula + prose |
| Unit tests | 34,465 passing |

The data-integrity discipline is the best thing here and is not common. Stress
is machine-audited three ways, including position-divergence on *unannotated*
tokens. Morphology has a golden-paradigm oracle. First-person example sentences
are gender-balanced to within 0.6 points (50.3% m / 49.7% f). The
prompt-ambiguity budget is enforced at **zero unanswerable prompts** — 589
English glosses are shared by 1,346 headwords ("to call" covers seven Russian
verbs) and every collision is resolved by an authored hint or a ты/вы + gender
annotation. Aspect pairs are asserted not to straddle CEFR levels. Coverage
against the standard frequency list has ~66 words outstanding, essentially all
non-core (`нквд`, `мем`, `вай-фай`).

Case coverage in noun examples is well shaped and matches natural frequency:

```
acc 26.4%   nom 25.2%   gen 18.5%   pre 12.8%   ins 10.0%   dat 6.6%   loc 0.6%
```

### Gap 1 — example sentences outrun the word they teach

Nothing checks that a word's example sentences are built from vocabulary at or
below that word's own level. They frequently are not:

| headword level | example sentences | contain a harder word | contain a word ≥2 CEFR bands harder |
| --- | ---: | ---: | ---: |
| A1 | 2,704 | **49%** | **15%** |
| A2 | 3,743 | 23% | 2% |
| B1 | 7,713 | 2% | 0% |

For A1 headwords the *hardest word in the sentence* lands at A1 only 51% of the
time; 14% of A1 sentences peak at B1 and 1% at B2. Concretely:

- `бабушка` [A1] → «Ба́бушка печёт вку́сные пироги́» — `печь` is B1
- `брат` [A1] → «Врач запреща́ет бра́ту кури́ть» — `запрещать` is B1
- `автобус` [A1] → «Авто́бус опозда́л на де́сять мину́т» — `опоздать` is B1

This matters because the phrase drills (`translate-phrase`, `listen-translate`,
`spell-phrase`, `dictation`, and the mastery `inflect-context`) draw a word's
**own** usage sentences. A learner in their first batch is asked to translate,
hear and type sentences assembled out of vocabulary they will not be offered
for another year of study. The word being taught is the easy part of its own
example.

Sentence length carries no gradient either — mean 4.6 words and p90 of 6 at
*every* level from A1 to C1. The corpus's only difficulty axis is the headword.

This is the one corpus dimension with no guard, in a repo that guards stress,
morphology, gender balance, prompt ambiguity, gloss coverage and CEFR cohorts.

### Gap 2 — adjective oblique cases are barely exampled

Adjective agreement outside the nominative is the canonical English-speaker
failure, and it is where the corpus is thinnest:

```
nom 54.0%   acc 25.6%   pre 4.0%   ins 2.9%   gen 1.9%   dat 1.6%
```

**355 of 506 adjectives (70%) have no oblique-case example at all.** The
mastery `context` drill can only ask what a sentence annotates, so for those
355 words it can never ask for the forms the drill exists to teach. Neuter is
6.3% of adjective annotations.

Nouns are much better served (90% have ≥1 oblique example), but the tables are
still sampled narrowly: only **6% of nouns have ≥4 distinct cases exampled**,
and **26.6% of stored declension cells have any context sentence**.

### Gap 3 — a third class of inert stored forms

The repo has already found this failure mode twice and built an oracle for each
time (`degreeCoverage.js` for comparatives, `participleCoverage.js` for
participles): a form is carefully authored, correctly stressed, and reachable
by no drill because no usage example annotates it. There are three more
instances, and one is large:

| stored form | entries storing it | entries with an example teaching it | inert |
| --- | ---: | ---: | ---: |
| Verb government (`governs:`) | 119 | **0** | **100%** |
| Adjective short form | 141 | 29 | 79% |
| Verb imperative | 408 | 242 | 41% |

Verb government is the striking one. There is a whole drill for it
(`/verb-government`, `verbGovernment.js`, eight rule ids, prepositional-variant
folding for о/об/обо) — and it runs on **84 phrases owned by 59 words, none of
which is one of the 119 verbs that declares a frame.** The government-annotated
sentences belong to the object nouns. A verb's `governs:` field reaches exactly
one surface in the app: the word card in `/vocab`. `помога́ть` + dative is
authored, tested by unit tests, and never asked.

The imperative gap is the everyday one. It is A1 grammar (`Скажи́те`,
`Дай`, `Извини́те`), 408 verbs store it, and it is 4.4% of all annotated verb
sentences.

### Gap 4 — half the verb corpus can't use the app's best drill

`buildContrastDrill` — pick the right member of an aspect (or motion) pair for
a set of English sentences, then conjugate it — is the most linguistically
ambitious exercise in the app, and the right answer to the hardest thing about
Russian for an English speaker.

**528 of 978 verbs (54%) carry no `pair:`**, so they fall back to typing a
table. 376 of the unpaired are B1 — precisely the band where aspect stops being
optional. There are zero dangling pair references, so this is missing data, not
broken data.

### Gap 5 — `daily life` is not a topic

54 collections, 246 words in none. `daily life` holds **1,016 words (24% of the
corpus)** and 170 of the 552 A1 words. `assembleOptions` ranks candidate
collections by size, so `daily life` is offered as batch option 1 for
essentially every learning batch — in a 180-session simulation it was the
name of every single batch drawn. The named-batch machinery works; it is being
starved by one bucket that isn't a subject.

---

## 3. Corpus completeness

Completeness against the *word list* is close to done: ~66 standard-frequency
words outstanding, all non-core. The A1 band has been read end to end three
times (see `CEFR-AUDIT.md`) and is genuine beginner vocabulary.

What is incomplete is not words but **forms and annotations** — Gaps 2–4 above
— plus one structural absence:

**There is no text above the sentence.** Mean example length 4.6 words, maximum
11, no dialogue, no paragraph, no connected discourse anywhere in the corpus or
the drills. For a curriculum that is 49% B1 and 16% B2 that is a ceiling: a B1
descriptor is about following extended speech and reading straightforward
connected text, and nothing in the app rehearses holding meaning across more
than one clause.

The CEFR distribution itself is defensible but top-loaded for a learner:

```
A1  552 (13.0%)    A2  926 (21.8%)    B1 2081 (49.0%)    B2 665 (15.7%)   C1 25
```

B1 at 49% is acknowledged in `CEFR-AUDIT.md` as a judgement call already
screened once. I'd leave it alone; the throughput problem below means almost no
learner reaches it.

---

## 4. Exercise structure

### What works

- **The bank-before-keyboard gate.** A table is only typed from memory after it
  has been assembled from a word bank — including when the bank exercise is
  merely *planned* later in the same session. That is a real difficulty ladder.
- **Mastery discipline.** Mastery exercises never widen past the committed
  batch, even when that means emitting fewer exercises, because doing so would
  record mastery events on words that aren't being mastered. Rare rigour.
- **Day-blocked dimensions are de-weighted.** A criterion that can only be
  advanced by tomorrow's calendar stops eating today's slots.
- **The rule oracle's restraint.** It fires only for rules a learner could
  *state* (the seven-letter rule, animacy, single-case prepositions) and
  deliberately stays silent on ordinary declension gaps, because there the gap
  is the lesson. Getting that boundary right is harder than it looks.
- **Wrong-answer diagnosis.** `confusables.js` tells an aspect partner from a
  synonym from a wrong form, in both directions, and keeps the card open rather
  than revealing when the guess was a real gloss of a related word.
- **Intro cards.** Just-in-time, never after the word has already been met in
  the session, capped at five.

### Gap 6 — there is no recognition tier for words

The vocabulary "easy" drill is no longer four-choice matching (#473 replaced it
with a type-ahead). It is now **typed free recall**: see the Russian, produce
the English, with an autocomplete that only appears once the guess has already
narrowed the field to under ten candidates.

So the *easiest* word exercise in the app is free recall, and the word-level
ladder is free recall → production (type the Russian from English). Phrases have
a scaffolded rung — the word bank — but words do not. Standard sequencing is
recognition → cued recall → free recall, and the missing bottom rung is exactly
what would let a learner build the accuracy the batch gate demands (§6).

(`README.md:25` still advertises "Match — pick the right translation (4
choices)". That's stale.)

### Gap 7 — free practice is invisible to the model

`/declension`, `/verbs`, `/adjectives`, `/pronouns`, `/phrases`, `/listening`,
`/speaking` and `/phrase-fix` record **no attempts**. `InflectionView` touches
the progress store only to mark a table "clean"; the rest don't import it at
all. Only the guided session and the hands-free `/practice` feed the model.

The consequence is sharper than it sounds: the app's richest grammar surface —
the drag table, blind endings, the paradigm-shape notes, the rule reveals with
formula and sibling contrast — sits entirely outside the progression system.
An hour of declension practice moves nothing.

### Gap 8 — stress is never produced or tested

`stripStress` is applied at grading time in every typed drill. The learner sees
stress and hears it (TTS renders it), and is never once asked to place it.

Set against how much the corpus invests in stress — `check-stress.mjs`,
`stressGolden.js`, homoglyph detection, annotated-slot verification,
unannotated position divergence — this is the largest asymmetry between what
the data knows and what the app asks. Russian stress is unpredictable,
meaning-bearing (`сто́ит`/`стои́т`, `го́рода`/`города́`), and the corpus already
holds the answer for every form.

### Gap 9 — grammar is taught only by failing

All 64 rules surface exclusively in a **post-attempt reveal**. There is no
browsable reference route and no pre-teach. Worse, the richest presentation —
`PhraseFixExercise`, which shows the formula, the explanation and the sibling
rule it is best read against — belongs to `inflect-context`, a **mastery** drill.
In simulation a learner at 85% accuracy masters 27 words in six months, so for
practical purposes most of the written grammar is unreachable.

### Gap 10 — no persistent modality waiver

`speaking` (3 attempts) and `hearing` are hard requirements for every word to
reach `learned`. There is a self-assessment fallback where recognition is
unsupported, and a per-session "Skip speaking" — but skipping is per-session
only, so a learner who does not want to speak aloud (on a train, in an office,
by preference) has no supported path: every word they own stalls one dimension
short, permanently.

---

## 5. The main deficiency: throughput and the accuracy cliff

### Method

A deterministic simulation drives the real engine — `assembleSession`,
`buildExercises`, `wordState`, `reviewSchedule`, `buildBatchOptions` — over the
real corpus, with the at-risk and lost pools computed as `stores/progress.js`
computes them. The learner answers each attempt correctly with a fixed
probability *p*, independent of dimension. 180 consecutive days, one "normal"
(12-practice) session per day. Verified stable across three RNG seeds.

*p* is per-attempt accuracy across **all four dimensions**, including typing
Russian from an English prompt unaided and speaking aloud. 80% on that mix is a
good learner, not a struggling one.

### Result

| per-attempt accuracy | batches completed | words reaching `learned`+ | median attempts per committed word | exercises done |
| ---: | ---: | ---: | ---: | ---: |
| 0.75 | **0** | 23 | **680** | ~6,100 |
| 0.80 | 3 | 80 | 201 | ~6,400 |
| 0.85 | 10 | 146 | 80 | ~6,650 |
| 0.90 | 14 | 183 | 76 | ~6,450 |
| 1.00 (perfect) | 40 | 231 | 55 | ~6,770 |

At **p = 0.75 the learner completes no batch in six months.** They do ~6,100
exercises — a median of **680 attempts on each of the same 23 words** — and end
where they started. That is the "Duolingo kept drilling the same tiny slice"
complaint in the README, reproduced by a different mechanism.

The cliff sits between 0.75 and 0.85, inside the range of a perfectly
respectable learner. Above 0.85 the engine behaves reasonably (~150–180 words
in six months of daily practice — modest, but sane).

### Mechanism

Batch completion is `batchComplete()`: **every** word in the batch at or above
target, evaluated simultaneously. Each word needs three sliding-window criteria
to hold at once, and a window *un-meets* on a miss. The probability a 3-of-last-4
window holds is `p⁴ + 4p³(1−p)`:

| p | one window | three windows | 23 words at once |
| ---: | ---: | ---: | ---: |
| 0.75 | 0.74 | 0.40 | ~1e-9 |
| 0.80 | 0.82 | 0.55 | ~1e-6 |
| 0.85 | 0.89 | 0.71 | ~3e-4 |
| 0.90 | 0.95 | 0.85 | ~0.03 |

(An independence approximation, so it overstates the difficulty — the engine
deliberately steers practice at the weakest word and dimension, which
correlates the windows favourably. The simulation is the reliable number; the
algebra explains its shape.)

It is coupon-collecting with expiring coupons. Because the refresh buckets keep
re-testing words that are already `learned` **while they are still in the
batch**, every retest is a fresh chance to knock one back out. There is no
ratchet: `wordState` recomputes from scratch every time, by design.

Two aggravating factors:

1. **The progress bar recedes.** `batchExerciseProgress` recomputes `remaining`
   from current events, so a slip *increases* it and the bar visibly goes
   backwards.
2. **There is no stall affordance.** The only escape from a stuck batch is to
   open `WordProgressModal` on the offending word and choose "leave for later",
   one word at a time. Nothing tells the learner the batch has stalled, and
   `advanceBatch` is only ever called on completion.

The design intent — words *should* be able to slip — is right. The defect is
that slippage is wired to a conjunctive, 23-wide, all-at-once gate.

---

## 6. Routes for improvement, ranked

**1. Break the conjunctive batch gate.** Highest impact by a wide margin;
everything else is polish until this is fixed. Options, roughly in order of how
much they change the model:

- Ratchet at the word level: once a word reaches `learned`, require *two*
  consecutive failed windows (or a failed confirmation review) to demote it, so
  a single slip on a word already banked doesn't re-open the batch.
- Complete a batch at a threshold (e.g. 90% of words at target) and roll the
  stragglers into the next batch, which is what a teacher does.
- Stop the refresh buckets from re-testing words that are still in the open
  batch — let a word settle before it is put at risk again.
- Failing all that: surface the stall. "17 of 23 done, 3 keep slipping — move
  on and keep practising these?" A visible, one-tap escape converts a silent
  six-month trap into a choice.

**2. Add a recognition tier for words.** A four-choice or tap-the-match rung
below typed free recall, gated to a word's first N encounters. This raises
early-encounter accuracy directly, which is the input the batch gate is most
sensitive to. It also restores what `README.md:25` still promises.

**3. Wire free practice into the progression model.** `/declension`,
`/phrase-fix`, `/listening`, `/speaking` already produce graded outcomes; they
just don't record them. Recording learning-level attempts is low-risk (the
mastery-scope guard already exists as a template for what *not* to record). It
gives learners a second route to progress that isn't the stalling one.

**4. Guard example-sentence level.** A corpus oracle in the mould of the
existing ones: flag a usage sentence whose hardest word sits ≥2 CEFR bands
above its headword. ~400 A1 sentences would flag. Fixing them is authoring
work, but the guard stops the drift — which is the pattern that has worked for
stress, gender and prompts.

**5. A third inert-form oracle**, covering `governs:`, imperatives and short
forms — a direct sibling of `degreeCoverage` and `participleCoverage`. Then
close the holes it reports. The 119 verbs with an unreachable `governs:` frame
are the biggest single win in the corpus: the drill, the rules and the data all
exist and are not connected.

**6. Fill adjective oblique-case examples.** Roughly one sentence each for 355
adjectives, in gen/dat/ins/pre, would take the mastery context drill from
"mostly nominative" to actually teaching agreement.

**7. Surface the grammar proactively.** A browsable route over the 64 rules
costs almost nothing and makes written content that already exists reachable
without failing first. A stronger version: show the rule *before* the first
drill of a case, not only after a miss.

**8. Aspect pairs for the unpaired 528 verbs**, prioritising the 376 at B1.
Unlocks the contrast drill for the half of the verb corpus that currently can't
run it.

**9. Split `daily life`.** 1,016 words is a bucket, not a topic; it currently
crowds out every real collection at the top of the batch menu.

**10. A stress drill.** The data is there for every form, audited three ways.
"Where does the stress fall?" is a cheap exercise (two-to-four choice over the
word's vowels) that tests something nothing else tests.

**11. A persistent modality waiver** in settings, waiving `speaking` (and
`hearing`) at the criteria level rather than per session, so a silent learner
has a supported path instead of permanently stalled words.

**12. Content above the sentence** — a short dialogue or paragraph tier for
B1+. The biggest piece of work here and the one to do last, but it is the
ceiling on what the app can claim to teach.

---

## Summary

The corpus is in good shape and the data discipline around it is better than
most commercial products. The engine's design is thoughtful and unusually
explicit about its own reasoning.

The two things holding it back are one bug-shaped defect and one gap:

- **Batch completion is a conjunctive all-at-once gate over sliding windows
  that can un-meet**, so learner throughput collapses below ~85% accuracy —
  6,000 exercises and no progress at 75%.
- **Carefully authored data does not reach a drill** — verb government (100%
  unreachable), adjective short forms (79%), imperatives (41%), adjective
  oblique cases (70% of adjectives), and stress (never asked at all).

Both are tractable, and neither requires rethinking the approach.
