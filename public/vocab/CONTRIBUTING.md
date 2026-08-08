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
| `collections` | no       | Topic tags (`[travel, daily life]`) that let a batch be *themed*. Pick from the registry in [`src/lib/collections.js`](../../src/lib/collections.js) — anything else fails `collections.test.js`. See below. |
| `learn`       | no       | Set `false` to make a **gloss-only** entry: kept in the dictionary so phrase hints can translate it, but excluded from every drill, the phrase bank and the batch/progress engine. Defaults to `true`. See below. |

#### `collections` — topic tags

Tags are what make a batch themed: a named learning batch has to draw 15 of its
20 words from one collection, or it falls back to "Random". Two rules follow,
both enforced by `src/lib/collections.test.js`:

- **Use a registered name.** The allowed set lives in `src/lib/collections.js`.
- **Don't invent a tag for a handful of words.** A collection needs at least
  `MIN_COLLECTION_WORDS` (15) words in the corpus, so a new one has to arrive
  with a body of words behind it. Where an existing tag nearly fits, tag with
  that instead of splitting the theme.

Tag generously — two or three tags per word is normal, and an untagged word can
only ever be batch filler.

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
- **The note has to distinguish.** A spelling drill prompts English→Russian with
  the short gloss, the note and the part of speech, and nothing else — so two
  words sharing all three ask a question that can only be guessed at. Write
  notes that separate near-synonyms (`брю́ки` "(the standard word)" vs `штаны́`
  "(the informal word)"), not notes that merely restate the gloss. Aspect pairs
  need nothing: the prompt shows the aspect, which already tells them apart.
  `spellPromptData.test.js` fails CI on any collision (#527).

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

#### Subject gender — keep it balanced (#525, #541)

Russian marks the subject's gender on the **past-tense verb** (я сде́лал vs
я сде́лала, ты уста́л vs ты уста́ла) and on **predicate short adjectives** (я рад
vs я ра́да). The gender of «я» in "I was at work" is arbitrary, so across the
corpus the two should be **even** — don't let examples default to masculine
(first person used to be ~99% male, second person ~95%). When you add
past-tense or predicate sentences with a «я» or «ты» subject, mix the genders; a
feminine subject is the correct answer just as often as a masculine one, and
there's nothing "stereotypically feminine" required to justify it.

This matters most for **«ты»**: the addressee is the learner, so an all-masculine
second person is the corpus telling every learner what gender they are — and the
prompt annotations print it ("You (informal, to a man) answered correctly").

- Feminine past verbs come straight from the verb's own `past_f` cell — copy
  that form (with its stress: была́, взяла́, начала́ shift the stress; сде́лала,
  купи́ла don't), never guess it by appending `-а`.
- If such an example carries an `inflect:` block, its `person:` must match
  the gender you wrote (`past_m` vs `past_f`, or `gender: m`/`f` for a short
  form) — the context drill grades the shown token against that slot.
- **`npm run audit:gender`** prints the current split and per-file breakdown, and
  `node scripts/rebalance-gender.mjs` can even it out by flipping a safe subset
  of masculine verb phrases to feminine. See
  [`docs/gender-balance.md`](../../docs/gender-balance.md).

#### Ambiguity annotations (nothing to write)

When a drill shows only the English and asks for the Russian, the English often
under-determines the answer: "Do you want tea?" hides ты vs вы, and — now that
subject gender is genuinely mixed — "I was tired" hides уста́л vs уста́ла.
The prompt therefore annotates the ambiguous word ("Do you (informal) want
tea?"), working it out **automatically** from your `ru` sentence
([`src/lib/phraseAmbiguity.js`](../../src/lib/phraseAmbiguity.js)). There's no
field to fill in, but two things help it:

- **Write the sentence naturally and completely.** The evidence it reads is the
  ты/вы pronouns and possessives, unambiguous 2sg/2pl and imperative verb forms,
  and past-tense/short-adjective agreement in the same clause as «я» or «ты».
- **Keep the `conjugation` table of any verb you use complete and correct.** A
  missing imperative or past cell simply means the phrase says nothing, and the
  prompt stays unannotated (never wrongly annotated).

A sentence that marks nothing — a generic "you can…" rendered with мо́жно —
gets no annotation, which is correct: nothing is being hidden.

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
- **Per-cell notes (`declension_notes`) — optional.** A cell can carry a short
  explanation, surfaced as an ⓘ tooltip on that cell in the declension drills.
  Use it for a genuinely irregular or suppletive form that would otherwise look
  like a mistake — e.g. the genitive plural of `год` is the suppletive **лет**
  («ско́лько тебе́ лет?»), not the regular `годо́в`. The table still stores exactly
  one form per cell; store the form learners should actually produce and explain
  it in the note. Keys mirror `declension` (`<number>_<case>`):

  ```yaml
  declension:
    # …
    pl_gen: лет          # the form the drill teaches
  declension_notes:
    pl_gen: >-
      Suppletive genitive plural: after quantities Russian uses лет — «мно́го
      лет» — not the regular годо́в.
  ```

  Notes are display-only: they don't affect grading, matching, or the ending
  drills. Add one only where the form is surprising; the vast majority of nouns
  need none.

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
  motion-verb directionality partners (бе́гать/бежа́ть — both imperfective, and
  linked with `motion_pair:` instead) — only true aspect pairs.
- **`motion` / `motion_pair` — verbs of motion (optional).** A handful of the
  commonest verbs come as a pair of **imperfectives** whose contrast is
  direction, not aspect: идти́ (one trip, one direction) against ходи́ть
  (habitually, or there and back). `pair:` can't express that — it joins an
  imperfective to a perfective — so the pair gets its own reciprocal link, and
  each member declares which side it is:

  ```yaml
  "идти=to go":
    aspect: impf
    motion: det              # det (determinate) | indet (indeterminate)
    motion_pair: "ходить=to walk"
    pair: "пойти=to go"      # a verb may carry both links

  "ходить=to walk":
    aspect: impf
    motion: indet
    motion_pair: "идти=to go"
  ```

  `verbsData.test.js` enforces the mirror image of the `pair:` rule: the link
  must be reciprocal, it must join one `det` to one `indet`, and **both members
  must be imperfective**. The link drives the motion-pair reminder on the vocab
  word card and the choose-the-direction step of the in-context drill, and turns
  the verb's usage-mastery exercise into the contrast drill (`verb-motion-pair`
  in `grammar-rules.yml` explains it). Aspect wins when a verb carries both
  links, so the directional contrast is drilled from the indeterminate member's
  side — which is where it belongs, since the indeterminates mostly have no
  aspect partner.
- **`imperative` — command forms (optional).** An `imperative:` block with the
  accented `sg` (ты) and `pl` (вы) forms adds an Imperative column to the verb's
  inflection table and lets usage examples drill it. The plural is always
  `sg + те` (reflexives: `-ся` → `-тесь`), but both are stored explicitly.
  Leave the block off verbs with no natural command (мочь, хоте́ть, зна́чить,
  impersonals like хоте́ться).
- **`defective` — sparse/impersonal paradigm (optional).** Most verbs fill the
  whole present/future and all four past cells. A genuinely **defective** or
  **impersonal** verb doesn't: impersonal `повезти` has only a 3sg future and a
  neuter past (`тебе́ повезёт`, `нам повезло́`); reflexive-passive `говори́ться`
  has no 1st/2nd person and no masculine/feminine past. Store **only the cells
  that exist** — never pad the gaps with a copied form (a masc/fem/plural past
  all holding the neuter form spells out a person/gender that isn't used) — and
  set `defective: true`. That lets the inflection table drill the real two- or
  four-cell paradigm; without it the builder needs three filled cells and would
  drop the word. List the absent slots in `DEFECTIVE` (see the morphology oracle
  below) so the filler can never creep back.
- **`governs` — government frame (optional).** For a verb whose object isn't the
  plain accusative, name the frame it forces. Two shapes, and a verb may carry
  a list of both:

  ```yaml
  governs: dat                          # bare case: помога́ть, звони́ть, нра́виться
  governs: { prep: от, case: gen }      # preposition + case: зави́сеть от
  governs: [dat, { prep: на, case: acc }]   # отвеча́ть дру́гу / на вопро́с
  ```

  A **bare case** is one of `dat` (помога́ть, звони́ть, ве́рить, нра́виться,
  зави́довать), `gen` (ждать, боя́ться, тре́бовать, избега́ть) or `ins`
  (интересова́ться, занима́ться, стать, владе́ть). The accusative is the default,
  so it is never a bare government — leave `governs` off ordinary accusative or
  intransitive verbs.

  A **prepositional frame** must be one the curriculum teaches; the closed list
  lives in `PREP_FRAMES` (`src/lib/verbGovernment.js`) and is currently
  `о + pre`, `на + acc`, `от + gen`, `к + dat`, `в + pre`. Adding a frame means
  adding its `verb-gov-prep-*` rule to `grammar-rules.yml` in the same edit —
  a frame with no rule is a government the app can't explain, and the data test
  fails on it.

  Aspect doesn't change government, so **both members of a pair carry the same
  frame** (помога́ть and помо́чь are both `dat`); a test enforces it.

  This feeds the **verb-government drill** (`/verb-government`) and the
  government note on the vocab word card. To exercise a government, annotate the
  *governed object* in a usage example with that case and the frame's rule —
  e.g. on `мама` and on `погода`:

  ```yaml
  usage:
    - ru: Я ча́сто помога́ю ма́ме.
      en_gb: I often help my mum.
      inflect: { token: 4, case: dat, number: sg, rule: verb-gov-dative }
    - ru: Всё зави́сит от пого́ды.
      en_gb: Everything depends on the weather.
      inflect: { token: 4, case: gen, number: sg, rule: verb-gov-prep-ot-gen }
  ```

  Note that the annotation goes on the **noun's** entry, not the verb's — the
  slot the learner fills is the object, so the drill reads the answer off the
  noun's own paradigm.

  Every government rule in `grammar-rules.yml` is marked `exception: true`, so
  the drill weights them 4×. Data tests cross-check that a verb governing that
  exact frame really appears in the sentence, and — for a prepositional frame —
  that the preposition is actually spelled out in it (its lengthened variants,
  об/обо/во/ко, count as the same word).

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
`forms: { comparative: <form> }` only if it has a comparative — and, in the same
edit, a usage example that **uses** it (`inflect: { degree: comparative }`, see
below). `degreeCoverage.test.js` fails on a stored comparative nothing teaches,
so the form and the sentence arrive together. Don't invent one for a word that
has no natural comparative (there is no «непра́вильнее»); leave `forms` off.

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
- **Degrees of comparison:** `degree: comparative` on an adjective *or* adverb
  whose entry stores `forms.comparative` — no case, number or gender, because
  the comparative is invariable; the learner picks the degree, then spells the
  one form (`rule: adj-comparative` / `adv-comparative`, or the `-stem` variants
  for the mutating and suppletive set: гро́мче, ти́ше, лу́чше, бо́льше).
  `degree: superlative` marks the analytic «са́мый + adjective»: the slot covers
  BOTH words, so give `span: 2` with the `case` and `gender` they agree in and
  point `token` at «са́мый» (`rule: adj-superlative`). The unrelated
  `degree: short` — a predicate form graded by `gender` against the entry's
  `short:` block (Магази́н закры́т, `rule: adj-short-form`) — shares the key but
  is not a degree of comparison.
- **Verbs:** `tense` (`present`/`future`/`past`/`imperative`) + `person`
  (`1sg 2sg 3sg 1pl 2pl 3pl`, `past_m/f/n/pl`, or `imp_sg`/`imp_pl` for the
  imperative). Verbs skip the case step — but a verb with a `pair:` link gets a
  **choose-the-aspect** step first: the sentence is shown with both partners as
  options and the learner picks the one the context needs. For an imperfective
  analytic future (`бу́ду` + infinitive), point `token` at the finite `быть`
  auxiliary and annotate the lexical verb's future `person`; the auxiliary is
  the word that carries person and number.

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
- produce at least one usage **phrase** overall;
- keep the **subject gender split even, per person** — `genderBalance.test.js`
  fails if either gender drops below 45% of the gendered «я …» phrases, or of
  the gendered «ты …» ones (see the gender-balance note under `usage` above).

Keeping files sorted is mechanical — run `node scripts/sort-vocab.js
public/vocab/<file>.yml`, which reorders entries by Russian headword while
preserving the header/`meta` block and each entry verbatim.

## The morphology oracle (is this form real Russian?)

Shape tests prove a cell has the right *fields*; the stress test proves the
*stress* sits on the right syllable. Neither proves the stored **form itself**
is correct — if a table and a drill both read the same bad value, they agree
and CI stays green. The morphology oracle
([`src/lib/morphOracle.js`](../../src/lib/morphOracle.js), gated by
`morphData.test.js`) is the independent check. Run it by hand with **`npm run
check:morph`**. It has four checks:

- **orthography** — a `й` followed by a hard vowel (`йа/йо/йу/йы`) in a
  generated ending, where the softened `я/ё/ю/и/е` is required (`случай →
  *слу́чайа` instead of `слу́чая`). A sequence already present in the lemma
  (`район`, `фойе`) is never flagged.
- **person-duplicate** — two persons in a verb's present/future spelled the
  same (a wrong-person copy-paste, e.g. the 3sg pasted into the 3pl cell).
- **golden** — a stored cell disagreeing with a curated correct form
  ([`src/lib/morphGolden.js`](../../src/lib/morphGolden.js)) for an irregular /
  special-ending / mobile-stress entry.
- **defective** — a paradigm slot the language doesn't have, filled anyway
  (perfective `убедиться` has no 1sg future).

**When a check fires,** the usual answer is to fix the YAML. If the form is
actually correct, record *why* in `morphGolden.js` rather than loosening a
check: list every accepted spelling for a cell as an array (`махаю`/`машу`), add
an impersonal verb's key to `IMPERSONAL_VERBS`, or add a truly defective slot to
`DEFECTIVE`. That file's header documents each mechanism. Keep the oracle
high-signal — a green run should mean "no known-bad forms", not "noise we
learned to ignore".

## Adding a whole new part of speech

1. Create `public/vocab/<name>.yml` with a `words:` block.
2. Register the filename → POS in **both** `POS_BY_FILE` and `partsOfSpeech` in
   [`src/lib/vocabBuild.js`](../../src/lib/vocabBuild.js).
3. Register the filename → POS in the `FILES` list in
   [`scripts/gen-manifest.mjs`](../../scripts/gen-manifest.mjs) — the next build
   picks it up into the (generated) manifest automatically.
4. `npm test`.
</content>
