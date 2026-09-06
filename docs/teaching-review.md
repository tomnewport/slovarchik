# Review of the teaching approach

A read of the curriculum and the learning engine as a *pedagogy*, not as code:
what the app teaches, what the corpus can support, where the two don't meet.

Every figure below was measured against the corpus and the real `src/lib`
modules at the time of writing. The throughput numbers come from a simulation
driving the actual engine (`assembleSession` → `buildExercises` → `wordState`),
described in [Throughput](#5-throughput-what-the-batch-gate-actually-costs).

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

### Gap 1 — the dictionary is three implementations and three omissions

Example sentences routinely use vocabulary above their headword's level — 49%
of A1 sentences contain a harder word, 15% contain one two CEFR bands up. **This
is intended**: the design is comprehensible input, where the learner meets far
more words than they are asked to memorise and an on-screen dictionary carries
the rest. The underlying data is complete — measured with the real
`phraseHintTokens`, **100% of the 74,636 Cyrillic tokens in the example corpus
resolve to a gloss**, which is what the 2,501 `learn: false` glossary entries
buy, and getting to exactly zero misses is unusual.

The defect is not the corpus. It is that the dictionary is **not wired
consistently into the drills that need it**:

| exercise | Russian shown during the attempt | dictionary |
| --- | --- | --- |
| `translate-phrase` (WordBank, visual) | yes, as `HintablePhrase` | ✅ tap any word |
| `spell-phrase` / `dictation` (TypeExercise) | no — it is the answer | ✅ `❓ Dictionary` disclosure: RU + EN for every word, assessed word withheld, unpenalised |
| `listen-translate` (WordBank, audio) | **never**, before or after | ❌ |
| `repeat-phrase` (SpeakExercise) | plain text | ❌ |
| `inflect-context` (PhraseFixExercise) | plain `<span>{{ tok }}</span>` | ❌ |
| free `ListeningView` / `PhraseTesterView` | `HintablePhrase` | ✅ |

Three observations follow.

**`inflect-context` is the worst omission.** It renders the sentence
token-by-token as bare spans and asks the learner to choose the target's case,
gender and number — which cannot be done without parsing the preposition and
the surrounding nouns. It is also the mastery drill, so the deepest grammar work
in the app is the work done with the least support.

**`listen-translate` never reveals the written form at all.** `HintablePhrase`
sits on the `v-else` of `exercise.audio`, and the only plain render of
`exercise.ru` is inside the reorder-confirmation branch. Answer it right and the
spelling is never shown. Defensible for a hearing drill, but it means a word
heard and not known stays unknown.

**The free-practice views are better equipped than the guided session** — the
main path is the weaker one.

**The gloss layer is also progress-blind.** `HintablePhrase` glosses every token
identically whether the learner learned it a month ago or has never met it, and
no exercise varies phrase rendering by `stateOf`. Rendering not-yet-learned
words as bilingual chips (Russian + English inline) and learned words plain
would make the comprehensible-input contract *visible*: the learner can see at a
glance which words they are actually accountable for. The same applies to
word-bank tiles, where an English tile for an unlearned word could carry its
Russian.

Sentence length carries no gradient, incidentally: mean 4.6 words and p90 of 6
at *every* level from A1 to C1.

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
screened once. I'd leave it alone: at the throughput measured in §5 (130–160
words per 180 daily sessions) very few learners reach the band at all, so it is
not where a correction would be felt.

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
what would shorten the climb for every word (see route 4).

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

## 5. Throughput: what the batch gate actually costs

### A correction

An earlier draft of this review claimed that `batchComplete()` — every one of a
batch's 23 words at target simultaneously, each held by a sliding window that
un-meets on a miss — traps learners below ~85% accuracy, and that no batch
completes in six months at 75%. **That was an artefact of the model, not a
property of the app.** The simulation held per-attempt accuracy *constant per
word*, so a word drilled 680 times was no better known than on its first
attempt. A model like that cannot converge by construction, and it is precisely
the assumption the engine's targeting is built to defeat.

Re-run with accuracy that rises with exposure — `p(n) = a − (a − 0.35)·e^(−n/3)`
for the nth attempt on a given (word, dimension), `a` the learner's plateau on a
well-practised item — batches complete normally:

| plateau accuracy | batches completed | words reaching `learned`+ | sessions per batch |
| ---: | ---: | ---: | --- |
| 0.80 | 1 | 45 | — |
| 0.85 | 6 | 110 | — |
| 0.90 | 8 | 132 | — |
| 0.95 | 12 | 155 | 13, 17, 20, 18, 18, 16, 15, 15, 13, 14, 8, 12 |
| 0.99 | 13 | 173 | — |

### The targeting works

The mechanism that saves it is exactly the one the design intends. Measured
over a 180-session run at plateau 0.95: **71% of all attempts landing on
open-batch words go to words not yet at target**, even though at any given
moment most of the batch is already done. `currentPool` sorts worst-understood
first, `drawN` front-biases the current bucket, `levelGapByDimension` weights
each dimension by how far it still is from closing, and the current bucket
narrows to words the slot's *own* dimension can still advance. Practice
concentrates on the laggards, and the batch closes.

The UI supports it too: the Home dashboard lists batch words **sorted not-done
first**, each with per-dimension pips naming exactly what it still owes, and a
tap opens `WordProgressModal` with "leave for later". The stall affordance I
said was missing is already there, one tap from the row that sorts to the top.

### What does survive

**Batch duration is set by the slowest word in the batch.** A 23-word
conjunctive gate means the batch is only as fast as its worst member, so a few
words a learner genuinely can't get stretch it badly. Modelling that — most
words plateau at 0.95, a fraction plateau low:

| fraction of hard words | their plateau | batches in 180 sessions | words learned | sessions per batch |
| ---: | ---: | ---: | ---: | --- |
| 0 | — | 12 | 155 | 13–20 |
| 5% | 0.60 | 6 | 104 | 12, 17, **62**, 24, **39**, 16 |
| 10% | 0.70 | 7 | 121 | 29, 19, 25, 31, 17, 28, 19 |
| 10% | 0.60 | 5 | 100 | **56**, 26, 36, 21, 24 |
| 10% | 0.50 | 1 | 31 | **168** |

A typical batch runs 13–20 sessions. Two or three genuinely hard words in it
make that 40–60. Ten percent of words at 50% plateau — a learner with a real
blind spot — is a 168-session batch, which is the trap regime, just reached by
a different road and by far fewer learners than I originally claimed.

This is a long tail, not a stall, and the escape hatch exists. The only thing
worth doing about it is making the tail visible *as a tail*: the dashboard shows
which words are outstanding but says nothing about how long this batch has been
open relative to normal. A batch on session 45 looks exactly like a batch on
session 8. A single line — "this batch has been open much longer than usual;
these two words are holding it" — turns an invisible slog into a decision, using
machinery that is already built.

**Absolute throughput is modest, and that is a design choice.** Every model I
ran, fixed-accuracy or learning-curve, lands in the same place: **130–160 words
in 180 daily sessions**, roughly 45 exercises per word learned, ~0.8 words a
day. That is the honest price of four dimensions at two levels with overnight
confirmation, and it buys depth an Anki deck does not. It is worth stating
plainly somewhere the learner can see, because at that rate the 4,249-word
corpus is a multi-year commitment and the B1 half of it is largely theoretical.

---

## 6. Routes for improvement, ranked

**1. One glossed-phrase component, used by every phrase-bearing exercise, and
made progress-aware.** Extract the shared component, adopt it in
`inflect-context`, `listen-translate` and `repeat-phrase`, and let it render
not-yet-learned words as bilingual chips. This is the highest-value change in
the list: it closes three omissions, collapses three implementations into one,
and turns an implicit design contract into something the learner can see.

**2. A third inert-form oracle**, covering `governs:`, imperatives and short
forms — a direct sibling of `degreeCoverage` and `participleCoverage`. Then
close the holes it reports. The 119 verbs with an unreachable `governs:` frame
are the biggest single win in the corpus: the drill, the rules and the data all
exist and are simply not connected to each other.

**3. Fill adjective oblique-case examples.** Roughly one sentence each for the
355 adjectives that have none, in gen/dat/ins/pre, would take the mastery
context drill from "mostly nominative" to actually teaching agreement.

**4. Add a recognition tier for words.** A four-choice or tap-the-match rung
below typed free recall, gated to a word's first few encounters. The
learning-curve model above starts words at 35% accuracy for a reason: the
current first encounter of a word is a typed free-recall miss. A recognition
rung shortens the climb for every word, which is the one lever that moves
throughput without weakening any criterion. It also restores what
`README.md:25` still promises.

**5. Wire free practice into the progression model.** `/declension`,
`/phrase-fix`, `/listening`, `/speaking` already produce graded outcomes; they
just don't record them. Recording learning-level attempts is low-risk (the
mastery-scope guard is a ready template for what *not* to record), and it gives
a learner a second route to progress.

**6. Surface batch age.** One line on the dashboard when a batch has been open
well beyond typical, naming the one or two words holding it. Everything needed
is already computed.

**7. Surface the grammar proactively.** A browsable route over the 64 rules
costs almost nothing and makes written content that already exists reachable
without failing first. Stronger version: show the rule *before* the first drill
of a case, not only after a miss.

**8. Aspect pairs for the unpaired 528 verbs**, prioritising the 376 at B1.
Unlocks the contrast drill for the half of the verb corpus that can't run it.

**9. Split `daily life`.** 1,016 words is a bucket, not a topic; it crowds out
every real collection at the top of the batch menu.

**10. A stress drill.** The data is there for every form, audited three ways.
"Where does the stress fall?" is a cheap exercise (two-to-four choice over the
word's vowels) that tests something nothing else tests.

**11. A persistent modality waiver** in settings, waiving `speaking` (and
`hearing`) at the criteria level rather than per session, so a learner who
won't speak aloud has a supported path instead of permanently stalled words.

**12. Content above the sentence** — a short dialogue or paragraph tier for
B1+. The biggest piece of work here and the one to do last, but it is the
ceiling on what the app can claim to teach.

---

## Summary

The corpus is in good shape and the data discipline around it is better than
most commercial products. The engine's design is thoughtful, unusually explicit
about its own reasoning, and — tested against a learner who actually learns —
it converges: practice concentrates on the laggards, batches close in 13–20
sessions, and the dashboard already names the words holding one up.

The real gap is not in the engine, and it is not the corpus's over-level
vocabulary — that is deliberate comprehensible input backed by a gloss layer
with 100% token coverage. It is **wiring**: authored data and built machinery
that never reach the learner.

- The dictionary exists in three different forms and is absent from three
  exercises, including the mastery context drill where it matters most.
- Verb government is 100% unreachable (119 verbs, a whole drill, and the two
  never meet), adjective short forms 79%, imperatives 41%.
- 70% of adjectives have no oblique-case example, so the drill that teaches
  agreement mostly cannot.
- Stress is audited three ways and never once asked for.

All of it is tractable, and none of it requires rethinking the approach.

---

## 7. Issues this review would raise

Grouped by theme, roughly in the order I'd file them. Sizes are rough: **S** a
session's work, **M** a focused change, **L** sustained authoring or design.

### A. Dictionary consistency

| # | Issue | Size |
| --- | --- | --- |
| 1 | **Extract one glossed-phrase component and use it in every phrase-bearing exercise.** Today: `HintablePhrase` in `WordBankExercise` (visual only), a `❓ Dictionary` disclosure in `TypeExercise`, and nothing in three others. Three implementations of one idea. | M |
| 2 | **`inflect-context` has no dictionary.** `PhraseFixExercise` renders the sentence as bare `<span>{{ tok }}</span>` during the attempt, then asks for case/gender/number — which needs the preposition and surrounding nouns parsed. The mastery drill is the least supported one. | S |
| 3 | **`listen-translate` never shows the Russian, before or after grading.** `HintablePhrase` is on the `v-else` of `exercise.audio`; the only plain render is in the reorder-confirm branch. Reveal the glossed sentence after grading. | S |
| 4 | **`repeat-phrase` shows the Russian as plain text.** Pronunciation is what's assessed, so a gloss costs nothing and stops the learner reciting a sentence they can't parse. | S |
| 5 | **Make the gloss layer progress-aware: bilingual chips for unlearned words.** `HintablePhrase` is blind to `stateOf`, and no exercise varies phrase rendering by word state. Render not-yet-learned words as RU+EN chips, learned words plain — so the learner can see which words they are actually accountable for. Extend to word-bank tiles (an English tile for an unlearned word carries its Russian). | M |
| 6 | **`MIN_ENCOUNTERS_FOR_SPELLING` checks only the sentence's owning word** (`p.source`), never the others in it. Lower priority now the `❓ Dictionary` is confirmed present, but the gate is asymmetric with what it claims to protect. | S |

### B. Authored data that reaches no drill

| # | Issue | Size |
| --- | --- | --- |
| 7 | **Verb government is 100% unreachable.** 119 verbs declare `governs:`; not one owns a government-annotated sentence. `/verb-government` runs on 84 phrases owned by *nouns*. The frame surfaces only on the `/vocab` word card. Drill, rules and data all exist and never meet. | M |
| 8 | **Add a third coverage oracle** — sibling of `degreeCoverage.js` / `participleCoverage.js` — for `governs:`, imperatives and short forms, with a test asserting zero, so these can't re-accumulate. | S |
| 9 | **Imperative examples missing for 166 of 408 verbs (41%)** that store one. A1 grammar (`Скажи́те`, `Дай`), 4.4% of annotated verb sentences. | L |
| 10 | **Adjective short forms: 112 of 141 (79%) inert.** Stored, stressed, unreachable. | L |
| 11 | **Adjective oblique cases: 355 of 506 adjectives (70%) have no gen/dat/ins/pre example.** Annotations are 54% nominative, 26% accusative. The mastery context drill mostly cannot teach agreement — the thing it exists for. | L |

### C. Corpus

| # | Issue | Size |
| --- | --- | --- |
| 12 | **528 of 978 verbs (54%) carry no aspect `pair:`**, 376 of them at B1, so `buildContrastDrill` — the app's best exercise — can't run for half the verb corpus. Zero dangling refs, so this is missing data, not broken data. | L |
| 13 | **Split `daily life`.** 1,016 words (24% of the corpus), 170 of the 552 A1 words. `assembleOptions` ranks by size, so it heads the batch menu essentially always. | M |
| 14 | **Only 6% of nouns have ≥4 distinct cases exampled**; 26.6% of stored declension cells have any context sentence. The context drill samples each table narrowly. | L |

### D. Exercise structure

| # | Issue | Size |
| --- | --- | --- |
| 15 | **No recognition tier for words.** The easiest word exercise is typed free recall; there is no rung below it. Gating a 4-choice/tap-match rung to a word's first few encounters shortens the climb for every word. | M |
| 16 | **Free practice records no attempts.** `/declension`, `/verbs`, `/adjectives`, `/pronouns`, `/phrases`, `/listening`, `/speaking`, `/phrase-fix` all produce graded outcomes and feed nothing back. `InflectionView` touches the store only to mark a table clean. | M |
| 17 | **Grammar is reveal-only.** 64 written rules, no browsable route, and the richest presentation sits inside a mastery drill most learners barely reach. | M |
| 18 | **Stress is never produced or tested** — stripped at grading everywhere, despite three audit layers holding the correct placement for every form. A "where does the stress fall?" drill over the word's vowels is cheap. | M |
| 19 | **No persistent modality waiver.** `speaking` (3 attempts) and `hearing` are hard requirements for every word; "Skip speaking" is per-session only. | S |
| 20 | **Surface batch age.** A batch on session 45 looks identical to one on session 8. Name the one or two words holding it — everything needed is already computed. | S |
| 21 | **Nothing above sentence level.** Mean 4.6 words, max 11, no dialogue or paragraph, for a corpus 65% at B1+. | L |

### E. Documentation

| # | Issue | Size |
| --- | --- | --- |
| 22 | **`README.md:25` is stale** — still advertises "Match — pick the right translation (4 choices)", replaced by the type-ahead in #473. | S |
