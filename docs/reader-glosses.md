# Reader-only glosses: making every word in a book tappable

The literature reader gives a learner two kinds of help and no more: reveal the
sentence, or tap one word. The tap goes through the ordinary dictionary — a book
pack carries the text, the structure and the translations, never a lexicon of
its own (#754) — so a word with no dictionary entry is a word the reader
silently refuses to explain. Nothing about the empty popup tells the learner
whether the word is obscure, misspelled or simply missing from our data.

When the five shipped packs were measured for #782, 307 of their 1,717 tappable
words came back empty: 375 occurrences, roughly one unexplained word every four
sentences of Lenin. They now all resolve, and `npm run check:reader` fails the
build when a new book brings in a word nothing explains.

## The rule

> Every tappable Cyrillic word in `content/books/` resolves through
> `lookupReaderWord`, and nothing added for a book's sake enters the curriculum.

Both halves matter, and `check:reader` checks both. The first is what makes a
book readable; the second is why a reader can ship Chekhov's civil-service ranks
and Lenin's «каутскиа́нство» without a learner ever being drilled on them.
`learn: false` keeps an entry out of the vocab, inflection and phrase drills,
out of the phrase bank, and out of the batch and progress engine entirely
(`learnableWords` in `vocabBuild.js`) — so the gate fails on a `reader-*.yml`
entry that has forgotten the flag as surely as on an unglossed word.

## The tools

```bash
npm run check:reader     # the gate: every book word has an entry (runs in CI)
npm run reader:glosses   # the worklist: each missing word, in the sentence it is in
node scripts/check-reader-glosses.mjs --json   # machine-readable
```

The gate reads the **editorial** sources in `content/books/` through the pack
builder's own validation, not the generated packs, so a new book is measured as
soon as it is written rather than when someone remembers `npm run gen:books`.

## Where an entry goes

| File | For | Shape |
| --- | --- | --- |
| `public/vocab/reader-glosses.yml` | most reader-only words | key = dictionary form, `accented`, `forms:` for the surface forms the books print |
| `public/vocab/reader-nouns.yml` | a noun used in several cases, where a full paradigm earns its keep | full `declension:` table |
| `public/vocab/reader-names.yml` | people and places the books name | singular paradigm, `animacy`, gloss saying who or what |
| `public/vocab/names.yml` | common Russian given names, diminutives, patronymics (#760) | as above — a name a learner meets everywhere is not reader-only |

A minimal entry:

```yaml
  "учение=teaching":
    cefr_level: B2
    learn: false
    accented: уче́ние
    forms:
      - уче́нием
      - уче́ниями
    en_gb:
      standard: "teaching (a body of doctrine)"
```

Three conventions, each with a reason:

- **Key on the dictionary form, list surface forms under `forms:`.** This is the
  opposite of the auto-generated `glossary.yml`, whose keys are surface forms
  because it is generated from the phrase corpus. A reader who taps
  «уче́нием» is better served by «уче́ние — teaching» than by an entry that
  only exists in the instrumental, and a reader-only word has no paradigm
  elsewhere to contradict. Where another entry already owns the lemma — a
  curriculum verb, or a `glossary.yml` stub for a different sense — key on the
  surface form instead (`"создан=was created"`, `"противоречия=antagonisms"`),
  so one Russian word never ends up with two rival dictionary entries.
- **Mark the stress on every form**, and write ё where it belongs — the
  corpus-wide stress guards (`stressData.test.js`) check these like any other
  entry, and the reader speaks sentences aloud.
- **Gloss in context.** The parenthetical is the useful half: "excellency (the
  address due to a senior official)" is worth reading, "excellency" alone is not.

Non-Cyrillic tokens are not tappable at all — a Latin «III» or the stranded
ending of «6-ым» is printed as text, because no Russian dictionary will ever
have anything to say about it (`readerTokens`).

## What stays reader-only, on purpose

- **Names.** Нафанаи́л, Ванценба́х, Ка́утский, Шту́тгарт.
- **Imperial service vocabulary and its manners.** превосходи́тельство,
  колле́жский, асе́ссор, столонача́льник, ста́тский, чинопочита́ние, and the
  servile enclitic `-с` in «прия́тно-с», «вы-с», «хи-хи́-с».
- **The political lexicon of one text.** каутскиа́нство, социа́л-шовини́ст,
  мелкобуржуа́зный, эсе́р, меньшеви́к. A learner who wants these has the reader.
- **Poetic and archaic forms.** мурава́, бо́ле, ве́шний, кум, ку́мушка, ль.

None of these is a candidate for drills, and promoting them would fill a
learner's batches with words they will meet once in their life.

## Promotion shortlist

These are the reader-only entries worth reviewing for full curriculum entries —
lemmatised, with a declension or conjugation table and natural example
sentences, following [`glossary-promotion.md`](glossary-promotion.md). Being on
this list is a recommendation to review, not a decision.

**Everyday verbs** (A2–B2, useful far beyond these books): `уронить` (to drop),
`тонуть` (to drown), `спастись` (to be saved), `побледнеть` (to turn pale),
`проглотить` (to swallow), `нюхать` (to sniff), `дразнить` (to tease),
`превратить` (to turn into), `предоставить` (to grant), `отнимать` (to take
away), `избавиться` (to be rid of), `сходиться` (to agree).

**Everyday nouns**: `ступень` (stage, step), `мундир` (uniform), `фуражка`
(peaked cap), `красавец` (handsome man), `учение` (teaching), `столкновение`
(conflict), `освобождение` (liberation), `уничтожение` (destruction), `ясность`
(clarity), `злоба` (rage).

**Everyday adverbs and particles**: `целиком`, `нисколько`, `притом`,
`по-видимому`, `кое-как`, `объективно`, `теоретически`.

## Two gaps a promotion would not fix

Some stubs exist because a curriculum word's paradigm is incomplete, and the
right repair is the paradigm, not a new headword:

- **Short passive participles.** «вы́ражена», «дока́зано», «пока́зано»,
  «со́здан», «переведён», «приведены́» are forms of `выразить`, `доказать`,
  `показать`, `создать`, `перевести` and `привести`, all of which the curriculum
  already teaches. They are stubs only because those verbs store no
  `participles.pass_short` block (see
  [`participles-and-gerunds.md`](participles-and-gerunds.md)). Filling that in
  would let the stub go and would carry a `lemma:` link's worth of credit back
  to the verb.
- **Oblique adjective cells.** «шесто́го» is the genitive of the curriculum
  ordinal `шестой=sixth`, but `buildFormIndex` indexes only the four stored
  nominatives of an adjective or ordinal, so every oblique form in the corpus
  needs its own stub — which is why `glossary.yml` is full of them
  («автоно́мных», «бето́нных»). Deriving those cells into the form index would
  retire a large slice of that file at once. It is a bigger change than #782,
  and it is the reason this one word is a stub rather than a paradigm gap.
