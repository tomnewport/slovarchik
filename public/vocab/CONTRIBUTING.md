# Contributing to the vocabulary

This folder is the **vocabulary database**. Each file is human-editable YAML —
no code change is needed to add words. This guide is the detailed reference; the
[README's "Adding words"](../../README.md#adding-words) section is the short
version.

> **TL;DR workflow**
> 1. Add/edit an entry in the right `*.yml` file (schema below).
> 2. Keep the file sorted: `node scripts/sort-vocab.js public/vocab/<file>.yml`.
> 3. `npm test` — the suites guard the shape. Fix anything red.
>
> There's no manifest step: `manifest.json` is generated (and not committed), so
> just edit the YAML and commit that.

---

## How the data is organised

- **One file per part of speech** (`nouns.yml`, `verbs.yml`, …). `calendar.yml`
  is also nouns (days/months/festivals), grouped by topic.
- `manifest.json` lists every file, its `pos`, an `updated` timestamp (shown
  in-app, read from git history) and a content `hash`. The app downloads a file
  only when its `hash` differs from the copy cached in IndexedDB. **The manifest
  is generated and not committed** — `npm run build` and `npm run dev` rebuild it
  from the YAML, so you never edit or commit it (that's what stops parallel vocab
  branches conflicting over it). Run `npm run gen:manifest` if you want to
  regenerate it by hand.
- At load time each file is parsed and normalised by
  [`src/lib/vocabBuild.js`](../../src/lib/vocabBuild.js) into the records the
  drills consume. Read that file if you need the exact transformation.

Each file looks like:

```yaml
# a header comment describing the file
---
meta:        # documentation only — describes the abbreviations used below.
  ...        # The app ignores `meta`; it's there for human readers.
words:
  "<russian>=<english>":
    ...
```

## The natural key

Every word is keyed by `"<russian>=<english>"` — e.g. `"ворота=gate"`. The key
is the word's **identity**, so:

- It must be **unique** across the file (the test suite enforces this).
- Use the **bare** Russian (no stress marks) and a short English on each side.
- The `=` disambiguates homographs: a word with two meanings that decline or
  translate differently gets **one entry per meaning** (`"замок=lock"` and
  `"замок=castle"`). Only the first `=` splits the key, so `"a=b=c"` → ru `a`,
  en `b=c`.

## Stress marks

Mark the stressed vowel with a **combining acute accent** (´, U+0301) placed
*after* the vowel — `воро́та`, `бе́гать`. The drills strip it when grading what
you type but show it for learning. **Monosyllabic words carry no mark** (their
single vowel is always stressed): `в`, `два`, `ах`.

Put the accented spelling wherever the schema asks for a *form* (declension
cells, conjugations, `forms`, `accented`). The bare key stays unaccented.

## The letter ё

Always write **ё** where the word has it — `неё`, `тёплый`, `пошёл` — in keys,
forms and example sentences alike. It's shown and pronounced as written, and the
guided keyboard walks learners through the real letter. Grading still accepts a
typed or spoken **е** in its place (a common everyday substitution), so writing
ё never makes an answer harder to get right. ё carries its own stress, so it
never also takes a combining accent.

## Fields every word can have

| Field         | Required | Notes                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `cefr_level`  | **yes**  | One of `A1 A2 B1 B2 C1 C2`. Validated by regex `^[ABC][12]$`.          |
| `en_gb`       | **yes**  | The meaning(s). See below.                                            |
| `accented`    | usually  | The stressed dictionary (headword) form. Required wherever there's no declension table to derive it from. |
| `usage`       | no       | Example sentences — see below. These also feed the **Phrases** drill. |
| `collections` | no       | Free-form topic tags (`[travel, daily life]`) used for grouping/skills. |
| `learn`       | no       | Set `false` to make a **gloss-only** entry: kept in the dictionary so phrase hints can translate it, but excluded from every drill, the phrase bank and the batch/progress engine. Defaults to `true`. See below. |

> **Do not add a `batteries:` field.** Older entries carried an experimental
> `batteries:` grouping tag. Nothing in the app ever read it — it duplicated
> `collections:` — so it has been removed from every entry. Use `collections:`
> (above) for topical grouping. If you are copying an old entry as a template
> and see `batteries:`, drop that line.

### `en_gb` — meaning and accepted answers

```yaml
en_gb:
  standard: gate (a doorlike structure outside a house)   # short gloss (clarification)
  alt:
    - goal (in sports, the area a ball is put into)
```

- `standard` is the primary gloss. The text **before** the first `(` is the
  short gloss shown and graded; the text **inside** `( )` is a clarifying note
  shown but not required when typing.
- `alt` lists extra acceptable meanings (same gloss/note convention).
- **Accepted English answers** are derived automatically: the key's English plus
  the short gloss of `standard` and of every `alt`. So `"ворота=gate"` accepts
  `gate`; add synonyms via `alt` rather than cramming them into the key.

### `usage` — example sentences

```yaml
usage:
  - ru: Больши́е воро́та ме́дленно откры́лись.
    en_gb: The big gate slowly opened.
```

Every `{ ru, en_gb }` pair is flattened (and de-duplicated) into the **Phrases**
drill bank, so good example sentences improve two drills at once. Mark stress in
the `ru` sentence.

A usage example may also carry **`en_alt`** — a list of additional English
renderings that should be accepted in the word-bank (assemble-the-translation)
drill. Russian has no articles and a freer word order, so one Russian sentence
often has several equally valid English translations. List the extras here so a
correct answer isn't graded wrong (the `en_gb` line stays the primary one shown):

```yaml
usage:
  - ru: Э́то большо́й го́род.
    en_gb: This is a big city.
    en_alt:
      - This city is big.
```

### Gloss-only entries (`learn: false`) and `glossary.yml`

When a learner reads a phrase they can tap any word they haven't learned to see
its meaning. Those hints resolve through a form index built from **every**
dictionary entry — so a word can only be hinted if it has an entry.

Example sentences naturally use words beyond the curriculum. To keep every
tappable word translatable without dragging those words into the drills, add a
**gloss-only** entry with `learn: false`:

```yaml
"полдень=noon":
  cefr_level: B1
  learn: false
  en_gb: { standard: noon (twelve o'clock in the daytime) }
  accented: по́лдень        # plus any inflected forms that occur, under `forms:`
```

A `learn: false` entry is indexed for hints but filtered out of the vocab,
declension and phrase drills and the batch/progress engine (see `learnableWords`
in `vocabBuild.js`). It needs only the usual `cefr_level` + `en_gb`, an
`accented`/`forms` entry for each surface form that appears, and **no** full
declension table.

The bulk of these live in **[`glossary.yml`](glossary.yml)** — an
auto-generated, alphabetised bank of gloss-only entries (its own `glossary`
"part of speech") covering the long tail of example-sentence words. The test
`glossCoverage.test.js` **fails if any phrase-bank word has no gloss**, so when
you add a usage example that introduces a new word, give that word an entry
(ideally in the right per-POS file, or as a gloss-only entry in `glossary.yml`).
Run `node scripts/coverage-gloss.js` to list any gaps.

> **⚠️ `glossary.yml` keys are surface forms, not lemmas.** Because the file is
> generated from the words that actually occur in example sentences, an entry's
> key may be an inflected form (`"азии=Asia"`, `"автономных=autonomous"`).
> That's exactly right for tap-hints, which look up surface forms — but never
> reuse these keys as dictionary headwords. If glossary entries are ever
> promoted into the curriculum, they must be lemmatised first (or the file
> extended with an explicit `lemma:` field).

---

## Per-part-of-speech schema

### Nouns (`nouns.yml`, `calendar.yml`)

```yaml
"абзац=paragraph":
  cefr_level: B1
  gender: m            # m | f | n  — omit for pluralia tantum
  animacy: i           # a (animate) | i (inanimate)
  number: ["sg", "pl"] # which numbers exist
  collections: [reading, school]
  en_gb:
    standard: paragraph (a block of text)
  usage:
    - ru: Прочита́йте пе́рвый абза́ц.
      en_gb: Read the first paragraph.
  declension:          # flat <number>_<case> keys
    sg_nom: абза́ц
    sg_gen: абза́ца
    sg_dat: абза́цу
    sg_acc: абза́ц
    sg_ins: абза́цем
    sg_pre: абза́це
    pl_nom: абза́цы
    pl_gen: абза́цев
    pl_dat: абза́цам
    pl_acc: абза́цы
    pl_ins: абза́цами
    pl_pre: абза́цах
```

- The six **cases** are `nom gen dat acc ins pre`; the two **numbers** are `sg`
  and `pl`. Declension keys are flat `<number>_<case>` (e.g. `pl_gen`).
- **Completeness is enforced:** for every number you list in `number`, all six
  cases must be present and non-empty. The `declension.test.js` suite fails
  otherwise.
- **Pluralia tantum** (plural-only) nouns: set `number: ["pl"]`, omit `gender`,
  and give only the `pl_*` cells (`деньги`, `ворота`).
- You do **not** encode syncretism (e.g. `книге` = dative *and* prepositional,
  or animate `acc pl` = `gen pl`). The drills compute it from the forms.
- Endings for the "endings only" advanced drill are derived automatically from
  the forms — no need to list them.
- **Second locative (`sg_loc`) — optional.** Some nouns take a special stressed
  *in/at* form after `в`/`на` that differs from the ordinary prepositional:
  `в лесу́` (locative) vs `о ле́се` (prepositional), `на берегу́`, `в году́`,
  `в тени́`. Add it **only** where that distinct form exists, as an extra
  `sg_loc` cell alongside the six cases:

  ```yaml
  declension:
    sg_nom: лес
    sg_gen: ле́са
    sg_dat: ле́су
    sg_acc: лес
    sg_ins: ле́сом
    sg_pre: ле́се      # ordinary prepositional (о ле́се)
    sg_loc: лесу́      # second locative (в лесу́)
    # …pl_* as usual
  ```

  It is **singular only** and always spelled like another case (the dative for
  masculines; the genitive/dative/prepositional for feminine `-ь` nouns),
  differing only in end stress — so it never changes grading, it just adds the
  correctly-stressed form and a "Locative" row (with an explanatory tooltip) to
  the declension table. Keep the real prepositional in `sg_pre`; don't put the
  `-у́` locative there.

- **`display_number` — show a usually-plural noun in the plural (optional).**
  Some nouns are stored under their singular dictionary form but are almost
  always *used* in the plural — перчатки (gloves), сапоги (boots), боти́нки
  (shoes), носки (socks). By default the **vocabulary word-drills** (flashcard /
  match, spell, speak, and the `/vocab` browser) show the singular headword;
  `display_number` overrides just those drills:

  ```yaml
  "перчатка=glove":
    number: ["sg", "pl"]
    display_number: pl   # sg (default) | pl | mixed
    en_pl: gloves        # English shown & accepted for the plural (list allowed)
    ...
  ```

  - `sg` (or omitted) — the historical behaviour, singular everywhere.
  - `pl` — the vocab drills show the **plural nominative** (`pl_nom`, already in
    the declension table) with the `en_pl` gloss.
  - `mixed` — the drills alternate singular and plural at random per exercise.
  - **`en_pl` is required** for `pl`/`mixed`: English plurals aren't reliably
    regular, so — like stress and short forms — the plural gloss is **stored, not
    derived**. It may be a single string or a list; the same
    short-gloss/parenthetical convention as `en_gb` applies. `en_pl` is the only
    accepted answer while the plural is shown.
  - Only the vocab word-drills honour this. The **inflection and phrase drills
    keep the singular headword and the full paradigm** — a learner still drills
    `перча́тка → перча́тки`. A truly plural-only word (очки, джинсы) is a
    **pluralia tantum** (`number: ["pl"]`) and needs none of this.
  - Guarded by `nounsData.test.js`: `display_number` must be `sg`/`pl`/`mixed`,
    and `pl`/`mixed` require a `pl` number, a `pl_nom` form and a non-empty
    `en_pl`.

### Verbs (`verbs.yml`)

```yaml
"покупать=to buy":
  cefr_level: A2
  accented: покупа́ть    # the infinitive (dictionary form), stressed
  aspect: impf          # impf | pf
  pair: "купить=to buy" # natural key of the aspect partner (see below)
  en_gb:
    standard: to buy (to get something by paying)
  conjugation:
    imperative:         # command forms (optional; sg = ты, pl = вы)
      sg: покупа́й
      pl: покупа́йте
    present:            # use `future` instead for perfective verbs
      "1sg": покупа́ю
      "2sg": покупа́ешь
      "3sg": покупа́ет
      "1pl": покупа́ем
      "2pl": покупа́ете
      "3pl": покупа́ют
    past_m: покупа́л
    past_f: покупа́ла
    past_n: покупа́ло
    past_pl: покупа́ли
```

Person/number keys (`1sg`…`3pl`) and `future` must be **quoted** in YAML.

- **`pair` — aspect partner (optional).** When both members of an aspect pair
  are in the lexicon (говори́ть/сказа́ть, покупа́ть/купи́ть), link them with
  `pair:` on **both** entries, each naming the other's natural key. The link
  must be reciprocal and connect one imperfective to one perfective
  (`verbsData.test.js` enforces this). Linked verbs show their partner in the
  vocabulary drill and power the choose-the-aspect step of the in-context
  drill. Don't link mere prefixed derivatives (проговори́ть, заговори́ть) or
  motion-verb directionality partners (бе́гать/бежа́ть — both imperfective) —
  only true aspect pairs.
- **`imperative` — command forms (optional).** An `imperative:` block with the
  accented `sg` (ты) and `pl` (вы) forms adds an Imperative column to the verb's
  inflection table and lets usage examples drill it. The plural is always
  `sg + те` (reflexives: `-ся` → `-тесь`), but both are stored explicitly.
  Leave the block off verbs with no natural command (мочь, хоте́ть, зна́чить,
  impersonals like хоте́ться).
- **`governs` — object case (optional).** For a verb whose object isn't the
  plain accusative, name the case it governs: `governs: dat` (помога́ть,
  звони́ть, ве́рить, меша́ть, сове́товать), `gen` (ждать, боя́ться, жела́ть) or
  `ins` (интересова́ться, занима́ться, горди́ться, по́льзоваться). One of
  `dat`/`gen`/`ins`; leave it off ordinary accusative or intransitive verbs.
  This feeds the **verb-government drill** (`/verb-government`). To exercise a
  government, annotate the *governed object* in a usage example with that case
  and the matching rule — e.g. on `мама`:

  ```yaml
  usage:
    - ru: Я ча́сто помога́ю ма́ме.
      en_gb: I often help my mum.
      inflect: { token: 4, case: dat, number: sg, rule: verb-gov-dative }
  ```

  The rules (`verb-gov-dative` / `-genitive` / `-instrumental` in
  `grammar-rules.yml`) are marked `exception: true`, so the drill weights them
  4×; a data test cross-checks that a matching governing verb really appears in
  the sentence.

### Adjectives (`adjectives.yml`)

```yaml
"бедный=poor":
  cefr_level: B1
  accented: бе́дный      # masculine nominative singular = headword
  en_gb: { standard: poor (having little money) }
  forms:
    m: бе́дный
    f: бе́дная
    n: бе́дное
    pl: бе́дные
    comparative: бедне́е  # optional
```

The full case × gender/number `declension` grid is **generated** — run
`node scripts/gen-adjective-declension.mjs` (or `npm run gen:adjectives`), which
derives all 24 forms from `forms` and splices them in. Don't hand-write it.

#### Short (predicate) forms — `short:` (optional)

Russian adjectives have a **short form** used as a predicate — «Я гото́в», «Она́
занята́», «Ты рад». Add a `short:` block with the four accented agreement forms
where the short form is actually used (many adjectives never take one, so leave
it off). It sits alongside `forms:`:

```yaml
"нужный=necessary":
  ...
  forms:
    m: ну́жный
    f: ну́жная
    n: ну́жное
    pl: ну́жные
  short:            # predicate forms — store the stress, it shifts
    m: ну́жен
    f: нужна́
    n: ну́жно
    pl: нужны́
```

- **Store the stress explicitly** — it is mobile and cannot be derived
  (ну́жен → нужна́, до́лжен → должна́ → должны́), the same "store, don't derive"
  rule as elsewhere.
- The short forms are indexed for phrase hints and drive a dedicated **short-form
  paradigm** in the inflection drill (a separate m/f/n/pl table from the full
  declension). `scripts/gen-adjective-declension.mjs` leaves `short:` untouched.
- **Short-form-only lexemes** (рад, до́лжен) have no long form: give them
  `accented` (the masculine short form) + a `short:` block and **omit** `forms:`
  and the `declension:` grid entirely. The generator skips them, and they drill
  as a short-form paradigm only.

### Pronouns (`pronouns.yml`)

Set `type` (`pers refl poss demo det inter neg`); the `forms` block depends on it:

- `pers` / `refl` / `neg` / interrogative `кто`,`что` → the six cases
  `nom…pre` of the single pronoun (reflexive `себя` has no `nom`).
- `poss` / `demo` / `det` / interrogative `какой`,`чей` → they decline like
  adjectives, so give nominative agreement forms `m f n pl` (`accented` is the
  masculine nominative) **plus** a `declension` block with the full case ×
  gender/number table (flat `<gender>_<case>` keys, e.g. `m_gen`, `f_acc`,
  `pl_ins`). The blocks are curated and validated by
  `scripts/gen-pronoun-declension.mjs` (`node scripts/gen-pronoun-declension.mjs`).
- A few (`его`, `её`, `их`, `сколько`) take **no** `forms` block.

### Numerals (`numerals.yml`)

```yaml
"один=one":
  cefr_level: A1
  type: cardinal        # cardinal | ordinal | collective | quantity | year
  value: 1              # the number it names (plain int/decimal), where applicable
  accented: оди́н
  en_gb: { standard: one (feminine "одна", neuter "одно", plural "одни") }
  forms:
    nom: { m: оди́н, f: одна́, n: одно́, pl: одни́ }
    gen: { m: одного́, f: одно́й, n: одного́, pl: одни́х }
    # …dat, acc, ins, pre
```

- **Cardinals** carry the six cases. `один` (and similar) split each case into
  `m f n pl`; most cardinals share one set of case forms.
- **Ordinals** decline like adjectives → give `m f n pl` nominatives; `accented`
  is the masculine nominative.
- Spelled-out **years** are phrases and carry no `forms` block.

### Adverbs (`adverbs.yml`)

Mostly invariable: `accented` + `en_gb` (+ optional `usage`, `collections`). Add
`forms: { comparative: <form> }` only if it has a comparative.

### Prepositions (`prepositions.yml`)

```yaml
"в=in":
  cefr_level: A1
  accented: в
  governs: ["acc", "pre"]   # the case(s) it requires
  en_gb: { standard: in (inside something), alt: [into (with the accusative)] }
```

### Conjunctions & interjections

Set `type` (conjunctions: `coord`/`subord`; interjections: `greet`, `excl`,
`polite`, `resp`, …) plus `accented` + `en_gb` (+ optional `usage`). No
inflection tables.

---

## Heteronyms (same spelling, different stress → different meaning)

Two mechanisms, pick the one that fits:

1. **Headword collisions are auto-detected.** If two entries' `accented`
   headwords share the same letters but differ in stress (`за́мок` "castle" vs
   `замо́к` "lock"), `vocabBuild.js` links them automatically — do nothing.
   (Two entries with *identical* stress are mere homonyms and are **not**
   linked, e.g. `коса́` "plait"/"scythe".)
2. **Inflected-form collisions need an explicit annotation,** because the
   dictionary forms differ and only an inflected form collides (`стоить`→`сто́ит`
   "it costs" vs `стоять`→`стои́т` "it stands"):

   ```yaml
   heteronyms:
     - { ru: сто́ит, gloss: it costs }
     - { ru: стои́т, gloss: it stands }
   ```

---

## Context-drill annotations (`inflect:` on usage + `grammar-rules.yml`)

The in-context inflection drill ("fix the phrase": pick the case a slot needs,
then spell the form) is driven by the **`usage:` examples words already carry** —
just annotated. See
[`docs/phrase-context-redesign.md`](../../docs/phrase-context-redesign.md).

Add an optional **`inflect:`** block to any usage example to mark which token is
the word being taught and how it's inflected. The target word is the example's
owner, so its key is implicit:

```yaml
"бабочка=butterfly":
  ...
  usage:
    - ru: Де́вочка пойма́ла ба́бочку.
      en_gb: The girl caught a butterfly.   # natural English; make number explicit
      inflect: { token: 3, case: acc, number: sg, rule: noun-acc-sg }
```

- **Nouns / pronouns:** `case` + `number`.
- **Adjectives:** add `gender` (`m`/`n`/`f`/`pl`). Case-selection only works for
  forms with a distinctive ending (mainly feminine `-ая`/`-ую`), since most
  adjective forms are syncretic. For the **animate accusative** — a masculine or
  plural adjective agreeing with an animate noun, which copies the genitive form
  (ви́жу хоро́шего дру́га) — annotate `case: acc` with `animate: true` and
  `rule: adj-acc-animate`; the slot is still graded as the accusative, animacy
  just selects the form. (The inflection **table** shows this as a derived
  "Accusative (animate)" row automatically — no data needed.)
- **Verbs:** `tense` (`present`/`future`/`past`/`imperative`) + `person`
  (`1sg 2sg 3sg 1pl 2pl 3pl`, `past_m/f/n/pl`, or `imp_sg`/`imp_pl` for the
  imperative). Verbs skip the case step — but a verb with a `pair:` link gets a
  **choose-the-aspect** step first: the sentence is shown with both partners as
  options and the learner picks the one the context needs.

`token` is the 1-based index of the target in the whitespace-split `ru`
(punctuation stays attached to its word); the token's letters must equal the
word's stored form for that exact slot. `phrasesData.test.js` asserts this for
every annotation — a mis-counted index or a wrong case/number fails the test.

Coverage is per-**inflection-type**, not per word: not every word needs an
annotation for every case, but each kind of inflection should be represented
across subjects. Annotating the example also leaves the sentence available to
the translation/spelling/listening drills, so a good example improves several
drills at once.

**Bulk-annotating.** `node scripts/annotate-inflect.mjs` fills in `inflect:`
blocks for usage examples that lack them, but only where the grammatical slot is
provable — the token's form matches exactly one paradigm cell, or a governing
preposition pins the case. It never annotates nominative subjects and skips
genuinely ambiguous sentences. Run it (`--apply`) after adding words, then
review the diff; hand-annotate the ambiguous cases it leaves behind.

**`grammar-rules.yml`** — short rule/formula explanations keyed by id (referenced
by `inflect.rule`), shown when the answer is revealed. It is loaded separately
(it has no `words:` block):

```yaml
rules:
  noun-acc-sg:
    title: "Accusative singular"
    formula: "f -а → -у · inanimate m/n = nominative · animate m = genitive"
    explanation: >
      The accusative is the direct object…
    exceptions:
      - "Feminine -ь nouns don't change: мать → мать."
```

`grammar-rules.yml` is listed in the manifest like any other file — editing it
(or any word file, e.g. adding `inflect:` annotations) refreshes its content
`hash` at the next build, and clients re-sync on that change. Nothing to run.

---

## What the tests check (so you don't have to guess)

`npm test` runs, among others, `vocabBuild.test.js` and `declension.test.js`,
which assert that the **real** files on disk:

- have **unique** natural keys;
- give every word a valid **CEFR** level (`^[ABC][12]$`), a non-empty
  **meaning**, and at least one accepted **English** answer;
- are **sorted** alphabetically by Russian (ignoring stress);
- give every noun **all six cases** for each number it declares;
- produce at least one usage **phrase** overall.

Keeping files sorted is mechanical — run `node scripts/sort-vocab.js
public/vocab/<file>.yml`, which reorders entries by Russian headword while
preserving the header/`meta` block and each entry verbatim.

## Adding a whole new part of speech

1. Create `public/vocab/<name>.yml` with a `words:` block.
2. Register the filename → POS in **both** `POS_BY_FILE` and `partsOfSpeech` in
   [`src/lib/vocabBuild.js`](../../src/lib/vocabBuild.js).
3. Register the filename → POS in the `FILES` list in
   [`scripts/gen-manifest.mjs`](../../scripts/gen-manifest.mjs) — the next build
   picks it up into the (generated) manifest automatically.
4. `npm test`.
</content>
