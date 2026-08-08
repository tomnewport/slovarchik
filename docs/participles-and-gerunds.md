# Participles and gerunds — design note

> Status: **stage 1 landed** (#564). The four decisions below are settled and
> the machinery they describe is in the code: the storage blocks, the shared
> `adjectiveDeclension.js`, the two paradigm variants, the `form:` annotation
> dimension, the seven grammar rules and every integrity guard. Stages 2–4 are
> data, and the corpus stores **no** participle or gerund yet — the guards run
> vacuously today and start biting the moment the first one lands.

## The hole

Русские причастия and деепричастия are the last productive inflection class the
corpus doesn't teach. Counted against `public/vocab/verbs.yml` as it stands
today (977 verbs — the issue's figures were 963):

```
past_n:977  past_f:975  past_m:975  past_pl:976  future:498  present:479  imperative:407
```

Zero participles, zero gerunds, and no rule in `grammar-rules.yml` mentioning
either. Both are unavoidable in written Russian and sit at B1–B2, comfortably
inside a corpus with 565 B1 and 65 B2 verbs.

They already leak in, in three places, and every one of them teaches the form as
an unrelated lexical item rather than as a verb form:

1. **Nine entries in `adjectives.yml`** — откры́тый, закры́тый, при́нятый,
   вооружённый, заключённый, бы́вший, бу́дущий, сле́дующий, настоя́щий. Two of
   them (откры́тый, закры́тый) already carry a `short:` block, which *is* the
   short past passive participle under another name.
2. **~24 gloss-only entries in `glossary.yml`** — плачущего, тонущего,
   моросящим, командующий, реша́ющий, опа́вшими, пропа́вшего, подозрева́емый,
   повреждённого, переполненный, сло́манный, поте́рянный, укра́денное,
   задержанный, включённым, затаённым, общепринятый, пле́нные — plus the four
   gerunds поду́мав, услы́шав, уви́дев, попроща́вшись and су́дя.
3. **Three lexicalised gerunds taught as other parts of speech** — благодаря́
   and несмотря́ (`prepositions.yml`), мо́лча (`adverbs.yml`). These are the
   *right* call for those three words, and they set the precedent for the
   lexicalisation rule below.

The annotation triage already recorded the gap without being able to act on it:
`phrases-inflect-floor.md` has a `FLOOR-verb-gerund` bucket — "деепричастие —
not a conjugation cell" — filed under FLOOR, the disposition meaning *genuinely
cannot carry an `inflect:` annotation*. With a `gerund:` slot to point at, it
stops being a floor and becomes annotatable. (Two of that bucket's five entries
are mis-filed — бро́сился and не уда́рься are finite forms, and оста́лся is the
conditional — so the reclassification is small, but it is the right one.)

The phrases those forms appear in are good phrases (`Он отве́тил, не поду́мав.`,
`Су́дя по всему́, бу́дет дождь.`, `Он ушёл не попроща́вшись.`, `Гроб опусти́ли в
зе́млю под морося́щим дождём.`). The learner can tap them for a gloss and gets no
way back to the verb they came from.

## Decision 1 — storage: sibling blocks, not new `conjugation:` keys

`conjugation:` is a flat map of finite cells (`present.1sg`, `past_f`, …), and
three consumers depend on that shape: `paradigm.js` looks up `conj[row]`,
`morphOracle.conjugationCells` walks it as `block.person` pairs, and
`personCellDuplicates` asserts no two *person* cells collide. A participle is
not a person cell — it is a word that agrees like `но́вый` — so it goes in its
own blocks:

```yaml
"прочитать=to read":
  aspect: pf
  conjugation: { ... }          # unchanged
  participles:
    act_past: прочита́вший       # active past   — "the one who read"
    pass_past: прочи́танный      # passive past  — "the thing that was read"
    pass_short:                 # predicate passive — «Кни́га прочи́тана»
      m: прочи́тан
      f: прочи́тана
      n: прочи́тано
      pl: прочи́таны
  gerund: прочита́в              # деепричастие — "having read"
```

**One accented form per slot, not a 24-cell grid.** The stem is unpredictable
and must be stored (чита́ющий / прочи́танный / ведо́мый); the agreement grid is
not — participles decline exactly like adjectives, and
`scripts/gen-adjective-declension.mjs` already proves that derivation against
six golden paradigms plus every curated nominative in the file (504 adjectives
today) and refuses to write when one disagrees. Storing grids
would add ~100 lines per verb to a 40k-line file for zero information.

The short passive *is* stored explicitly, because that is where the stress
genuinely moves (при́нятый → принята́, начатый → начата́). Across the long grid,
stress on -щий / -вший / -нный / -тый / -мый is fixed on the syllable the
m-nominative marks, so deriving it is safe; in the short forms it is mobile, so
the same "store, don't derive" rule as `short:` on adjectives applies.

`gerund:` is a single scalar, not `{ impf, pf }`: a verb forms the gerund of its
own aspect, and `aspect:` already says which — the same way the data keys
`present:` off imperfective and `future:` off perfective. Reflexives store the
`-вшись` form (попроща́вшись).

**Which slots a verb may carry**, enforced by a data test rather than left to
the author:

| slot | imperfective | perfective |
| --- | --- | --- |
| `act_pres` | ✔ чита́ющий | — (no present stem) |
| `act_past` | ✔ чита́вший | ✔ прочита́вший |
| `pass_pres` | rare, closed class (люби́мый, уважа́емый, ведо́мый) | — |
| `pass_past` | rare | ✔ transitive only (прочи́танный) |
| `pass_short` | rare | ✔ transitive only (прочи́тан) |
| `gerund` | ✔ чита́я | ✔ прочита́в |

Every block is **optional and gappy on purpose** — the `defective:` rule
applies verbatim: store only the forms that exist, never pad. Plenty of common
imperfectives have no gerund at all (ждать, пить, петь, писа́ть, бежа́ть), and an
intransitive has no passive of either tense.

## Decision 2 — how they are drilled

**Both**, split by which skill each half teaches, because they are two different
skills:

### a. Formation → a separate paradigm variant

Not a new column on the verb's finite table. `assemble()` computes the
paradigm's stem as the longest common prefix of *every* cell, and `endingOf`
slices against it; folding пи́шущий/пи́санный in beside пишу́/писа́л collapses the
common stem of писа́ть from `пиш`/`писа` to `пи` and degrades "Type the endings"
for the finite cells that work today. So the non-finite forms get their own
paradigm, exactly as adjective short forms do (`buildShortParadigm`,
`paradigm.js:259`):

- `buildNonFiniteParadigm(word)` → key `${word.key}#nonfinite`, label
  "Participles & gerund". Single column, rows `act_pres`, `act_past`,
  `pass_pres`, `pass_past`, `gerund`. `assemble` prunes the empty rows, so a
  perfective intransitive is left with two cells and — under the existing
  three-cell floor — is correctly dropped rather than drilled as a degenerate
  table.
- `buildPassiveShortParadigm(word)` → key `${word.key}#passive-short`, the
  m/f/n/pl agreement table, structurally identical to the adjective short form.

Both are returned from `buildParadigms`, so they appear on the free-practice
`/verbs` route immediately. **Honest limitation:** like `#short` today, a
variant paradigm does *not* reach the mastery session — `exerciseBuild.buildInflect`
builds from `buildParadigm(record)` (`exerciseBuild.js:418`), which returns only
the primary table. Wiring variants into the session pool is a named follow-up,
shared with the adjective short forms, and should not be smuggled into this
work.

### b. Meaning and use → context phrases, the main vehicle

The `inflect:` annotation gains one dimension, `form:`, with values
`act_pres act_past pass_pres pass_past pass_short gerund`:

```yaml
"плакать=to cry":
  usage:
    - ru: Она́ успока́ивала пла́чущего ребёнка.
      en_gb: She was comforting the crying child.
      inflect: { token: 2, form: act_pres, case: acc, number: sg, gender: m,
                 animate: true, rule: verb-participle-act-pres }
"закрыть=to close":
  usage:
    - ru: Магази́н закры́т до утра́.
      en_gb: The shop is closed until morning.
      inflect: { token: 2, form: pass_short, gender: m, rule: verb-participle-short }
"подумать=to think":
  usage:
    - ru: Он отве́тил, не поду́мав.
      en_gb: He answered without thinking.
      inflect: { token: 4, form: gerund, rule: verb-gerund-pf }
```

Note the annotation moves from the glossary entry to **the verb's own usage
example**, which is what makes the form reachable: a context phrase teaches its
owner (that is exactly why `degreeCoverage` exists).

`phraseContext.selectSteps` gains a `formStep` mirroring `degreeStep`
(`phraseContext.js:270`) — "Which form of the verb does the sentence need?",
offering the slots the verb actually stores plus the annotated one:

| annotated as | steps |
| --- | --- |
| `gerund` | form only (invariable) |
| `pass_short` | form → gender/number |
| a participle in the nominative | form → gender/number |
| a participle in an oblique case | form → case → gender/number |

The answer for an oblique participle is derived, which needs one refactor:
lift the ending tables and `declineAdjective()` out of
`scripts/gen-adjective-declension.mjs` into a pure `src/lib/adjectiveDeclension.js`
(co-located test), with the script importing it. The app then derives a
participle's grid on demand, and the generator keeps its golden paradigms and
its whole-file refusal guard, now as that module's test suite.

The same module makes participles hintable: `phraseHint.FORM_KEYS`
(`phraseHint.js:16`) gains `participles` and `gerund` — `collectStrings`
recurses, so the nested `pass_short` block comes along free — and `wordForms`
derives the oblique grid for verbs that carry a participle, so tapping
«пла́чущего» in a phrase resolves to пла́кать rather than to a glossary stub.

## Decision 3 — grammar rules

Seven new ids in `grammar-rules.yml`, following the house convention (lead with
what the form is *for*, then how it is built):

| id | teaches | `exception:` |
| --- | --- | --- |
| `verb-participle-act-pres` | -ущ/-ющ/-ащ/-ящ + adjective endings; "the one who is …ing"; replaces a кото́рый clause | no |
| `verb-participle-act-past` | -вш/-ш; "the one who …ed"; formed off the past stem | no |
| `verb-participle-pass-pres` | -ем/-им; a closed, bookish class (люби́мый, уважа́емый) | **yes** |
| `verb-participle-pass-past` | -нн/-т; transitive perfectives only; "the thing that was …ed" | no |
| `verb-participle-short` | the predicate passive: «Магази́н закры́т», «Всё гото́во»; agrees m/f/n/pl, mobile stress | **yes** |
| `verb-gerund-impf` | -я; the action *accompanying* the main verb (Он шёл, напева́я) | no |
| `verb-gerund-pf` | -в/-вши(сь); the action *preceding* it (Поду́мав, он отве́тил); the не поду́мав / не попроща́вшись pattern | no |

Marking the two hard ones `exception: true` gets them the existing 4× weighting
in `buildContextExercise` and the "Exception" pill on the rule panel.

`verb-gerund-impf` is also where the note about lexicalisation goes: благодаря́,
несмотря́ and мо́лча *are* gerunds that have hardened into a preposition and an
adverb, which is why the corpus files them that way — and which is the same
judgement Decision 4 applies to the nine adjectives.

## Decision 4 — the nine participles already in `adjectives.yml`

**They stay as adjective entries, and gain a back-link.** Not "either/or" —
both, with the adjective as the source of the declension grid and the verb link
as the explanation:

```yaml
# adjectives.yml
"закрытый=closed":
  from_verb: { key: "закрыть=to close", form: pass_past }
```

Rationale, per word:

- Deleting them would lose nine taught vocabulary items, two curated `short:`
  blocks, their usage phrases and their generated grids, to no benefit.
- Four of them are **fully lexicalised** and must keep an independent entry
  regardless: настоя́щий "genuine" is not "the one that is present", бу́дущий and
  сле́дующий are ordinary adjectives with no living verb behind them for a
  learner, бы́вший means "ex-". These get **no** `from_verb` link — the same
  treatment благодаря́ gets in `prepositions.yml`.
- The other five (откры́тый, закры́тый, при́нятый, вооружённый, заключённый) are
  transparently participles of verbs already in the corpus, and the link is the
  thing the learner is missing. The vocab word card already renders an aspect
  pair, a motion pair and a government frame beside the headword; the participle
  origin joins that row ("past passive participle of закры́ть").

A data test asserts that a `from_verb` link resolves, and that the adjective's
headword equals the verb's stored form for that slot letter-for-letter (stress
included) — so the two copies cannot drift. Where the verb entry also carries
`pass_short`, the adjective's existing `short:` block must agree with it by the
same test; закры́т/закры́та appearing twice with different stress is precisely the
bug this guard is for.

The ~24 glossary rows in group 2 need no decision here: once the verb stores the
form, `buildFormIndex` resolves the surface token to the verb (pass 2 already
prefers a real lemma over a gloss stub), and the stubs can be retired by the
existing `promote-glossary` cleanup as a follow-up.

## Data integrity

Everything below is CI, not authoring discipline.

**`verbsData.test.js`** gains:

- slot legality per aspect (the table in Decision 1) — no `act_pres` on a
  perfective, no `pass_*` on a verb with no accusative object, with a small
  keyed allowlist for the genuine oddities;
- `pass_short` is all four cells or absent — never three;
- every stored form shares a stem prefix with the infinitive (a cheap, high-signal
  guard against a pasted wrong lexeme);
- `from_verb` links resolve and agree, in both directions (Decision 4).

**`morphOracle.js`** gains a cell walk over the new blocks so
`impossibleOrthography` and the golden table cover them. It must *not* see them
as conjugation cells — `personCellDuplicates` would fire on пла́чущий vs
пла́кавший — which is the third argument for sibling blocks over new
`conjugation:` keys. `morphGolden.js` gets a hand-verified participle set
(the -нн/-н distinction: прочи́танный but прочи́тан; ведо́мый; при́нятый/при́нят).

**`stressAudit.js`** covers the new forms automatically once
`shapeContextPhrases` carries `form:`, since it grades an annotated token
against the word's own stored cell — the check that catches a mis-stressed
phrase *or* a mis-stressed paradigm.

**`src/lib/participleCoverage.js`** (new), a direct sibling of
`degreeCoverage.js`: enumerate every stored participle/gerund that no
`form:` annotation teaches. The test keeps that list at zero, so the corpus can
never again accumulate stored forms no drill can reach — the exact failure mode
#536 found for comparatives.

**CEFR.** The short passive is A2–B1 material («Магази́н закры́т» is A2 Russian);
full participles and gerunds are B2. Annotate accordingly so `audit-cefr.js`
and the batch engine don't drop a B2 construct into an A1 batch.

## Rollout

Full participle coverage across 977 verbs is a **non-goal**. The project's
coverage strategy is per-inflection-type, not per-word (see
`phrase-context-redesign.md` § Coverage strategy), and that is the right target
here too.

| stage | scope | new forms |
| --- | --- | --- |
| 1 | Machinery: blocks + `adjectiveDeclension.js` + paradigm variants + `form:` in `shapeContextPhrases`/`phraseContext` + the seven rules + tests + CONTRIBUTING | ~0 |
| 2 | Close the leak: the ~24 glossary participles/gerunds and the five linkable adjectives get their verb blocks and one annotated phrase each | ~35 verbs |
| 3 | The highest-yield real Russian: `pass_short` (+ `pass_past`) on transitive perfectives that already carry a `pair:` | ~200 verbs |
| 4 | `act_pres` / `act_past` / `gerund` on the A1–B1 imperfective core | ~120 verbs |

Stage 1 has landed alone and green. Each later stage is data plus annotations
against machinery that already exists — which is the property #564 says this work
lacked, and the reason for settling the four decisions first.

**Authoring a stage-2+ batch** is now purely additive, and
[`public/vocab/CONTRIBUTING.md`](../public/vocab/CONTRIBUTING.md) is the
reference: add the `participles:` / `gerund:` block, add one usage example
annotated `inflect: { form: … }` per stored slot, and CI does the rest. The
guards that will catch a mistake are `verbsData.test.js` (slot legality per
aspect, a complete `pass_short`, forms built on the verb's own stem, stress
marks), `participleCoverage.test.js` (a stored form no drill reaches, and the
mirror case of an annotation with nothing stored), `phrasesData.test.js` (the
annotated token equals the resolved form) and `stressData.test.js`.

## Settled at sign-off

1. **Deriving the participle grid rather than storing it** (Decision 1) — the
   one place this note breaks the corpus's usual "store, don't derive" habit.
   Adopted: participial stress is fixed across the long grid, and the derivation
   is now `src/lib/adjectiveDeclension.js`, guarded by the same seven golden
   paradigms the adjective generator has always refused to write without.
2. **The variant-paradigm limitation** (free practice only, no mastery session)
   is accepted for stage 1. `#nonfinite` and `#passive-short` reach `/verbs`
   immediately; wiring variants into `exerciseBuild.buildInflect` stays a
   follow-up shared with the adjective short forms, and is not smuggled in here.
3. **The stage 3/4 volume** — 320 verbs of hand-authored, stress-marked forms —
   remains the bulk of the cost and can still be cut to the A1–A2 core without
   changing anything above it.
