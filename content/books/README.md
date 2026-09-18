# Literature editorial sources

Each JSON file is a whole, unabridged short work or a clearly labelled selection.
Keep the exact Russian source URL and edition identifier with the text. Assign a
sentence ID once; keep it through English revisions and source spelling fixes.
Divide prose at sentences and verse at complete verse units. A paragraph ID
preserves the original grouping; do not use an auto-splitter on abbreviations,
dialogue or verse.

Draft English with the adjacent paragraph and whole work in view. Re-read for
voice, idiom, irony and register; check every Russian sentence against the
source and every English sentence against its Russian partner. Set `review` to
`checked` only after this pass. Record the method in `translationReview` and
any unresolved concern in this file; the pack builder rejects missing or
unchecked translations. This check is editorial, not a claim of independent
human sign-off. Avoid importing an existing published English translation.

The three initial works were checked against the exact pinned Wikisource
revisions recorded in each file. Each pack includes the whole named short work,
without editorial line numbers or notes. English is newly prepared for this
project; it is not a transcription of an existing literary translation. The
source link and rights statements travel with the pack and appear in the
library. The Russian transcriptions are attributed to Wikisource contributors
under the source site's CC BY-SA terms; our English translations are licensed
CC BY-SA 4.0. These text/data terms are separate from the app's software
license. Maintain attribution when redistributing the packs.

The Intermediate shelf begins with Chekhov's complete «Толстый и тонкий» from
the 1903 collected-works transcription. Its 81 reader units retain all 17
paragraphs, including dialogue and the repeated closing sentence. The English
keeps the change from familiar speech to servile honorifics and the original's
dated final comparison; the translation is newly prepared here, not lifted from
another edition.

`npm run gen:books` validates sources, writes `public/books/packs/*.json`, and
updates the catalog with SHA-256 hashes. Commit the editorial JSON and generated
pack/catalog together. Increase `packVersion` when Russian text, sentence IDs,
source or rights metadata changes; increase `translationVersion` when English
changes. The build checks both against the previously generated pack. Users may
then download the revised pack without updating the app.
