# Phrase-context inflection drill — redesign

> Status: **in progress**. Supersedes `phrase-completion-inflection.md` (the
> synthetic carrier-frame "battery" design). Owner decisions (2026-06):
> hand-author annotations, **retire batteries entirely**, ship as one redesign.

## Why this replaces the battery approach

The shipped drill built sentences from synthetic *carrier frames*
(`public/vocab/phrase-batteries.yml`): a fixed skeleton like `Я ви́жу ___.` with
the target word dropped into a slot. Three problems, all structural:

1. **It read out ungrammatical Russian.** The slot showed the *lemma*
   (соба́ка), so the spoken sentence was "Я ви́жу соба́ка" — wrong case. The app
   should never voice broken grammar.
2. **Stilted, number-blind English.** `en` was a template ("I see ___") with the
   bare nominative gloss spliced in → "I see dog": no article, no singular/plural
   cue, so the learner couldn't tell which form was wanted.
3. **Artificial sentences.** Carrier frames are not how the language is used, and
   they can't teach the *reasons* a case is required or its exceptions.

The fix is to drive the drill from **real, hand-authored, fully-annotated
phrases** instead. Each phrase is a correct sentence; we record exactly which
token is being taught and how it is inflected, and link it to the rule that
explains the form. Coverage is **per-inflection-type, not per-word**: we accept
that not every word has a phrase for every case, and instead make sure each
*kind* of inflection is well represented across subjects.

## Data model

### `inflect:` annotations on existing `usage:` examples

Words already carry `usage:` example sentences that teach them. Rather than
maintain a parallel phrase bank, we **annotate those examples in place**: an
optional `inflect:` block marks which token is the word being taught and how it
is inflected. The target word is the example's owner, so its key is implicit.
One annotated sentence now feeds both the translation/spelling/listening drills
and the context-inflection drill.

```yaml
"собака=dog":
  ...
  usage:
    - ru: Я ви́жу соба́ку.            # correct, stress-marked, number-explicit en
      en_gb: I see the dog.
      inflect: { token: 3, case: acc, number: sg, rule: noun-acc-sg }
```

`vocabBuild.shapeContextPhrases(words)` turns every annotated example into the
phrase descriptor the resolver consumes (`{ id, ru, en, subject, target }`,
where `subject` comes from the word's first `collection`). Part-of-speech fields
on `inflect`:

| POS | fields | notes |
| --- | --- | --- |
| noun / pronoun | `case`, `number` | |
| adjective | `case`, `number`, `gender` | agrees with its carrier noun |
| verb | `tense`, `person` | `person` ∈ `1sg 2sg 3sg 1pl 2pl 3pl`; past uses `past_m/f/n/pl` |

`token` indexes the whitespace-split tokens of `ru` (1-based, punctuation
attached to its word). The token's *word core* (letters only) must equal the
inflected answer — the loader and a test assert this so a mis-counted index is
caught.

### `public/vocab/grammar-rules.yml` (new)

Short rule/formula explanations, keyed by id (referenced by `inflect.rule`),
shown when the answer is revealed. Loaded separately — it has no `words:` block.

```yaml
rules:
  noun-acc-sg:
    title: "Accusative singular"
    formula: "f -а → -у · inanimate m/n = nominative · animate m = genitive"
    explanation: >
      The accusative is the direct object and follows в/на for motion…
    exceptions:
      - "Feminine -ь nouns don't change: мать → мать."
```

## Interaction: two steps

The renderer (`components/exercises/PhraseFixExercise.vue`) runs the drill in two
graded steps:

1. **Select the slot.** The phrase shows with the target collapsed to its lemma.
   The learner works through a *sequence* of picks — **case always first**, then
   the dimension that disambiguates the form:
   - **Nouns:** case (six buttons with the `CASE_HINTS` glosses) → number
     (Singular / Plural). Both are free choices the learner must read off the
     sentence, so both are asked.
   - **Adjectives / possessive pronouns:** case → gender + number (Masculine /
     Neuter / Feminine / Plural, where the `pl` option carries the plural). The
     real skill is reading case *and* the agreeing gender/number off the carrier
     noun, so each is its own pick.
   - **Personal pronouns:** case only — number is fixed by the lemma (я is always
     singular), so there's nothing to choose.
   - **Verbs** skip this stage — there is no case to choose — and go straight to
     spelling.
   `lib/phraseContext.js` builds an ordered `selectSteps` array, each a generic
   descriptor (`{ kind, prompt, options: [{ id, label, hint?, correct }] }`); the
   component grades each clicked option's `correct` flag and counts the selection
   right only if every step was.
2. **Spell the form.** The learner types the correctly inflected form. Graded
   leniently (`normalize` + `foldYo`: stress- and ё/е-insensitive).

Only **after the form is spelled correctly** do we (a) reveal the full correct
sentence, (b) speak it, and (c) show the linked grammar rule. The lemma-in-slot
sentence is never spoken. An exercise counts as correct only if *both* steps were
right first time.

## Engine wiring

- `src/lib/phraseContext.js` (new, pure, tested) replaces `phraseBattery.js`.
  `buildContextExercise(word, { phrasesByKey, rules, rng })` picks one annotated
  phrase for the word and returns the exercise descriptor (tokens, lemma,
  targetIndex, answer/answerAccented, number, selectSteps, slotLabel, `ru`
  full sentence, `en`, `rule`). `canBuildContext(word, { phrasesByKey })` = the
  word has ≥1 annotated phrase.
- `src/stores/vocab.js` builds the `key → [phrase]` index from
  `shapeContextPhrases(words)` (the `inflect:` annotations), loads
  `grammar-rules.yml`, and stamps `hasContextDrill` from the index (replacing the
  battery check). The `context` mastery dimension in `progression.js` is
  unchanged — only its *source* of truth moves.
- `src/lib/exerciseBuild.js`: `buildContext` resolves via `phraseContext.js`; the
  `batteries` source param becomes `contextPhrases` + `rules`.
- `src/views/PhraseFixView.vue` (standalone `/phrase-fix` free-practice route) is
  repointed at the new resolver/component.
- Retired: `public/vocab/phrase-batteries.yml`, `src/lib/phraseBattery.js`
  (+ test), `src/lib/phraseFix.js` (+ test, the old usage-scanning resolver).
  The per-word `usage:` examples stay — they still feed the translation,
  spelling, word-bank and listening drills via `shapePhrases`.

## Coverage strategy

Hand-authored, **systematic per inflection type**. Coverage is now effectively
complete for every inflecting part of speech — each drillable word carries at
least one annotated phrase, and the dataset as a whole spans every form:

- **Nouns:** all six cases in singular and plural, spanning the main gender /
  ending classes, and the typical *reasons* each case appears (direct object,
  possession/absence, indirect object, with/by, location/topic, motion). The
  handful of un-annotated nouns are indeclinable (кафе, метро, пальто, США …).
- **Adjectives:** agreement across genders and cases (100%).
- **Verbs:** present/future persons and the past-tense gender/number forms (100%).
- **Pronouns:** personal/reflexive (suppletive, flat by case), interrogative /
  indefinite / negative (кто, что, никто …), and the gender·case-agreeing
  possessives and demonstratives (мой, этот, какой, чей …). The four left out
  are indeclinable (его/её/их as possessives, and ско́лько).

Each phrase links to a rule, and the rule set deliberately covers the awkward
bits — fleeting vowels, the к/г/х and ж/ш/щ/ч spelling rules, animate accusative
= genitive, feminine -ь nouns, suppletive pronoun stems, the н- prefix on
prepositional он/она́/они́, etc.

`scripts/coverage.mjs` is the content tool: `dump <pos>` proposes annotations
(auto where unambiguous, `# MANUAL` where a human must read the sentence),
`apply <file>` inserts them surgically, and `stat` reports per-POS coverage.

### Pronoun forms

Pronoun forms don't live in the noun `forms[number][case]` shape: personal,
reflexive and interrogative pronouns are flat by case (`forms[case]` on the raw
entry), while possessives / demonstratives decline like adjectives
(`declension[gender_case]`). The resolver reads the answer straight off the
annotated token, so it needs no per-shape logic; only the data-integrity test's
`storedForm` branches on this to cross-check the stored form. Annotate a flat
pronoun with `{ case, number }` and a gendered one with `{ case, number, gender }`
(gender drives the agreement step, exactly as for adjectives).

### Exception weighting

Rules that describe an irregular/exception pattern carry `exception: true` in
`grammar-rules.yml` (e.g. `noun-acc-animate`, `noun-genpl-fleeting`,
`noun-fem-soft`, `noun-mya-neuter`, `noun-irregular-plural`). When a word has
several annotated phrases, `buildContextExercise` draws them with a weighted
pick (`EXCEPTION_WEIGHT`, currently 4×) so the hard forms surface more often —
but not exclusively, so regular forms still appear. The renderer badges an
exception ("Exception" pill on the rule panel) when the answer is revealed.

## Testing & conventions

- All logic in framework-free `src/lib/*` with co-located `*.test.js`.
- A data test (`phrasesData.test.js`) asserts every `inflect:` annotation
  resolves: its token core matches the word's stored form for the annotated slot,
  and any `rule` id exists in `grammar-rules.yml`.
- `npm run lint && npm test && npm run build` before pushing.
