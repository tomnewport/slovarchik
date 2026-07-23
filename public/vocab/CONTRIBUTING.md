# Contributing to the vocabulary

This folder is the **vocabulary database**. Each file is human-editable YAML —
no code change is needed to add words. This guide is the detailed reference; the
[README's "Adding words"](../../README.md#adding-words) section is the short
version.

> **TL;DR workflow**
> 1. Add/edit an entry in the right `*.yml` file (schema below).
> 2. Keep the file sorted: `node scripts/sort-vocab.js public/vocab/<file>.yml`.
> 3. Bump that file's `updated` timestamp in [`manifest.json`](manifest.json).
> 4. `npm test` — the suites guard the shape. Fix anything red.

---

## The quality bar for new vocabulary

The schema below tells you what is _valid_. This section tells you what is
_good_. Older entries are mixed quality; **new entries are held to the higher
standard**, and the goal is to raise the average as we go. The bar exists because
scripted/templated authoring produced most of the problems catalogued in the
issue tracker (#345–#359). Every point below is a lesson paid for by a bug.

Author **by hand, one word at a time.** Never batch-generate sentences from a
template — that is precisely what created the «За́втра я бу́ду…» / «На столе́
лежи́т…» monoculture (#352, #356). If you catch yourself filling a frame, stop.

**1. Every sentence is one a native speaker would actually say.** Real context,
real register. No circular sentences invented to force a grammatical slot
(«Держи́сь за пери́ла, и бу́дешь держа́ться кре́пко.»), no semantically odd
content (ants building a *house* not a `мураве́йник`; a *personal* intelligentsia
one can be proud of). Read each aloud; if it reads like a translation exercise or
textbook filler, rewrite it. (#347)

**2. Grammatically correct — verify, don't assume.** Case government, agreement,
aspect, motion-vs-location (motion → accusative destination), `что́бы` + **past**
form (never future), real-vs-unreal conditionals (`бы` on both halves or
neither). These are the errors that shipped in #345. When in doubt about a
government or an ending, check it.

**3. Correct orthography, always.** Combining acute **U+0301** on the stressed
vowel of every polysyllable; **ё spelled ё** in keys, forms and sentences;
monosyllables carry no mark. (#346)

**4. Breadth of forms per word — not a single slot.** The user-facing goal is
"a good number of *different* uses for each word." A noun met only ever in the
accusative teaches one sixth of its declension. Aim for each word's `usage:` set
to show it in **≥2 distinct grammatical contexts** (3+ is better): a nominative
subject *plus* an oblique case chosen for naturalness — a kitchen noun in «на
ку́хне» (prepositional), an instrument in the instrumental, a person in
dative/accusative, a possessor in «у + genitive». (#356)

**5. Make the bank converse.** The corpus skews to third-person declaratives; a
learner drilling it never asks anyone anything and is never addressed. Where it
suits the word, include:

- **questions and second person** (ты/вы): «Где ты живёшь?», «Ско́лько э́то
  сто́ит?», «Вы говори́те по-англи́йски?» (#350)
- **imperatives**, biased toward polite -те requests a visitor actually uses:
  «Скажи́те, пожа́луйста…», «Не забу́дьте биле́ты!» (negated imperatives are
  imperfective where idiomatic). (#349)
- **survival formulas** on the word that owns them: «Меня́ зову́т…» (on `звать`),
  «Мо́жно…?» (on `мо́жно`), «С удово́льствием» (on `удово́льствие`). (#351)
- for **pronouns**, show the traps the learner needs to meet repeatedly: the
  н- prefix after prepositions (у него́, с ни́ми), свой vs его́/её/их, dative
  experiencers (Мне хо́лодно, Ему́ два́дцать лет), negative doubling (Никто́
  ничего́ не зна́ет), split negatives (ни с кем, ни о чём). (#355)

**6. Annotate inflection richly.** Add an `inflect:` block to every usage where
the target word sits in a **pin-downable** inflected slot (not a bare nominative
subject, not an invariable POS). Spread the annotations across a word's examples
so different cases/tenses/persons are covered, and reference the correct `rule:`
id. Verify with `node scripts/annotate-inflect.mjs` and `npm test` — a
mis-counted `token` index or wrong case/number fails `phrasesData.test.js`. (#359)

**7. Accept fair alternate translations (`en_alt`).** Russian has no articles and
freer word order, so one sentence often has several right English renderings.
Add them so the word-bank drill doesn't reject a correct answer: existential
"there is/are…" for «На столе́ лежи́т…», "has got" for «У него́…», "I feel cold"
for «Мне хо́лодно». Only add renderings a careful translator would accept — a
wrong `en_alt` silently teaches an error. (Grading already forgives
articles/punctuation, so don't add variants differing only by "a"/"the".) (#357)

**8. Teach the grammar, not just the ending.** When an example exercises a
**non-intuitive** use of a case, make sure the `grammar-rules.yml` rule it
references explains the *function* — instrumental for a profession or the time of
day, dative for age, prepositional for what someone is wearing — not merely how
the ending is built. If the use isn't covered by an existing rule, extend it.

**9. Full, correct paradigms.** Nouns: all six cases for every number declared.
Verbs: `aspect` + full `conjugation` + `imperative`. Adjectives: full agreement
forms. Watch the traps: substantivised adjectives (`гости́ная`, `столо́вая`,
`бу́лочная`, `шампа́нское`) decline as **adjectives**, not nouns; indeclinables
(`бунга́ло`, `спаге́тти`, `та́нго`) take no table; pluralia tantum (`очки́`,
`часы́`) get only `pl_*`. Scaffold with the `scripts/gen-*.mjs` helpers and
verify with `npm test`.

**10. Leave no word un-glossable.** Every word you introduce in an example needs
a dictionary entry so tap-hints can translate it — a real POS entry, or a
`learn: false` gloss-only entry (usually in `glossary.yml`). Keep `node
scripts/coverage-gloss.js` at **0**. (#326)

> **Self-check before committing a batch:** would a native speaker say every
> sentence? Is every word shown in more than one form? Does at least one example
> ask a question or give a command? Are the `inflect:` annotations present and
> passing? Is `coverage-gloss.js` at 0 and `npm test` green?

---

## How the data is organised

- **One file per part of speech** (`nouns.yml`, `verbs.yml`, …). `calendar.yml`
  is also nouns (days/months/festivals), grouped by topic.
- [`manifest.json`](manifest.json) lists every file, its `pos`, and an `updated`
  timestamp. The app downloads a file only when its timestamp is newer than the
  copy cached in IndexedDB, so **you must bump `updated` for changes to ship**.
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

### Verbs (`verbs.yml`)

```yaml
"бегать=to run":
  cefr_level: A2
  accented: бе́гать      # the infinitive (dictionary form), stressed
  aspect: impf          # impf | pf
  en_gb:
    standard: to run (to move fast on foot)
  conjugation:
    present:            # use `future` instead for perfective verbs
      "1sg": бе́гаю
      "2sg": бе́гаешь
      "3sg": бе́гает
      "1pl": бе́гаем
      "2pl": бе́гаете
      "3pl": бе́гают
    past_m: бе́гал
    past_f: бе́гала
    past_n: бе́гало
    past_pl: бе́гали
```

Person/number keys (`1sg`…`3pl`) and `future` must be **quoted** in YAML.

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
  adjective forms are syncretic.
- **Verbs:** `tense` (`present`/`future`/`past`) + `person`
  (`1sg 2sg 3sg 1pl 2pl 3pl`, or `past_m/f/n/pl`). Verbs skip the case step.

`token` is the 1-based index of the target in the whitespace-split `ru`
(punctuation stays attached to its word); the token's letters must equal the
word's stored form for that exact slot. `phrasesData.test.js` asserts this for
every annotation — a mis-counted index or a wrong case/number fails the test.

Coverage is per-**inflection-type**, not per word: not every word needs an
annotation for every case, but each kind of inflection should be represented
across subjects. Annotating the example also leaves the sentence available to
the translation/spelling/listening drills, so a good example improves several
drills at once.

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

`grammar-rules.yml` is listed in `manifest.json` (bump its `updated` when you
change it; bump a word file's `updated` when you add `inflect:` annotations).

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
3. Add the file to [`manifest.json`](manifest.json) with its `pos` and `updated`.
4. `npm test`.
</content>
