# CEFR level audit

A review of the `cefr_level` field across every word in `public/vocab/`. The
level is a learner-facing label (shown as a pill in the inflection drill) and a
query/progress facet, so the goal is **accurate labels**, not a particular
histogram shape.

Re-run the reporting tool any time:

```bash
node scripts/audit-cefr.js          # distribution + flags
node scripts/audit-cefr.js --list   # also list flagged entries
```

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
