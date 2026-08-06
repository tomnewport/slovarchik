# CEFR level audit

A review of the `cefr_level` field across every word in `public/vocab/`. The
level is a learner-facing label (shown as a pill in the inflection drill) and a
query/progress facet, so the goal is **accurate labels**, not a particular
histogram shape.

Re-run the reporting tool any time:

```bash
npm run audit:cefr                  # distribution + flags
node scripts/audit-cefr.js --list   # also list flagged entries
```

> This doc records two passes. The **[2026 cohort pass](#the-2026-cohort-pass)**
> at the bottom is the current baseline; the sections immediately below are the
> original audit, kept for the method and the history.

## What the audit found

Levels had been assigned ad-hoc as words were added, with no reference standard.
That left two systematic problems:

1. **B1 was a dumping ground** — 52.7% of the whole corpus sat at B1, including
   plainly elementary words. The clearest tell was `город=city` at **B1** (it is
   an A1 word in every beginner course).
2. **The top end was empty** — only 5 C1 entries and no C2, with specialist and
   literary vocabulary parked at B1.

## Method

Russian has no single official CEFR list, but the TORFL / ТРКИ *lexical minimums*
(Элементарный ≈ A1, Базовый ≈ A2, ТРКИ-1 ≈ B1, ТРКИ-2 ≈ B2, …) are the de-facto
mapping, and they line up with word frequency. Using those as the yardstick,
**172 entries** were re-levelled, only where the stored level was clearly off:

- **Everyday concrete vocabulary → A1/A2.** Common nouns (`банк`, `война`,
  `король`, `крыша`, `документ`), basic body parts (`горло`, `грудь`, `колено`,
  `кровь`, `кость`), high-frequency verbs (`плакать`, `смеяться`, `улыбаться`,
  `бояться`, `чувствовать`), core adjectives (`бедный`, `опасный`, `сложный`,
  `странный`, `ясный`) and adverbs (`почти`, `совсем`, `точно`, `наверное`).
- **Specialist / formal / abstract vocabulary → B2.** Military, political,
  religious, legal and scientific terms (`авиация`, `дивизия`, `депутат`,
  `господь`, `крестьянин`, `вещество`, `использование`), literary verbs
  (`бормотать`, `воскликнуть`, `усмехнуться`, `мчаться`) and bookish adjectives
  /adverbs (`мрачный`, `истинный`, `несомненно`, `мгновенно`).
- **Archaic / historical → C1.** `государь`, `гимнастёрка`, `папироса`,
  `шинель`.

Borderline A2↔B1 and B1↔B2 calls were left alone: the aim was to fix clear
mislabels, not to relitigate every judgement call.

## Distribution

| Level | Before | After |
| ----- | -----: | ----: |
| A1 | 296 (9.2%)  | 297 (9.2%)  |
| A2 | 824 (25.5%) | 923 (28.6%) |
| B1 | 1700 (52.7%) | 1532 (47.5%) |
| B2 | 402 (12.5%) | 466 (14.4%) |
| C1 | 5 (0.2%)    | 9 (0.3%)    |
| C2 | 0           | 0           |
| **Total** | **3227** | **3227** |

B1 is no longer half the corpus, the A1–A2 core holds the everyday words a
beginner actually meets first, and specialist vocabulary has moved up.

## Coverage pass (missing A1–B2 vocabulary)

A second pass cross-checked the corpus against the standard frequency list
(`node scripts/check_standard_vocab.js`) and found core A1–B2 words missing
entirely — including A1 staples like `очень` (very), `теперь` (now), `кофе`,
`письмо` and `минута`. **187 entries were added** with full, hand-verified
grammar:

- **59 function words / adverbs** — adverbs (`очень`, `теперь`, `скоро`,
  `слишком`, `вовремя`, `лучше`…), prepositions (`после`, `против`, `насчёт`,
  `помимо`, `спустя`…), an interjection (`господи`) and indefinite pronouns
  (`кто-то`, `что-то`, `никакой`).
- **83 nouns** with complete 6-case × number declension tables (`письмо`,
  `минута`, `кровать`, `свет`, `помощь`, `случай`, `связь`, `область`,
  `способность`, the `-ость` abstract series, indeclinables `кофе`/`такси`/`меню`,
  pluralia tantum `сутки`/`дрова`, …).
- **45 verbs** with full conjugation (non-past 6 + past 4), covering the
  high-frequency `при-`/`про-`/`пред-`/`под-` families (`пробовать`, `подумать`,
  `пригласить`, `продать`, `проснуться`, `пользоваться`, `предупредить`…),
  including consonant mutations and mobile stress.

Standard-list coverage rose from **88.2% → 93.7%**; the corpus grew from 3,322
to 3,509 words. Every added noun/verb form was machine-checked for completeness
and stress marking, then validated by the existing data-integrity tests.

### Second coverage pass

A follow-up pass added a further **92 high-confidence A1–B2 words**, lifting
standard-list coverage from **93.7% → 96.5%**:

- **25 adjectives** (`общий`, `следующий`, `ранний`, `старший`, `городской`,
  `крайний`, `лишний`, `сырой`, `высший`…) — full 24-form tables generated and
  validated by `scripts/gen-adjective-declension.mjs`.
- **32 verbs** (`поднимать`/`поднять`, `подавать`/`подать`, `поддержать`,
  `прибыть`, `пустить`, `пропасть`, `произвести`, `печь`, `завести`…) with full
  conjugation, including consonant mutations, mobile past stress (`подала́`,
  `подобрала́`) and the irregular `подать`.
- **25 nouns** (`железо`, `запас`, `крик`, `минимум`, `наличие`, `отсутствие`,
  `шоссе`, `штаны`, `рукопись`, `препарат`…) with complete case tables.
- **8 adverbs** (`нельзя`, `далее`, `крайне`, `навстречу`, `якобы`, `отнюдь`…)
  and **2 numerals** (`триста`, `шестьдесят`).

The ~113 words still missing from the standard list are non-core: abbreviations
(`нквд`, `цк`, `др`), proper nouns, slang/loanwords (`вай-фай`, `хобби`), set
phrases (`доброе утро`), and a tail of specialist/literary items.

## The 2026 cohort pass

The corpus had grown to 4,180 learnable words (plus ~2,500 gloss-only entries in
`glossary.yml`, which no drill ever serves), and the drift had come back in a
new shape — see [#529](https://github.com/tomnewport/slovarchik/issues/529).
It was no longer individual bad labels: whole **topic packs** had been added in
one go and stamped with a single level regardless of how hard the words in them
were. The `character` pack was the clearest case — 14 of its 18 original words
sat at A1, including `харизматичный`, `педантичный`, `коммуникабельный` and
`сентиментальный`. `многофункциональный` (19 letters) was A1 too.

This matters more than a wrong pill. `cefr_level` drives batch selection: step 2
of `src/lib/batches.js` refines the eligible words to the **lowest CEFR level
present**, so A1 is literally what a learner opening the app for the first time
is served. A1 had swollen to 550 words and a beginner's opening batches were
drawing `многофункциональный` ahead of much of the core vocabulary.

### What changed

**212 entries were re-levelled**, all upwards, all out of A1 — 160 nouns, 25
adjectives, 18 verbs, 9 adverbs (72 → A2, 107 → B1, 33 → B2). The yardstick is
the same TORFL/ТРКИ lexical minimum used above:

- **A1 (Элементарный)** — the first weeks: `хлеб`, `семья`, `дом`, `автобус`,
  the numbers, the seasons, the immediate family. What survived the pass reads
  like a beginner's first hundred words.
- **A2 (Базовый)** — everyday concrete extensions: rooms and furnishings
  (`гостиная`, `подушка`), common foods (`капуста`, `йогурт`, `сосиска`),
  clothes (`блузка`, `кроссовка`), jobs (`бармен`, `банкир`), and the
  countries/nationalities beyond the core (`Мексика`, `швед`) — which also puts
  the whole `nationalities` pack on one level for the first time.
- **B1 (ТРКИ-1)** — topic vocabulary that needs a context to come up in:
  instruments and genres (`саксофон`, `джаз`, `танго`), hobbies (`боулинг`,
  `рыбалка`), less common foods (`свёкла`, `петрушка`, `маслина`), abstract
  nouns (`интуиция`, `гармония`), and the personality adjectives a learner can
  actually use (`оптимистичный`, `практичный`, `эмоциональный`).
- **B2 (ТРКИ-2)** — specialist, formal or culturally narrow: `устрица`,
  `паэлья`, `кислая капуста`, `водоросль`, `бунгало`, `шезлонг`, `инъекция`,
  `медикамент`, `консерватория`, `стабильность`, and the bookish character
  adjectives (`харизматичный`, `педантичный`, `сентиментальный`,
  `коммуникабельный`, `интеллигентный`, `многофункциональный`).

Borderline calls were again left alone. Nothing moved *down*, and no word
outside A1 was touched.

### Distribution (learnable words only)

| Level | Before | After |
| ----- | -----: | ----: |
| A1 | 550 (13.2%) | 338 (8.1%) |
| A2 | 1048 (25.1%) | 1120 (26.8%) |
| B1 | 1932 (46.2%) | 2039 (48.8%) |
| B2 | 630 (15.1%) | 663 (15.9%) |
| C1 | 20 (0.5%) | 20 (0.5%) |
| C2 | 0 | 0 |
| **Total** | **4180** | **4180** |

Gloss-only entries (`learn: false`) are excluded throughout: they are never
served to a learner, and their keys are surface forms, not headwords. The audit
tool now reports the learnable totals on their own row for the same reason.

### What the tool learned

The old script gave the corpus a clean bill of health (`Flagged entries: 0`)
while all of the above was in it: its anchors are entry-shaped, and a cohort
mislevelled *together* looks exactly like a legitimate cluster of easy topical
words. `scripts/audit-cefr.js` now runs two further heuristics, both covered by
`scripts/audit-cefr.test.mjs`:

- **Cohorts** — a collection of ≥10 learnable words with ≥70% at one level.
  `character` was 78% A1. Some packs are genuinely uniform (`nationalities` is
  83% A2 and correct), so this is a prompt to look, not a verdict.
- **Shape** — an A1/A2 headword longer than 13 letters, or ending in a
  transparent internationalism (`-ичный`, `-альный`, `-ационный`, `-ивный`,
  `-ация`, `-изм`, `-логия`). Elementary vocabulary is overwhelmingly short and
  native. Run against the corpus as it stood before this pass, that one rule
  alone catches 21 of the mislevelled entries.

Post-pass the tool reports one cohort (`nationalities`, reviewed and correct)
and seven shape flags, all A2 words that are fine where they are (`нормальный`,
`спортивный`, `центральный`, `информация`, `ситуация`, `останавливаться`,
`путешествовать`).

## Still open

- **No C2, and C1 is still thin.** This is expected for a corpus aimed at
  A1–B2 learners; the few genuinely C2 items aren't in the word lists yet.
- **~203 standard-list words still missing**, but the remainder is mostly
  non-core: set phrases (`доброе утро`), slang/loanwords (`вай-фай`, `хобби`),
  abbreviations (`нквд`, `цк`), proper nouns, derived forms already present in
  their base, and a tail of specialist or literary nouns/verbs.
- **Function words** (conjunctions, numerals) and the remaining mid-band
  A2↔B1 / B1↔B2 nouns were not exhaustively re-judged. The
  `scripts/audit-cefr.js` anchors are a small high-confidence seed — extend the
  `REFERENCE` map there to widen automated flagging.
- **The A2 band has not had a cohort pass.** The 2026 pass re-levelled out of A1
  only, because that is the band batch selection serves first. A2 now holds
  1,120 words and is the next place the same uniform-stamp pattern would show
  up; the cohort check reports it, nobody has swept it.
- **`glossary.yml` levels are unreviewed** and deliberately so — the entries are
  auto-generated, `learn: false`, and never reach a drill. If a
  glossary→curriculum promotion ever starts flipping entries to `learn: true`,
  their levels need auditing at that point.
