# Gender balance in phrases with a personal subject

_Issues #525 (first person) and #541 (second person)._

Russian marks the subject's gender on the past-tense verb (я сде́лал vs
я сде́лала, ты уста́л vs ты уста́ла) and on predicate short adjectives (я рад vs
я ра́да). The usage corpus was seeded from a mostly-masculine source, so these
examples had almost no women in them, and the handful that did clustered on
stereotyped topics ("I broke a nail", "I signed up for aerobics"). The subject's
gender in "I was at work" is arbitrary; a learner should meet it either way. An
uneven split is a data-integrity problem, so we treat it like the other corpus
oracles (stress, morphology).

Both persons have now been evened out:

| subject | before        | after         |
| ------- | ------------- | ------------- |
| «я …»   | 959 m / 8 f   | 500 m / 503 f |
| «ты …»  | 117 m / 6 f   | 61 m / 62 f   |

The second person matters most, because there the subject **is the learner**.
An all-masculine «ты» corpus is the one place the app tells a user what gender
they are — and since the prompt annotations (`phraseAmbiguity.js`) print the
addressee's gender when the English doesn't determine the answer, it said so out
loud on every one of those phrases: _"You (informal, to a man) chose the wrong
road."_

## How the split is measured and kept even

`src/lib/genderBalance.js` is the framework-free oracle. Everything in it takes
the **subject pronoun as a parameter** — «я» and «ты» agree identically, so they
are one code path, with `firstPerson*` / `secondPerson*` wrappers for readability:

- **`buildPastIndex(words)`** indexes every verb's stored `past_m`→`past_f`
  forms. Feminine forms are read straight from the conjugation table, so the
  mobile-stress class (был→была́, взял→взяла́, на́чал→начала́) stays correct —
  never mutated by an "append -а" rule that would get the stress wrong.
- **`genderedTokens` / `subjectGender`** find the gender-revealing tokens in a
  phrase: past-tense verbs (from the table, with a morphological -л/-ла fallback
  for verbs whose imperfective isn't a headword, e.g. опа́здывал) and a curated
  set of predicate forms (рад/ра́да, до́лжен/должна́, …). This is the *counting*
  side and is deliberately whole-phrase: over-detecting only makes the measured
  skew look worse than it is.
- **`feminizeSubject`** returns a feminine rendering of a masculine phrase — but
  only when it is **safe**:
  1. the pronoun stands alone as a subject;
  2. the phrase carries exactly one gendered token, and it is a masculine past
     verb with a known feminine form, so flipping it can't leave anything else
     in disagreement;
  3. that token sits in the pronoun's **own clause**, and the other personal
     pronoun isn't in that clause — so the gender being moved is demonstrably
     this subject's. «Ты зна́ешь, что он сде́лал?» is refused: сде́лал is the
     third person's, and flipping it would be a mistranslation, not a rebalance.

  Phrases with two gendered words (я был рад) or a predicate-only gender are
  left untouched.

The regression floor lives in `genderBalance.test.js`: for **each** person,
neither gender may fall below 45% of that person's gendered phrases. Adding
masculine phrases without balancing them trips it.

## Tools

```bash
npm run audit:gender                 # print the split per person + per-file breakdown
node scripts/gender-audit.mjs --list # also list every masculine phrase

node scripts/rebalance-gender.mjs             # dry run: what it would flip
node scripts/rebalance-gender.mjs --apply     # flip a deterministic subset to even it out
node scripts/rebalance-gender.mjs --person=ты # one person only
```

`rebalance-gender.mjs` runs one pass per person, each flipping a hash-selected,
spread-out subset of that person's safely switchable phrases until the two
genders are even. The passes share a working copy of the files and re-read the
corpus as the previous pass left it, so they can't fight over the same sentence.
Each flip:

1. replaces the masculine verb token with the verb's stored `past_f` form, and
2. when that verb is itself an `inflect:` annotation's target, retargets the
   annotation's `person: past_m` → `past_f`, so the in-context drill keeps
   grading the shown form.

Every flip is validated by the existing guards — `phrasesData.test.js` checks
each annotated token equals the word's stored form for its slot, and the stress
oracle checks the token's accent matches the paradigm — so a wrong flip fails CI
rather than shipping.

## Known limitations / future work

- Only **verb** gender is flipped. Predicate short adjectives (ты рад → ты ра́да)
  and profession nouns (я учи́тель → я учи́тельница) are recognised for the
  count but not auto-switched — their feminine forms would need to come from the
  adjective `short` blocks / noun pairs, not the verb table. They stay
  counted-but-unflipped.
- Only the **singular personal** subjects are balanced. «Вы» is genuinely
  ambiguous between polite-singular and plural and takes plural agreement, so it
  marks no gender; third-person subjects (он/она́) name their gender in the
  English too, so nothing is hidden from the learner there.
- The rebalance is a **corpus edit**, not a runtime switcher. Baking gender into
  the data keeps every drill (spelling, word-bank, listening, in-context
  inflection) consistent for free. A live per-session randomiser was considered
  (the issue's suggestion) but would have to re-derive each drill's grading
  target and audio from the switched form; the data-level fix avoids that and is
  guarded against regression.
