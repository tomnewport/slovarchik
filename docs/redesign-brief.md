# Slovarchik — redesign brief for Claude Design

**Deliverable requested:** a multi-artboard design canvas covering the app's
screens, states and shared components, at the fidelity of a UI mockup that an
engineer could build from directly.

**Read this whole document before drawing.** Sections 1–4 are the product truth
the design has to respect; sections 5–9 are the actual design work; sections
10–12 are constraints, sample data and open decisions.

---

## 1. What the product is

**Slovarchik** (Словарчик, "little dictionary") is an offline-first PWA for one
person's serious, long-haul study of Russian vocabulary. It is not a gamified
language app that teaches phrases; it is a **rigorous vocabulary trainer** whose
whole claim is that spelling, grammatical form and inflection are graded
properly. A word does not count as "learned" because you recognised it once.

Facts that shape everything:

- **No backend, no account, no sync.** All progress lives in the learner's
  browser (IndexedDB). Losing the device loses the data unless they exported a
  backup. This is why a Settings screen with backup/restore matters more than it
  normally would.
- **Fully offline.** Installed as a PWA, service-worker cached. Every screen must
  work with no network. Nothing may depend on a remote image, font CDN or API.
- **One user archetype.** A committed adult self-learner, using the app daily,
  mostly on a phone, often in short sittings. They already know the app. They do
  not need onboarding, marketing copy or persuasion — they need the friction
  between opening the app and answering the first question to be near zero.
- **Corpus size:** ~4,250 taught words (2,177 nouns, 979 verbs, 506 adjectives,
  322 adverbs, plus pronouns, prepositions, numerals, conjunctions,
  interjections, calendar terms), each with CEFR level, topic collections,
  authored example sentences, and full inflection tables where they inflect.
  A further ~2,500 glossary entries support example sentences. The curriculum is
  split into **parts** of ~500 words ("A1 Part I", "A2 Part II", … through
  "C1 Part I").

### The success metric

**The number of words learned and mastered.** That pair of numbers is the score
the user is playing for. It is currently a small pill in the header. In the
redesign it should be unmistakably the headline figure of the app — visible on
Home, and the subject of the Progress screen.

---

## 2. The learning model (do not simplify this away)

The visual design must express this model accurately. Simplifying the *interface*
is the goal; simplifying the *model* is not.

### 2.1 Word states

Every word moves through four states, and can **slip backwards**:

```
unknown  →  learning  →  learned  →  mastered
```

| State | Meaning |
| --- | --- |
| `unknown` | Never seen in an exercise. |
| `learning` | Seen at least once, criteria not yet met. |
| `learned` | Spelled, identified and heard consistently. |
| `mastered` | Also inflected correctly, and used correctly inside a real phrase. |

Slipping is a first-class idea: a mastered word that fails two recent inflection
attempts drops to `learned`. The design needs a visual language for "went
backwards" that is honest but not punishing.

### 2.2 The five dimensions of knowing a word

Progress is tracked per word across five skill **dimensions**, at two **levels**
(learning and mastery). These pips/badges appear all over the app and need a
proper icon set (they are currently emoji — see §7.4).

| Dimension | Current emoji | What it means | Graded at |
| --- | --- | --- | --- |
| `identification` | 👁️ | Recognise it: RU → EN. | learning + mastery |
| `usage` | ✍️ | Produce it: spell it correctly, EN → RU. | learning + mastery |
| `hearing` | 👂 | Understand it spoken. | learning only |
| `speaking` | 🗣️ | Say it aloud. | learning only |
| `context` | 🛠️ | Put the right *form* of it into a real sentence. | mastery only |

So: **learning** needs identification + usage + hearing + speaking.
**Mastery** needs identification + usage + context — each to a higher standard.

### 2.3 The criteria (why a word is stuck)

This is the substance of the "why haven't I progressed on this word" question the
batch/word inspection screens must answer.

- Learning, per dimension: **3 correct of the last 4 attempts** (speaking: just
  3 attempts, correctness not graded).
- Mastery, per dimension: **2 correct of the last 3 attempts, spread across at
  least 2 distinct calendar days.** The day-spacing requirement is deliberate —
  it proves memory across a night, not a lucky streak in one sitting.
- A word can be flagged **"I already know this word"**, which relaxes every
  threshold to a single correct answer per dimension.
- A word that meets its criteria but hasn't yet passed its overnight
  confirmation review is **pending** (currently shown with an ⏳).

Two states derived from this are the "problem words" the user wants to inspect:

- **At risk** — currently meets criteria, but the most recent attempt in some
  dimension was wrong. One slip from dropping.
- **Slipped** — has fallen below the best state it ever reached.

### 2.4 Batches

The learner works in **batches**, and this is the daily unit of grind:

- A **learning batch** — a named set of words (usually a topic collection, e.g.
  "food and drink", "travel"), chosen by the learner when the previous one
  completes.
- A **mastery batch** — auto-selected from words already learned, running in
  parallel with the learning batch.

A batch is complete when every word in it meets its criteria at that level. Batch
completion is the app's big celebratory moment. Two progress signals exist per
batch and both are useful:

1. **Words done / total** (e.g. 14 / 20) — the headline.
2. **Exercise progress** — how many exercises remain versus how many the batch
   needed when freshly committed. This moves within a session even when no word
   finishes, so it is what makes a session feel productive.

### 2.5 Session assembly

The app decides what to practise. A session is a list of **practices** (a
practice is a group of same-type exercises). Composition:

- A third of the slots go to the mastery batch, the rest to learning (when both
  exist).
- Learning slots split **25% at-risk / 25% not-tested-recently / 50% current
  batch**.
- Each slot's exercise type is weighted toward the learner's weakest dimension.
- Wrong answers are re-queued and repeated until they're right ("Fixing
  mistakes…" phase at the end of a session).
- A brand-new word gets a non-graded **intro card** before its first exercise.

**This is the key simplification the redesign exists to express: the user never
needs to choose what to practise, only how long to practise for.**

---

## 3. The user's journeys, by time spent

| Journey | Share of in-app time | Design consequence |
| --- | --- | --- |
| Doing a practice session | **92%** | This is the app. Every pixel of the session screens earns its place. Spend the design budget here. |
| Reviewing open batches / problem words | **5%** | Deep, information-dense, inspectable. Reachable in one tap from Home but not competing with the Start button. |
| Reviewing progress over time | **3%** | A satisfying, occasional read. Charts and milestones. |

Settings (backup, versions, preferences) is a rare-visit utility screen.

---

## 4. What is wrong with the current design

The current Home screen stacks, top to bottom: an update banner, a pending-reports
list, two batch progress bars, a 3-button "standard session" card, a hands-free
card, **five** focused-session buttons (Speaking / Listening / Words / Phrases /
Grammar), an at-risk word list, a slipped word list, two full batch word lists
with per-word dimension pips, and a collapsed "Free practice" section containing
**eleven** untracked drill links. It is a control panel, not a launchpad.

### Explicit direction from the product owner

- **Remove the Home clutter.** The user does not need a choice of practice types.
  Choosing what to drill is the app's job.
- **Keep** the ability to inspect the current learning batch, the mastery batch,
  and problem words — but **move it down the information hierarchy**, off the
  Home screen's primary surface.
- **Home's job is to start a practice session**, with a choice of session size
  and no further configuration.
- Nothing else about the learning engine changes.

### What to cut, keep or demote

| Current element | Verdict |
| --- | --- |
| Standard session, 3 sizes | **Keep — this becomes the hero.** |
| 5 focused-session buttons (Speaking/Listening/Words/Phrases/Grammar) | **Cut from Home.** The engine already weights toward weak dimensions. |
| 11 "Free practice" untracked drill links | **Cut from Home.** See §12 open decision 2. |
| Hands-free (voice-only) session | **Demote.** See §12 open decision 1. |
| Two batch progress bars | **Keep on Home, condensed** — they are the daily "am I getting anywhere". |
| At-risk / slipped word lists | **Move** into the batches screen. |
| Full batch word lists with pips | **Move** into the batches screen. |
| Update-available banner, pending issue reports | **Keep, but as system notices** — a compact, dismissible strip, not a card that outranks the Start button. |
| Learned / mastered counts (currently a header pill) | **Promote.** This is the score. |
| Streak + activity calendar | Keep, mainly on Progress; a small streak indicator on Home is welcome. |

---

## 5. Screen inventory — the artboards to produce

Primary canvas: **mobile, 390 × 844** (iPhone-class; the app is used on a phone
in portrait). Produce a **second, narrower pass at 360 × 800** only for screens
where the layout is genuinely at risk (the inflection table, the on-screen
keyboard). Produce a **desktop/tablet pass at 1024 × 900** for Home, Progress and
the Batches screen — the app currently just centres a 760px column, and a better
answer for wide viewports would be welcome.

Group the artboards on the canvas in three rows: **Session** (the 92%), **Home &
Batches**, **Progress & Settings**.

### Row A — Session (highest priority, most artboards)

| # | Artboard | What it shows |
| --- | --- | --- |
| A1 | **Session chrome — anatomy** | The persistent frame: close/exit control, session progress bar, "fixing mistakes" state. Annotated. |
| A2 | **Intro card** — new word | Non-graded introduction of a never-seen word. |
| A3 | **Spell the word** — question open | The EN→RU typing exercise, the app's single most common screen. |
| A4 | **Spell the word** — correct | Answer resolved, correct, with the word-facts panel revealed. |
| A5 | **Spell the word** — wrong | Answer revealed, error map, rule hint, facts panel. |
| A6 | **Retry state** | First attempt wrong, learner still trying: correction hint + error map, answer *not* revealed. |
| A7 | **Flashcard board** | Card *n* of 12, type-the-English with typeahead suggestions. |
| A8 | **Word bank (phrase)** | Translate a phrase by tapping word tiles into order. |
| A9 | **Inflection table** | Build the full case × number table by dragging/tapping forms into cells. |
| A10 | **Russian keyboard** | The custom on-screen Cyrillic keyboard, including its letter-hint state. Shown docked under A3. |
| A11 | **Session summary — ordinary** | % correct, duration, batch bars that moved, confirmed words, slipped words. |
| A12 | **Session summary — batch complete** | The celebration moment. |

### Row B — Home & Batches

| # | Artboard | What it shows |
| --- | --- | --- |
| B1 | **Home — steady state** | The main screen. Start, sizes, score, batch progress, one route down to batches and progress. |
| B2 | **Home — first run** | No batch committed yet; the only action is choosing what to learn. |
| B3 | **Home — with system notice** | Update-available strip in place. |
| B4 | **Choose next batch** | The list of offered word sets after finishing a batch. |
| B5 | **Batches overview** | Learning batch, mastery batch, at-risk and slipped words in one place. The "5%" screen. |
| B6 | **Batch detail** | One batch's full word list with per-word, per-dimension state. The at-a-glance learning-dimensions view. |
| B7 | **Word detail** | Everything about one word: state, per-dimension criteria progress with counts, dates, attempts, word facts, related words, easily-confused words, and the actions (mark known / leave for later). |

### Row C — Progress & Settings

| # | Artboard | What it shows |
| --- | --- | --- |
| C1 | **Progress** | The vocabulary-growth screen. |
| C2 | **Progress — curriculum detail** | Per-part / per-CEFR-level coverage and achievements. May be one scrolling artboard with C1. |
| C3 | **Settings** | Backup/restore, versions, preferences, reset. |

### Row D — System

| # | Artboard | What it shows |
| --- | --- | --- |
| D1 | **Component sheet** | Buttons, inputs, cards, chips, the dimension badge set, progress bars, the word row, state colours, type scale — light and dark. |

---

## 6. Screen-by-screen specification

### 6.1 Home (B1) — the launchpad

**One job: start a session.** The user should be able to open the app and be
answering a question in two taps.

Hierarchy, strongest to weakest:

1. **The score.** Words learned and words mastered. Two numbers, large, with a
   clear visual distinction between the two (learned is green-ish, mastered is
   gold in the current palette). This is the thing the user came to grow.
2. **Start practice**, with a size choice. Three sizes exist today — internally
   4 / 12 / 20 practices, labelled Quick / Normal / Super. **Design the size
   choice as a single control** (a segmented control, or three tap targets that
   *are* the start button) rather than a card containing three buttons. Prefer
   labelling by realistic duration ("~3 min / ~10 min / ~20 min") over opaque
   counts; the exact minute figures need confirming with engineering, so treat
   the numbers as placeholders and design for a two-line label (name + estimate).
   Requirement: **tapping a size starts the session immediately.** No confirm
   step, no further configuration.
3. **Today's ground covered.** The two batch bars — learning and mastery — with
   name, words done / total, and the finer exercise-progress bar. Compact: two
   rows, not two cards. Tapping either goes to B5/B6.
4. **A streak indicator.** Small. It is motivational garnish, not the score.
5. **Two quiet routes down:** *Batches* (→ B5) and *Progress* (→ C1). Plus
   Settings, which can live in a header affordance as it does today.

System notices (a waiting app update; queued offline issue reports) appear as a
**single compact strip above everything else**, never as a full card, and are
dismissible.

**First run (B2):** no batch exists. The screen collapses to a welcome and a
single call to action — choose the first set of words to learn. Show the
curriculum framing ("A1 Part I") so the learner understands the scale of what
they're starting.

### 6.2 The session screens (A1–A12) — where the design budget goes

The product owner's words: *"clear consistent screens which are visually exciting
but show a clear hierarchy of information. The question at hand takes pride of
place, but they also see their progress through the session, plus interesting
facts about the words they are learning which may aid in memorisation."*

There are **eight exercise types**, and they must feel like one family. Design a
single **exercise frame** and slot each type into it:

```
┌─────────────────────────────────────────┐
│  ✕            ▓▓▓▓▓▓▓░░░░░░░░           │  session chrome: exit + progress
├─────────────────────────────────────────┤
│  TASK LINE          (small, muted)      │  "Spell the word", "Complete the
│                                         │   table for…", "Type what you hear"
│                                         │
│         THE PROMPT                      │  the largest thing on screen
│                                         │
│         ── answer surface ──            │  input / tiles / table / cards
│                                         │
│         feedback + hints                │  appears in place, never as a toast
│                                         │
│         💡 about this word              │  post-answer only
├─────────────────────────────────────────┤
│  [ Check ]        I don't know          │  one primary, one quiet escape
└─────────────────────────────────────────┘
```

Rules that must survive the redesign:

- **One primary button at a time.** While a question is open, the only primary is
  *Check*. Once answered, the only primary is *Next →*. "I don't know" is
  deliberately visually quiet and placed far from where *Next* lands, so it can't
  be hit by muscle memory.
- **The word-facts panel appears only after the answer is resolved** — right,
  wrong, or given up. One of the fact types spells the word out morpheme by
  morpheme, so showing it earlier would give away the answer. Exception: the
  intro card (A2), where the word is being introduced, not tested.
- **Feedback is inline and specific**, never a generic tick. The app can say
  things like *"That's the imperfective — you were asked for the perfective"*, or
  *"After ж, ч, ш, щ you can't write ы"*. These correction and rule hints are
  short, two-part (headline + detail) and appear **while the learner is still
  trying**, without revealing the answer. Design a distinct treatment for them,
  separate from the after-the-fact answer reveal.
- **The error map**: after a wrong spelling attempt, the app shows where it went
  wrong, character by character — wrong letters flagged, gaps for omissions —
  *without showing the correct letters*. This needs a proper visual treatment;
  today it's a row of characters with classes.
- **The word-status flag**: when the current word is at-risk or slipped, the
  session says so. Small, top of the exercise.
- **Session progress** is a bar in the chrome. When the runner enters the
  repeat-mistakes phase it says "Fixing mistakes…" — that phase deserves a
  distinct, encouraging visual state rather than a muted caption.
- **Skip affordances** ("Skip listening", "Skip speaking", "I know this word",
  "Report an issue") sit in a low-priority row below the exercise. Keep them
  reachable, keep them out of the way.

**Per-exercise notes:**

- **A3–A6 Spell the word (Type)** — the highest-traffic screen. The prompt is
  English, sometimes with inline annotations (e.g. that the Russian must commit
  to informal *ты* vs formal *вы*, or to the speaker's gender, where the English
  hides it). A part-of-speech and aspect label may sit under the prompt. A
  "❓ Dictionary" disclosure reveals the phrase words the learner isn't expected
  to know yet, at no penalty. There is a **reorder mode**: when the learner got
  every word of a phrase right but in the wrong order, they rebuild it by tapping
  chips rather than retyping.
- **A7 Flashcard board** — 12 cards, RU shown (or spoken), type the English, with
  typeahead suggestions. Needs a clear "card 3 of 12" position indicator that
  doesn't compete with the session bar.
- **A8 Word bank** — a Russian phrase, an answer line, a bank of English word
  tiles including decoys. Tiles are also findable by typing. Includes a
  self-check step when the order differs but might still be faithful, showing
  the learner's answer against the reference translation.
- **A9 Inflection table** — the densest screen. A 6-case × 2-number grid (12
  cells for nouns; adjectives are larger — case × gender/number). Forms are
  dragged, tapped or keyboard-selected into cells. Big tables are dealt one
  column at a time. A note above the table can explain why *this* table is a
  different shape (a perfective verb has no present tense; an impersonal verb has
  no *я/ты* row). **This must work at 360px wide** — solving it well is the
  single hardest layout problem in the app.
- **A10 Russian keyboard** — a custom docked Cyrillic keyboard (it can't be
  assumed the device has one installed), with a shift key and a **hint mode**
  that lights up the next correct letter plus a couple of decoys. Using the hint
  costs the learner the "unaided" bonus. Design its docked relationship to the
  input clearly — it currently overlays the bottom of the viewport.

**A11/A12 Summary.** The ordinary summary shows percent correct on first try,
counts, duration, and — importantly — **the batch bars animating the ground
gained this session**, plus words confirmed by a spaced review and words that
slipped. The batch-complete variant (A12) is the app's biggest celebration; it
also carries any newly unlocked achievement badges and the route to choosing the
next batch. Make A12 genuinely special without becoming a different app.

### 6.3 Batches (B5, B6) and word detail (B7) — the 5%

*"Deep inspection to understand why they haven't yet progressed on a word."*

**B5 Batches overview** — one screen holding four things:

1. Learning batch: name, words done/total, both progress bars, and a compressed
   at-a-glance grid of its words' dimension states.
2. Mastery batch: the same.
3. **At risk** — words one wrong answer from slipping, with the dimension that's
   wobbling called out.
4. **Slipped** — words below their best state, with the dimensions that need
   recovering marked as *lost*, not merely *incomplete*. The current design
   stamps a small ✕ on the affected dimension badge; that distinction is worth
   keeping and improving.

**B6 Batch detail** — the full word list. Each row: the Russian (with its stress
mark), a short English gloss, and one badge per dimension in one of four states:

| Badge state | Meaning |
| --- | --- |
| **met** | Criterion satisfied. |
| **partial** | Attempted, not yet satisfied — and it should be possible to read *how close* (e.g. 2 of 3). |
| **empty** | Never attempted in this dimension. |
| **lost** | Was met, now isn't. |

Plus a **done** treatment for finished words and a **pending** treatment for
words awaiting their overnight confirmation. Rows are tappable → B7. There is
also a search-and-add control for pulling a specific word into the current batch.

Design note: at 390px a row must fit the Russian, a gloss and 4–5 badges. The
current answer is to let the gloss ellipsise and never the badges. Please improve
on it rather than inherit it — a two-line row is acceptable if it reads better.

**B7 Word detail** — currently a modal; it can stay a modal or become a sheet or
a full screen, your call. It must carry:

- Headword with stress mark, meaning, alternative meanings, CEFR chip,
  part-of-speech chip, aspect/motion contrast chip where relevant, and the
  current state.
- **Per level (Learning / Mastery), per dimension: the criterion and how far
  along it is.** This is the "why is this word stuck" answer and it should be
  legible at a glance — e.g. *Usage · 2 of 3 correct, needs a second day*.
- Best state ever reached, date learned, date mastered, total attempts, last seen.
- **Word facts** — the memorisation aid, and one of the app's nicest ideas:
  - a **morpheme breakdown** rendered as linked chips (e.g. `пере-` "across" +
    `-вод-` "lead" + `-ить` → *перевести*, "to translate"),
  - authored notes on root, origin, regional usage, or a mnemonic,
  - **related words** (derived and authored) with their relationship labelled,
  - **easily confused** words with a note on what distinguishes them,
  - each with a speak button, each tappable to open that word's card.
- Actions: *I already know this word* (relaxes the criteria) and *Leave for
  later* (removes from batch, with a keep-or-erase-progress choice).

### 6.4 Progress (C1, C2) — the 3%

*"See how their vocabulary has grown over time."* The elements, in priority order:

1. **Words learned and words mastered** — the score again, larger here than
   anywhere.
2. **A cumulative growth chart** over a real time axis (idle weeks take up
   width), stepped, with a learned line and a mastered line. This already exists
   as hand-drawn SVG with proper axes, gridlines and markers — design it
   properly.
3. **Streak** — current, best, best day, lifetime total — plus a
   contribution-calendar heat grid where each day's colour is the batch worked
   and the intensity reflects volume and accuracy. Horizontally scrolling,
   month labels above.
4. **Curriculum coverage** — one bar per part ("A2 Part I") or CEFR level,
   showing three nested quantities: words *met* (encountered in a sentence but
   never taught), words *learned*, and words *mastered*. Three-layer bar; the
   current version stacks three fills and it works — make it clearer.
5. **Achievements** — a badge grid, ~35 badges, earned and unearned, at word-count
   milestones (1, 5, 10, 20, 50, 100 … 600 learned; same for mastered), CEFR
   completions, and per-part half-way/complete badges. Locked badges should read
   as locked without being depressing.
6. Expandable lists of learned and mastered words.

### 6.5 Settings (C3)

Rare-visit utility. Sections, in this order:

1. **Your data is only in this browser** — a genuine warning, not boilerplate. No
   account, no server; clearing browser data loses everything.
2. **Backup** — copy JSON to clipboard, or download `.json`. Include the
   time-since-last-backup nudge that already exists (it fires after a week).
3. **Restore** — paste a backup; it replaces current progress. Needs a real
   confirmation and a clear success/failure result line.
4. **Versions** — app build date and commit, and per-dictionary-file last-updated
   dates, with buttons to check for dictionary updates and to reload for the
   latest app build.
5. **Preferences** — feedback sounds (three slots: correct, with-mistakes,
   batch-complete; each a set of named options plus Off, previewed on tap) and
   the "introduce a brand-new word before its first exercise" toggle.
6. **Reset** — delete everything, two-step confirm, visually separated as
   destructive.

The current screen calls itself "Your data" and is reached via a 🧑‍🚀 avatar in
the header. Renaming it *Settings* and giving it a conventional affordance is
fine and probably better.

---

## 7. Visual direction

### 7.1 Where it stands today

Dark-only, deep navy, one accent blue, semantic green/gold/red:

```
--bg          #0b1021    page background (with a radial glow toward top-right)
--bg-soft     #161d36    inset surfaces, inputs, secondary buttons
--card        #1d2745    card surface
--border      #2c3a63    hairlines
--text        #eef1fb
--muted       #97a2c7
--primary     #4f7dff    actions
--primary-ink #0039a6
--accent      #d52b1e    (Russian-flag red; barely used)
--good        #2ecc71    correct, "learning" level, learned words
--bad         #ff5c5c    wrong, slipped
--gold        #ffd166    "mastery" level, mastered words
--gold-ink    #5a4500
--radius      14px
font: 'Segoe UI', system-ui, -apple-system, sans-serif
layout: single centred column, max-width 760px, 1rem side padding
```

Two colour meanings are load-bearing throughout the app and should survive:
**green = learning / learned**, **gold = mastery / mastered**.

### 7.2 What we want from you

- A **considered palette** rather than an inherited one. Dark is the primary
  theme (the app is used in the evening) but please deliver **light and dark**
  token sets; the app currently hard-codes `color-scheme: dark`.
- **A real type scale**, including a Cyrillic-capable display face for headwords.
  See §8 on typography — this matters more here than in most apps.
- **Depth and energy in the session screens.** "Visually exciting" was the ask.
  Motion cues, a satisfying correct-answer moment, a batch bar that visibly
  climbs. The app already has a confetti burst component and celebration sounds;
  give them a home that feels designed rather than bolted on.
- **Restraint everywhere else.** Home, Batches, Progress and Settings should be
  calm; the excitement belongs to the questions and the summary.

### 7.3 Accessibility and ergonomics

- Contrast: WCAG AA minimum for body text, AAA where feasible for the prompt.
- **Never encode meaning in colour alone** — the dimension badges, the four badge
  states and the correct/wrong feedback all need a shape or glyph difference too.
- Touch targets ≥ 44px, especially the keyboard keys and the inflection-table
  cells.
- One-handed reachability: primary actions in the lower third.
- Respect `prefers-reduced-motion` — offer a still alternative for the celebration.
- Everything must be operable by keyboard; the inflection table already supports
  keyboard selection.

### 7.4 Iconography

The app currently leans hard on emoji: dimension pips (👁️ ✍️ 👂 🗣️ 🛠️), the
facts panel (💡), achievements (🌱 ⭐ 📚 💯 🏆 …), the streak flame (🔥), the
settings avatar (🧑‍🚀). Emoji render inconsistently across platforms and read as
unconsidered at this density.

**Please design a proper icon set for the five dimensions** — these are the most
repeated glyphs in the app, appearing several times per word row across dozens of
rows. They must be legible at ~16px and distinguishable from each other at a
glance, in all four badge states.

Achievement badges may stay illustrative/playful — a distinct, celebratory
visual language there is welcome, and 35 of them is a real design job. Tell us if
you'd rather define a system (shape + tier colour + numeral) than draw 35
individual badges; either answer is acceptable.

---

## 8. Content and typography rules (Russian-specific)

These are not decorative details — getting them wrong breaks the product.

1. **Stress marks.** Every Russian headword and example sentence carries a
   combining acute accent (U+0301) on the stressed vowel: `абза́ц`, `перево́дчик`,
   `Учи́тель попроси́л переписа́ть абза́цы.` The chosen typeface **must render
   combining acutes correctly on Cyrillic vowels**, including on `ё`. Please
   verify this and note the fallback stack.
2. **`ё` is always written** and has a dedicated key on the on-screen keyboard.
3. **Cyrillic and Latin sit adjacent constantly** — a Russian headword next to an
   English gloss, on the same line, at different sizes. Choose a family whose
   Cyrillic and Latin are metrically and stylistically compatible.
4. **`lang="ru"` is set on Russian text.** Any font pairing must survive that.
5. **English glosses are British English** (`en_gb`) and often parenthetical:
   *"apricot (a small orange fruit with a stone inside)"*. Rows need a strategy
   for the long form — the batch rows currently show the leading sense only and
   keep the full text for the word card.
6. **Words are disambiguated by qualifier**: aspect (`impf.` / `pf.`), motion
   (`det.` / `indet.`), or an authored note. Two words can share an English
   gloss and be different words. Design a compact, consistent qualifier chip.
7. **Nothing may be transliterated.** No Latin approximations of Russian anywhere.

---

## 9. Technical constraints

- **Vue 3 SFCs + Vite.** Not React. Design in a way that maps cleanly to
  components; a component sheet (D1) is more valuable here than pixel-perfect
  one-offs.
- **Offline-first PWA.** No CDN fonts, no remote images, no network-dependent
  assets. Any typeface must be self-hostable and shipped in the bundle — and the
  bundle is **size-budgeted in CI** (gzipped limits on the entry chunk and entry
  CSS), so please flag the weight of anything you introduce, and prefer variable
  fonts and subsetted Cyrillic + Latin.
- **Illustration should be SVG or CSS**, not raster, for the same reason.
- **Currently a single centred 760px column** with no responsive layout beyond
  that. A desktop/tablet answer is welcome but must not compromise the phone.
- **The Russian keyboard is a persistent app-level overlay**, mounted outside the
  routed view. It docks to the bottom of the viewport when an input is focused.
- **Speech**: text-to-speech (Web Speech API) is used throughout — there's a
  small speak button beside almost every Russian string — and speech
  *recognition* drives the speaking drills. Both degrade gracefully where
  unsupported, so every speak affordance needs an absent state.
- Screens must tolerate **loading** ("Loading…" today) and **empty** states: no
  batch yet, no history yet, no dictionaries cached, nothing learned yet.

---

## 10. Sample data — use this, not lorem ipsum

Real content from the corpus. Please populate every artboard with it.

**Words (headword — gloss — CEFR — POS):**

```
абза́ц        — paragraph                                        B1  noun (m, inanimate)
абрико́с      — apricot (a small orange fruit with a stone inside) B1  noun (m, inanimate)
авиа́ция      — aviation (the operation of aircraft)             B2  noun (f, inanimate)
кни́га        — book                                             A1  noun (f, inanimate)
стол         — table                                            A1  noun (m, inanimate)
переводи́ть   — to translate                                     B1  verb (impf.)
перевести́    — to translate                                     B1  verb (pf.)
забы́ть       — to forget                                        A2  verb (pf.)
идти́         — to go (on foot, det.)                            A1  verb (impf.)
ходи́ть       — to go (on foot, indet.)                          A1  verb (impf.)
холо́дный     — cold                                             A1  adjective
```

**Example sentences (as authored, with stress marks):**

```
В э́том абза́це две оши́бки.            There are two mistakes in this paragraph.
Мы купи́ли абрико́сы на ры́нке.          We bought apricots at the market.
Учи́тель попроси́л переписа́ть абза́цы.   The teacher asked for the paragraphs to be rewritten.
Он рабо́тает в гражда́нской авиа́ции.    He works in civil aviation.
```

**A noun declension table (абза́ц) — use this for A9:**

| case | singular | plural |
| --- | --- | --- |
| nominative | абза́ц | абза́цы |
| genitive | абза́ца | абза́цев |
| dative | абза́цу | абза́цам |
| accusative | абза́ц | абза́цы |
| instrumental | абза́цем | абза́цами |
| prepositional | абза́це | абза́цах |

**Batch names** (they are topic collections): *food and drink · travel · daily
life · the body · work and study · weather · military*

**Curriculum part names:** *A1 Part I · A2 Part I · A2 Part II · B1 Part I …
C1 Part I*

**Plausible figures for a mid-journey learner** (use these so the artboards feel
like a real account, not a fresh install):

```
learned 342 · mastered 118 · 23-day streak
learning batch  "food and drink"   14 / 20 words   exercise progress 68%
mastery batch   "travel"            6 / 15 words   exercise progress 41%
at risk 7 words · slipped 3 words
```

**Real feedback strings** (the app's actual voice — match this tone):

- *"That's the imperfective — you were asked for the perfective."*
- *"After ж, ч, ш, щ you can't write ы — this ending takes и."*
- *"Same words, different order. Does your translation mean the same thing?"*
- *"This is an "I don't know", not a pass: the answer is shown, the question is
  marked wrong, and the word comes back for more practice."*
- *"✓ 3 words confirmed — still remembered a day later"*
- *"Learned — a review tomorrow will confirm it"*
- *"Do at least one exercise every day to keep your streak alive — you can skip
  one day a week without breaking it."*

---

## 11. What good looks like

The redesign succeeds if:

1. From a cold open, the learner is answering a question in **two taps**, with no
   decision harder than "how long have I got".
2. The **words learned / mastered** figures are the first thing the eye lands on.
3. Every one of the eight exercise types reads as **the same app**, with the
   question unmistakably the most important thing on screen and session progress
   always visible without competing.
4. Batch and word inspection answers **"why is this word stuck?"** in one look,
   without needing the criteria explained in prose.
5. Nothing on Home asks the learner to choose *what* to practise.
6. Every screen works at 360px wide, offline, in dark, with 44px targets.

---

## 12. Open decisions — please propose, don't assume

1. **Hands-free mode.** The app has a voice-only, eyes-up spoken practice mode
   ("just say давай"). It is a *modality*, not a content choice, so it arguably
   survives the "no practice-type choices" cut. Proposal wanted: a small
   secondary toggle attached to the start control, versus demoting it to a
   sub-screen, versus dropping it from the primary flow entirely.
2. **The eleven free-practice drills.** Untracked, open-ended drills (Vocabulary,
   Nouns, Adjectives, Pronouns, Verbs, Numbers, Phrases, Fix phrases, Verb
   government, Listening, Speaking) that don't feed the progress engine. They
   have their own routes and stay reachable by URL regardless. Proposal wanted:
   a "practice library" screen linked from Settings or Progress, versus no
   surface at all.
3. **Session size labels.** Confirm with engineering what 4 / 12 / 20 practices
   actually costs in minutes and exercises before committing to duration labels.
   Design for a two-line label either way.
4. **Word detail: modal, sheet or route?** It is currently a modal reachable from
   several places and it navigates between related words. A route would give it
   back/forward and deep-linking; a sheet keeps context. Your call, with reasons.
5. **The achievement badges.** Thirty-five of them. System vs. individual
   illustration — tell us which you'd rather do and what it costs.
6. **Wide viewports.** Whether Home / Batches / Progress get a genuine two-column
   desktop layout or stay a centred column. The session screens should almost
   certainly stay single-column at every width.
