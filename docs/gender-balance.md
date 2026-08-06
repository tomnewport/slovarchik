# Gender balance in first-person phrases

_Issue #525._

Russian marks the speaker's gender on the past-tense verb (я сде́лал vs
я сде́лала) and on predicate short adjectives (я рад vs я ра́да). The usage
corpus was seeded from a mostly-masculine source, so first-person examples had
almost no women in them, and the handful that did clustered on stereotyped
topics ("I broke a nail", "I signed up for aerobics"). The speaker's gender in
"I was at work" is arbitrary; a learner should meet it either way. An uneven
split is a data-integrity problem, so we treat it like the other corpus oracles
(stress, morphology).

Before the fix the first-person split was **~99% masculine** (959 m / 8 f). It
is now **even** (~50/50).

## How the split is measured and kept even

`src/lib/genderBalance.js` is the framework-free oracle:

- **`buildPastIndex(words)`** indexes every verb's stored `past_m`→`past_f`
  forms. Feminine forms are read straight from the conjugation table, so the
  mobile-stress class (был→была́, взял→взяла́, на́чал→начала́) stays correct —
  never mutated by an "append -а" rule that would get the stress wrong.
- **`genderedTokens` / `firstPersonGender`** find the gender-revealing tokens in
  a phrase: past-tense verbs (from the table, with a morphological -л/-ла
  fallback for verbs whose imperfective isn't a headword, e.g. опа́здывал) and a
  curated set of predicate forms (рад/ра́да, до́лжен/должна́, …).
- **`feminizeFirstPerson`** returns a feminine rendering of a masculine phrase —
  but only when it is **safe**: «я» is the subject and the phrase carries
  exactly one gendered token, so flipping it can't leave anything else in
  disagreement. Phrases with two gendered words (я был рад), two clauses
  (когда́ я пришёл, он спал) or a predicate-only gender are left untouched.

The regression floor lives in `genderBalance.test.js`: neither gender may fall
below 45% of the first-person gendered phrases. Adding masculine phrases without
balancing them trips it.

## Tools

```bash
npm run audit:gender                 # print the current split + per-file breakdown
node scripts/gender-audit.mjs --list # also list every masculine phrase

node scripts/rebalance-gender.mjs           # dry run: what it would flip
node scripts/rebalance-gender.mjs --apply    # flip a deterministic subset to even it out
```

`rebalance-gender.mjs` flips a hash-selected, spread-out subset of the safely
switchable phrases until the two genders are even. Each flip:

1. replaces the masculine verb token with the verb's stored `past_f` form, and
2. when that verb is itself an `inflect:` annotation's target, retargets the
   annotation's `person: past_m` → `past_f`, so the in-context drill keeps
   grading the shown form.

Every flip is validated by the existing guards — `phrasesData.test.js` checks
each annotated token equals the word's stored form for its slot, and the stress
oracle checks the token's accent matches the paradigm — so a wrong flip fails CI
rather than shipping.

## Known limitations / future work

- Only **first-person** gender is balanced. Second-person phrases — «ты» with a
  past-tense verb or predicate («Ты уста́л?», «Ты ве́рно отве́тил») — are still
  ~100% masculine (100 m / 0 f). The prompt annotations built on
  `phraseAmbiguity.js` now surface this to the learner ("You (informal, to a
  man) answered correctly"), so the skew is visible rather than silent. Evening
  it out is the same job as this one, one pronoun over: `feminizeFirstPerson`
  would need a «ты» variant, and the flip is safe under the same
  one-gendered-token rule.
- Only **verb** gender is flipped. Predicate short adjectives (я рад → я ра́да)
  and profession nouns (я учи́тель → я учи́тельница) are recognised for the
  count but not auto-switched — their feminine forms would need to come from the
  adjective `short` blocks / noun pairs, not the verb table.
- The rebalance is a **corpus edit**, not a runtime switcher. Baking gender into
  the data keeps every drill (spelling, word-bank, listening, in-context
  inflection) consistent for free. A live per-session randomiser was considered
  (the issue's suggestion) but would have to re-derive each drill's grading
  target and audio from the switched form; the data-level fix avoids that and is
  guarded against regression.
