# Translation review — proofreading the example corpus

The corpus carries **15,977 distinct example sentences** across 6,703 words.
Each is a `{ru, en_gb}` pair that feeds the Phrases drill, the word-bank
(assemble-the-translation) drill, and — via `inflect:` — the in-context
inflection drill. Some of those pairs are weaker than they look:

- the English is a free paraphrase where a literal rendering would teach more
  (`До́ма гото́вят вкусне́е, чем в кафе́.` → "At home they cook **more tastily**
  than in a cafe" — literal to the point of not being English);
- the English silently **adds** what the Russian never says (`Учи́тель попроси́л
  переписа́ть абза́цы.` → "The teacher asked **us** to rewrite the paragraphs");
- the sentence renders a word differently from the gloss the tap-hint shows for
  it (`биле́т` is glossed "ticket" corpus-wide but rendered "exam question");
- the person or number shifts between the two sides (`Ну ты и мужи́к! Сам
  почини́л.` → "What a fellow! **He** fixed it himself");
- occasionally the Russian itself is the unnatural half.

None of that is decidable mechanically — "is this English natural?" is a
judgement call, and a good idiomatic translation is not a defect. So the review
is a **human-shaped reading pass**, run by many reviewers in parallel, with
heuristics used only to decide what gets read first.

## Why heuristics, and which ones

Reading 16k sentences in corpus order spends most of its attention on sentences
that are fine. Ranking fixes that. The scoring lives in
[`src/lib/translationAudit.js`](../src/lib/translationAudit.js) (pure and
unit-tested); [`scripts/audit-translations.mjs`](../scripts/audit-translations.mjs)
is the I/O around it.

The core trick is that a **bilingual dictionary already exists in-repo**.
`buildFormIndex` (phraseHint.js) maps every Russian surface form in the corpus —
including the `learn: false` gloss-only entries — to the English gloss the
learner sees on tap. That makes word-level alignment possible: tokenise the
Russian, look each token's gloss up, and greedily consume matching English
words. What is left over on each side is the signal.

| Signal | What it catches |
| --- | --- |
| **Literalness** — aligned Russian tokens ÷ content tokens | restructuring, idiom, gloss↔sentence divergence |
| **Added English** — English content words no Russian token accounts for | over-translation, invented detail |
| **Ungloss-able token** — no dictionary entry at all | a hole in the dictionary, not a translation defect |
| **Clause markers** — comma, dash, colon in the Russian | subordinate clauses, where restructuring hides |
| **Length ratio** — English words ÷ Russian words | padding, explanatory translation |
| **Aspect collision** — an aspect pair whose two members read the same in English | a contrast-drill question with two right answers |

Two refinements matter more than they look, because without them the report is
swamped by predictable Russian↔English mismatches rather than real defects:

- **English contractions are expanded** before matching. Otherwise «не» never
  aligns with "doesn't", and every negated sentence in the corpus — a large,
  well-translated slice — scores as unaligned.
- **Pronouns and prepositions use a closed-class table**, not their dictionary
  gloss. A pronoun's gloss is its nominative lemma, so «него́» is glossed "he"
  and can never align with "him"; a preposition maps many-to-many onto English,
  so «на» is glossed "on" and misaligns whenever the right English is "at".
  Both classes are closed, so listing them is exact rather than approximate.

### Tiers

`--report` puts every phrase in one of three tiers:

| Tier | Count | Rule |
| --- | --- | --- |
| `high` | ~1,380 | an ungloss-able token, or ≥3 gloss misses, or literalness ≤ 0.5 on a sentence of 3+ content words |
| `medium` | ~4,670 | ≥2 gloss misses, ≥2 added English words, any clause marker, or length ratio > 1.8 |
| `clean` | ~9,920 | trips nothing |

**The tiers rank; they do not judge.** Plenty of `high` phrases are correct
translations of idioms, and the `clean` tier certainly hides defects — which is
why the review deliberately folds a random sample of clean phrases into the
queue, to measure how much the heuristics miss rather than only confirming what
they catch.

This is deliberately **not** a CI guard. Thousands of phrases trip a signal and
most are fine; a threshold would be noise. Contrast `stressAudit.js` /
`morphOracle.js`, which assert things that are true or false.

## What a reviewer decides

For each sentence, in this order:

1. **Is the Russian natural?** Would a native speaker say this? If not, that is
   the finding — do not paper over it with a better English translation.
2. **Does the English say what the Russian says?** Nothing added, nothing
   dropped, same person, number, gender, tense and aspect.
3. **Could it be more literal and still be natural English?** This corpus
   teaches; a rendering that tracks the Russian structure is worth more than an
   idiomatic one, *up to the point where the English stops being English*.
   "At home they cook more tastily" is over the line. Prefer the most literal
   rendering that a native English speaker would actually write.
4. **Is it an idiom?** Idioms translate as idioms — «Он встал с ле́вой ноги́» is
   "He got out of bed on the wrong side", not a word-for-word gloss. Leave them,
   and where the literal reading is instructive, add it as `en_alt` rather than
   contorting `en_gb`.
5. **Does the rendering match the word's own gloss?** If the sentence needs a
   sense the headword's gloss doesn't cover, the gloss may be what needs fixing.
6. **If the word is half of an aspect pair, does the English commit to that
   aspect?** See below — this one is invisible when reading a sentence alone.

### Aspect collisions

A phrase in a packet may carry an `aspectCollisions` block. It means this
sentence and a sentence of the verb's **aspect partner** are rendered by the
same English, and it is the one defect in this review that cannot be seen by
reading a sentence on its own — both halves look fine individually.

It matters because `buildContrastDrill` (phraseContext.js) draws sentences from
*both* members of a pair, shows the learner the English, and asks which verb it
is. When «Она́ благодари́ла учи́теля.» and «Она́ поблагодари́ла учи́теля.» are both
"She thanked the teacher.", that question has two right answers and the drill
marks one of them wrong. #576 was exactly this, reported from a screenshot of
the drill: «Будь му́зыка поти́ше, я услы́шала бы звоно́к.» glossed "I would hear
the bell…" — a present counterfactual, which is what the *imperfective* says —
against the partner's own "Without the noise I would hear every word."

Russian doesn't distinguish "would" from "would have" (бы + past covers both,
per `verb-conditional` in grammar-rules.yml), so the English is free to pick the
reading the aspect actually carries. Fixing the perfective side to "I would
**have heard** the bell if the music **had been** quieter" forces услы́шать and
leaves the imperfective as the only "would hear".

Two severities are reported. `identical` means the whole English sentence
matches — unanswerable, always a defect. `frame` means only the verb's
auxiliary-plus-form matches ("would hear"); the rest of the sentence may still
carry a cue, so read it and judge. **Fix the side whose English is wrong, not
whichever is convenient** — usually the perfective, which should read as a
single completed event.

### Defect taxonomy

| `defect` | Meaning |
| --- | --- |
| `over-translation` | English states what the Russian does not |
| `under-translation` | English drops something the Russian states |
| `unnatural-english` | reads as translationese, or is simply not English |
| `too-free` | a natural, more literal rendering exists and is better here |
| `gloss-mismatch` | sentence renders a word against its own headword gloss |
| `person-number-gender` | the two sides disagree on who/how many |
| `aspect-tense` | the two sides disagree on aspect or tense |
| `idiom-unmarked` | idiomatic rendering that would benefit from a literal `en_alt` |
| `unnatural-russian` | the Russian half is the problem |
| `none` | no defect; recorded for an `add-alt` or a sampled `keep` |

## The protocol

Reviewers **never edit YAML.** They read a packet and emit JSONL proposals; a
single applier merges them.

This is not bureaucracy. The review runs as ~90 parallel passes over six files,
two of which are tens of thousands of lines — parallel writers would conflict
constantly and the result would be unreviewable as a diff. One writer means one
deterministic pass, a minimal diff, and a re-runnable merge.

```
scripts/audit-translations.mjs --shard   →  review/packets/packet-NNN.json
                                                     ↓
                                         one reviewer per packet
                                                     ↓
                                          review/proposals/*.jsonl
                                                     ↓
                            scripts/apply-translation-review.mjs --apply
                                                     ↓
                                             public/vocab/*.yml
```

Packets are cut **by owner word, never mid-word**: judging whether «биле́т»
should be "exam question" in one sentence needs the headword's gloss and its
sibling examples in the same view. A packet therefore contains every phrase of
each word it covers, including the clean ones — those are the baseline the
flagged siblings are judged against.

### Verdicts

| `verdict` | Effect |
| --- | --- |
| `keep` | nothing changes. **The expected outcome for most phrases.** |
| `retranslate` | replaces `en_gb` |
| `add-alt` | appends to `en_alt` — the drill accepts it, `en_gb` still shows |
| `fix-russian` | replaces `ru` (and optionally `en_gb`) — see the hazard below |
| `flag` | no edit; surfaces for a human decision |

`add-alt` is underused and should not be. Russian has no articles and a freer
word order, so one Russian sentence has several equally valid English
renderings; adding them stops the word-bank drill marking a correct answer
wrong. Where `en_gb` is idiomatic, a literal `en_alt` also gives the learner the
structural reading without making the shown translation stilted.

### The hazard: `inflect:` token indices are positional

`inflect: { token: N }` is a **1-based index into the Russian sentence's
whitespace tokens** (`phraseContext.js:445`). Insert a word, drop one, or
reorder, and the annotation silently retargets — the drill then teaches the
wrong case, and `phrasesData.test.js` will not catch it, because it only checks
that the annotated token matches the *declared* slot, and the interesting forms
are syncretic. `enNotes` (the ты/вы and gender annotations from
`phraseAmbiguity.js`) are derived from the Russian too.

So the applier **refuses to rewrite a Russian sentence that carries an
`inflect:` block**, writing the proposal to `review/quarantine-russian.jsonl`
for a follow-up pass that re-annotates it. After any applied `fix-russian`:

```bash
npm run check:inflect                        # would the annotator add anything now?
node scripts/triage-inflect.mjs --verify     # re-derive cases, flag contradictions
npm run audit:gender                         # rewording can skew the m/f balance
npm test
```

Rewording also interacts with the **subject-gender balance** (see
[`gender-balance.md`](gender-balance.md)): the corpus deliberately mixes
masculine and feminine past-tense subjects, so a reviewer must not "fix" a
feminine sentence into a masculine one, and a changed past-tense form must keep
its `inflect.person` in step.

## Running it

```bash
npm run audit:translations                                   # tier counts + signal breakdown
node scripts/audit-translations.mjs --sample 20 --tier high  # eyeball the worst
node scripts/audit-translations.mjs --collisions             # aspect pairs that read alike
node scripts/audit-translations.mjs --collisions --all       # …incl. verb-frame-only matches
node scripts/audit-translations.mjs --shard                  # cut work packets
node scripts/apply-translation-review.mjs review/proposals/*.jsonl          # dry run
node scripts/apply-translation-review.mjs review/proposals/*.jsonl --apply  # write
```

`review/packets/` is generated and gitignored. `review/proposals/` **is**
committed: it is the record of what was changed and why, and it is what makes a
sweep of this size reviewable after the fact.

## Verifying a sweep

A pass that "improves" 3,000 sentences is only trustworthy if it can be checked:

1. `npm test` and `npm run lint` — the shape guards.
2. Every proposal round-trips: the applier reports **0 unmatched**. A proposal
   the applier cannot place is a silently dropped review, so this number
   matters more than any quality metric.
3. Spot-read the diff. It is minimal by construction, so this is feasible, and
   it is the only check that actually reads the new English.
4. The `keep` rate on the sampled `clean` phrases estimates the heuristics'
   false-negative rate, and says whether a full sweep is worth running.

**Do not use mean literalness as a success metric.** It was the obvious choice
and the pilot showed it is wrong, in two independent ways:

- *Scale.* A packet changes ~5% of its own phrases, which is ~0.05% of the
  corpus. The figure does not move at three decimal places, so it can neither
  confirm nor refute a good pass.
- *Direction.* A **correct** fix often makes the score worse. "We are all
  divine creatures" → "We are all God's creatures" is right — «бо́жий» is
  *God's* — but the headword gloss says "divine", so the corrected sentence now
  fails to align where the wrong one aligned. Where the gloss is the defective
  half, fixing the sentence necessarily lowers literalness.

That second case is the review's most useful by-product: a cluster of
`gloss-mismatch` findings is the corpus telling you which **headword glosses**
are too narrow (`бо́жий` "divine", `ве́рный` "faithful" missing "accurate",
`вре́дный` "harmful" missing "nasty", `бело́к` "protein" missing "egg white").
Those are `flag`s, not edits — the fix belongs in the word's `en_gb`, not in
the sentence, and it should be made deliberately rather than as a side effect.
