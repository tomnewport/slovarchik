# Promoting a glossary word into the curriculum

`public/vocab/glossary.yml` holds ~2,300 **gloss-only** entries (`learn: false`).
They exist so phrase hints can translate every tappable word — they're excluded
from every drill, the phrase bank and the batch/progress engine. But the busiest
of them are already _candidate_ curriculum content: glossed, and frequency-implied
by how often they turn up inside example sentences. This is the workflow for
turning one into a real, drillable entry (issue #326).

> **The pipeline is deliberately half-automated.** A script ranks candidates and
> scaffolds a schema-correct skeleton; **the authoring is by hand.** Lemmatising a
> surface form, writing a correct inflection table, and — above all — composing
> _natural_ example sentences are judgement calls. A script that guesses them
> produces confidently-wrong forms and robotic, formulaic phrases, which are
> worse than no entry at all. Low authoring **cost**, not low authoring **care**.

## The tool

```bash
node scripts/promote-glossary.mjs                 # ranked shortlist (busiest first)
node scripts/promote-glossary.mjs --limit 100     # more rows
node scripts/promote-glossary.mjs --json          # machine-readable
node scripts/promote-glossary.mjs --scaffold "<key>"                 # skeleton, POS guessed
node scripts/promote-glossary.mjs --scaffold "<key>" --pos noun --lemma <lemma>
```

`npm run promote:glossary` is the same as the first line.

The report ranks by **tap-hint frequency**: how many phrase tokens each glossary
entry actually glosses across the corpus. It also shows a low-confidence POS guess
and flags entries whose meaning a learnable word already owns (`⚠ dup?`) — a signal
to reconcile before promoting, not to blindly duplicate. The script **never edits
the vocab files**; `--scaffold` prints one entry to stdout for you to complete.

## Checklist for one promotion

1. **Pick a candidate** from the report. Prefer high `hits`, and read the `note`
   column — a `⚠ dup?` usually means the surface form is an inflected form of a
   word that's _already_ learnable (e.g. «людей» → «челове́к», «лет» → «год»), so
   the right move is often to add a `forms:`/usage example to the existing entry,
   not create a new one.

2. **Lemmatise the headword.** Glossary keys are **surface forms**, often
   inflected («автономных» = _autonomous_, «купи» = imperative of _купи́ть_). Work
   out the dictionary form:
   - **noun** → nominative singular
   - **verb** → infinitive
   - **adjective** → masculine nominative singular
   - **pronoun/numeral** → per the CONTRIBUTING sub-type rules

   Pass it with `--lemma`. If you don't, the scaffold defaults to the surface
   form and marks it **unverified** — never commit that as-is.

3. **Confirm the part of speech.** The report's guess keys off the ending and is
   only sometimes right (an inflected form routinely mis-guesses). Override with
   `--pos` when needed.

4. **Scaffold and complete it.** Run `--scaffold` and fill in every `TODO`,
   resolving each `⚠` and `✍`:
   - **gloss** (`en_gb`) — carried over from the glossary entry; review the
     wording and add `alt:` meanings.
   - **CEFR** — carried over; sanity-check it.
   - **inflection table** — hand-author it (nouns/verbs/pronouns), _or_ for
     adjectives fill only `forms:` and let `npm run gen:adjectives` derive the
     grid. Mark stress; store, don't derive, anything mobile.
   - **usage** — **write 1–2 natural sentences yourself.** This is the part that
     must not be mechanised. Good examples feed the phrases, listening and
     word-bank drills at once (see [`../public/vocab/CONTRIBUTING.md`](../public/vocab/CONTRIBUTING.md)).

5. **Paste** the finished entry into the file the header names (`nouns.yml`,
   `verbs.yml`, …), removing the scaffold's `#` comment header.

   **If the glossary key is the lemma itself** — «арбуз», not «людей» — the stub
   has to come out of `glossary.yml` at the same time, or the natural key is a
   duplicate and `vocabBuild.test.js` fails. Removing it trips `verify:review`,
   which treats a key the replay produces but the corpus has lost as the audit
   trail failing to reproduce itself. Record the promotion instead, one JSON
   object per line in **`review/glossary-promotions.jsonl`**:

   ```json
   {"key":"арбуз=watermelon","to":"арбуз=watermelon","file":"nouns.yml","why":"Promoted to the curriculum (#636); lemma-keyed stub, so it collided with the new entry's natural key."}
   ```

   `to` is the curriculum key the word became. The check is not a mute: it
   passes only if `to` is really in the corpus and really learnable, so a
   promotion recorded but never finished still fails. An inflected stub the new
   declension table now covers («лимона») is worth removing and recording the
   same way, even though it collides with nothing.

6. **Sort & generate:**
   ```bash
   node scripts/sort-vocab.js public/vocab/<file>.yml
   npm run gen:adjectives            # if you promoted an adjective
   node scripts/annotate-inflect.mjs --apply   # optional: fill inflect: blocks, then review the diff
   ```

7. **Test:** `npm test`. The shape suites (`vocabBuild.test.js`,
   `declension.test.js`, `phrasesData.test.js`, …) guard keys, CEFR, sorting,
   noun case-completeness and annotation correctness. Fix anything red.

8. **Grep for leftover markers** before committing — no `TODO`, `✍` or `⚠`
   should remain in your entry.

## Why not just auto-promote the top few hundred?

Because the three things a promotion needs are exactly the three a script gets
wrong: the **lemma** (surface forms aren't lemmas), the **inflection table**
(Russian is irregular and stress is mobile), and the **usage sentences** (auto-
generated examples read as robotic). The report removes the _search_ cost — which
words are worth the effort, and which are already covered — and the scaffold
removes the _boilerplate_ cost. What's left is the authoring that should stay
human.
