# Словарчик · Slovarchik

An offline-first **PWA for practising Russian** — built because Duolingo kept
drilling the same tiny slice of vocabulary. No backend, no tracking, no account.
Everything runs in your browser and works fully offline once loaded.

🔗 **Live app: [tomnewport.github.io/slovarchik](https://tomnewport.github.io/slovarchik/)**

> **Status:** skeleton app. The core drills work end-to-end; the word/noun data
> sets are intentionally small and meant to grow.

## What it does

### 📚 Vocabulary

Translate words in either direction (RU → EN / EN → RU) across three difficulty
levels:

| Level        | How it works                                         |
| ------------ | ---------------------------------------------------- |
| Easy         | **Match** — pick the right translation (4 choices).  |
| Intermediate | **Hinted typing** — type it; the on-screen keyboard lights up the letters it uses (RU answers). |
| Advanced     | **Blind typing** — type it with no help.             |

### 🧩 Noun declension

Drill the six cases (nominative, genitive, dative, accusative, instrumental,
prepositional) across singular and plural:

| Level        | How it works                                                       |
| ------------ | ------------------------------------------------------------------ |
| Easy         | **Spot the case** — given a form, select which case(s) it can be.  |
| Intermediate | **Fill the table** — type every form in the number × case grid.    |
| Advanced     | **Endings only** — the stem is shown; type just the ending.        |

The "spot the case" mode understands syncretism — e.g. *книге* is accepted as
both dative **and** prepositional, and animate accusatives (*собак*, *студентов*)
line up with the genitive.

### 🎧 Listening

Hear a Russian phrase read aloud (Web Speech API) and rebuild its English
translation by tapping the words in order. A few random **decoy** words are
mixed into the bank to keep it honest. The Vocabulary *easy* drill also gains a
**listen & match** option that hides the Russian spellings and speaks each word
when you tap it — so you match by ear. Both degrade gracefully where speech
synthesis isn't available.

### 🗣️ Speaking

Say it out loud — the browser's **speech recognition** (Web Speech API) listens
and grades what it hears. Three modes:

| Mode          | How it works                                                                 |
| ------------- | ---------------------------------------------------------------------------- |
| **Echo**      | See the Russian (and English), hear it, then say it back — checks your accent. |
| **Produce**   | See the English, say the Russian; the correct phrase is then read aloud.       |
| **Interpret** | Hear a Russian phrase, say the English — or say *"pass"*. **Hands-free** with spoken feedback. |

Answers are graded leniently: an answer counts when **≥ 90% of its letters
match** (a Levenshtein letter-similarity, forgiving stress, case, spaces and
punctuation), and the recogniser's *alternative* guesses are all scored — the
most generous wins — so a near-miss that the recogniser ranked second still
passes. The result screen shows the letter-match score, the words that landed
versus those missed, and any extra words it heard. In **hands-free** mode the
loop runs itself: it reads the
prompt, waits for the synthesised voice to finish before opening the mic, grades
what you said, speaks the verdict and the model answer, then moves on — eyes-free
practice. Recognition only ships in some browsers (Chrome/Edge, and online), so
the whole drill is gated behind a capability check and shows a clear notice where
it isn't available. The recogniser wrapper and grading live in
[`src/lib/recognition.js`](src/lib/recognition.js).

> **Privacy:** unlike the rest of the app, speaking drills aren't local. In
> Chrome/Edge the Web Speech API streams your microphone audio to the browser
> maker's cloud service for transcription (which is why it needs a network
> connection). The app surfaces this in the UI before you start.

## Tech

- **Vue 3** + **Vite 6**, **Vue Router** (hash history for clean offline deep links)
- **vite-plugin-pwa** (Workbox) for the service worker, manifest and offline cache
- **Vitest** + **@vue/test-utils** for tests
- Deployed to **GitHub Pages** via GitHub Actions

The quiz/declension logic lives in framework-free modules under
[`src/lib`](src/lib) so it can be unit-tested in isolation. The vocabulary is
**not bundled** — it's a set of human-editable **YAML files** served as static
assets from [`public/vocab`](public/vocab) (one per part of speech), downloaded
on demand and cached in IndexedDB. This keeps the JS bundle small and constant
as the word lists grow.

## The vocabulary database

### How loading works

1. On startup the app reads any vocab already cached in **IndexedDB** and renders
   immediately (works fully offline).
2. If online, it fetches [`vocab/manifest.json`](public/vocab/manifest.json),
   which lists each file and an `updated` timestamp.
3. Any file that is new or whose timestamp is newer than the cached copy is
   downloaded, parsed and written back to IndexedDB; the drills update reactively.

The service worker also precaches the manifest and YAML, so even the *first*
offline launch after install has data to load. The flow lives in
[`src/stores/vocab.js`](src/stores/vocab.js) (reactive store + sync),
[`src/lib/idb.js`](src/lib/idb.js) (IndexedDB) and
[`src/lib/vocabBuild.js`](src/lib/vocabBuild.js) (pure YAML → records builder).

To publish updated words, edit the YAML and bump the file's `updated` timestamp
in the manifest.

### File format

Each part of speech is one YAML file (`nouns.yml`, `verbs.yml`, …). Every word
is keyed by a **natural key** of the form `"<russian>=<english>"`, which keeps
homographs distinct (e.g. a word that declines differently per meaning gets one
entry per meaning). Stress is marked with a combining acute accent (´) on the
stressed vowel; the drills strip it when grading what you type, but show it for
learning.

```yaml
# nouns.yml
words:
  "ворота=gate":
    cefr_level: B2          # A1 | A2 | B1 | B2 | C1 | C2
    gender: n               # m | f | n  (omit for pluralia tantum)
    animacy: i              # a (animate) | i (inanimate)
    number: ["pl"]          # which numbers exist — ворота is plural-only
    collections: [architecture]
    en_gb:
      standard: gate (a doorlike structure outside a house)   # short gloss (clarification)
      alt:
        - goal (in sports, the area a ball is put into)
    usage:
      - ru: Больши́е воро́та ме́дленно откры́лись.
        en_gb: The big gate slowly opened.
    declension:             # flat <number>_<case> keys: sg_nom, pl_gen, …
      pl_nom: воро́та
      pl_gen: воро́т
      # …
```

The store exposes reactive `vocab` and `nouns` lists (sorted alphabetically by
Russian) plus a `state` with the current `status`. Add a new part of speech by
dropping a `.yml` file in `public/vocab/` and adding it to the manifest.

## Progress tracking

Every drill records each attempt through one shared module so the history can be
ranked and aggregated consistently (the foundation for the progression system in
[issue #12](https://github.com/tomnewport/slovarchik/issues/12)). Grading uses a
0/1/2 scale — incorrect (`0`), correct in an assisted *easy* mode (`1`), correct
unaided (`2`) — and only the **last 10 attempts** per subject are kept.

A *subject* is a word, a single declension form (e.g. `pl.gen` of a noun) or a
phrase. Drills record an attempt with one call:

```js
import { record } from './stores/progress.js'
import { gradeFor, GRADES } from './lib/progress.js'

record({ kind: 'word', key }, gradeFor(level, correct))         // typed a word
record({ kind: 'form', key, slot: 'pl.gen' }, GRADES.INCORRECT) // missed a form
record({ kind: 'phrase', key }, gradeFor(level, correct))       // built a phrase
```

Facets (gender, case, collection, CEFR …) are **derived at query time** from the
live vocab, so the stored history stays tiny and any attribute — even one added
later — can be aggregated. The pure model and query engine live in
[`src/lib/progress.js`](src/lib/progress.js); the IndexedDB-backed reactive store
in [`src/stores/progress.js`](src/stores/progress.js) exposes the headline
queries:

```js
import { progressQueries as q } from './stores/progress.js'

q.words() //         most mistaken words
q.forms() //         most mistaken word-forms
q.byFacet('gender') // worst noun genders (or any facet / kind)
q.collections() //   most mistaken collections
// arbitrary slice → one error rate, e.g. nominative forms of neuter nouns:
q.combined((s) => s.kind === 'form' && s.facets.gender === 'n' && s.facets.case === 'nom')
```

### Skills, mastery & exam readiness

[`src/lib/skills.js`](src/lib/skills.js) turns that history into **skills** — a
word, a grammatical form (e.g. *genitive plural*), a word type (*masculine
nouns*) or a collection. Each skill knows its **breadth** (how many vocab words
it covers — a word is 1, a collection its members, a gender every such noun), so
they group into bands: **100+ / 10+ / 1+ words**. A correct attempt earns mastery
credit by difficulty (10× easy ≈ 3× intermediate ≈ 1× hard = mastered, per #12),
which drives per-collection **exam readiness** (an average that fills as you near
it; the exam unlocks when every word is mastered).
[`src/lib/practice.js`](src/lib/practice.js) composes a practice session from
#12's sections (recap / current / grammar / weakest-25% / new).

The store exposes these live: `skills`, `skillsByBreadth`, `weakSkills`,
`examReadiness`, `currentCollection` / `setCurrentCollection`, and
`composePractice(size)`. The **Progress** page (`/progress`) surfaces the four
rankings, exam readiness, skills grouped by breadth, and a session preview.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # run the unit tests once
npm run test:watch # watch mode
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm run gen:icons  # regenerate the PWA PNG icons
```

## Adding words

Append entries to the relevant file in [`public/vocab`](public/vocab) following
the schema above (keep each file sorted alphabetically by Russian) and bump its
`updated` timestamp in `manifest.json`. The `vocabBuild.test.js` and
`declension.test.js` suites guard the shape — unique keys, a valid CEFR level, a
meaning, accepted answers, and complete case tables for nouns. Noun endings (for
the advanced drill) are derived automatically from the forms.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages at
[tomnewport.github.io/slovarchik](https://tomnewport.github.io/slovarchik/). The
site is served from the `/slovarchik/` base path (configured in
`vite.config.js`); update `base` if you fork under a different name.

To enable it on your repo: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

## License

MIT
