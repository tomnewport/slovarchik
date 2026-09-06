# Словарчик · Slovarchik

An offline-first **PWA for practising Russian** — built because Duolingo kept
drilling the same tiny slice of vocabulary. No backend, no tracking, no account.
Everything runs in your browser and works fully offline once loaded.

🔗 **Live app: [tomnewport.github.io/slovarchik](https://tomnewport.github.io/slovarchik/)**

> **Stack:** **Vue 3** + Vite 6 PWA (Vue Router, Vitest). It is **not** a React
> app — there's no JSX or hooks. Agents and contributors: start with
> [`AGENTS.md`](AGENTS.md) for a fast orientation. Details in [Tech](#tech) below.

> **Status:** working app, actively developed. All drills run end-to-end, backed
> by a spaced-repetition engine that tracks per-word mastery and assembles
> practice sessions. The vocabulary keeps growing.

## What it does

### 📚 Vocabulary

Translate words in either direction (RU → EN / EN → RU):

| Level   | How it works                                                                 |
| ------- | ---------------------------------------------------------------------------- |
| Easy    | **Match** — pick the right translation (4 choices).                          |
| Type it | **Type the answer.** Stuck? Tap the on-screen keyboard's 💡 to light up the next letter (plus a couple of decoys) — see [The keyboard hint](#the-keyboard-hint). |

### 🧩 Inflection drills

The same four exercises drill every inflecting part of speech — **nouns**
(case × number), **adjectives** (full case × gender/number agreement),
**pronouns** (case, or gender agreement for the adjective-like ones) and
**verbs** (present-tense conjugation). Each word type is just a different
paradigm table fed to the shared engine in `src/lib/paradigm.js`.

Adjective declension tables are generated from the dictionary form by
`scripts/gen-adjective-declension.mjs` (run via `npm run gen:adjectives`),
which derives all 24 forms by rule and refuses to write unless they validate
against hand-checked golden paradigms and every curated nominative.

| Exercise        | How it works                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| Identify        | Given one form, select every cell it could fill (handles syncretism).        |
| Build the table | Drag (or tap, or select with the keyboard) each shuffled form into the right cell of an empty table. |
| Type the endings| The stem is shown; type every ending. Stuck? Tap the on-screen keyboard's 💡 to light up the next letter — see [The keyboard hint](#the-keyboard-hint). |

The identify exercise understands syncretism — e.g. *книге* matches both dative
**and** prepositional, and *стол* matches nominative **and** accusative singular.

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

### ⌨️ The keyboard hint

Every typing drill — vocabulary, phrases and the *type the endings* inflection
exercise — shares one on-screen Russian keyboard
([`RussianKeyboard.vue`](src/components/RussianKeyboard.vue)) with a **💡 hint
button**. Tap it and the keyboard lights up the **next character to type plus a
couple of decoys**; it stays on for the rest of the lesson so you can lean on it
whenever you're stuck — there's no penalty for using it. A field opts in by
declaring the answer it expects via a `data-answer` attribute; the keyboard
reads that, follows what you've typed, and walks the hint forward letter by
letter. English answers fall back to the device keyboard, so the hint applies
wherever the on-screen Russian keyboard is shown.

## Tech

- **Vue 3** + **Vite 6**, **Vue Router** (hash history for clean offline deep links)
- **vite-plugin-pwa** (Workbox) for the service worker, manifest and offline cache
- **Vitest** + **@vue/test-utils** for tests
- Deployed to **GitHub Pages** via GitHub Actions

The quiz/declension/progression logic lives in framework-free modules under
[`src/lib`](src/lib) so it can be unit-tested in isolation. The vocabulary is
**not part of the JS bundle** — it's authored as human-editable **YAML files** in
[`public/vocab`](public/vocab) (one per part of speech), converted to JSON at
build time, and fetched, parsed and cached in IndexedDB at runtime (one file per
part of speech). This keeps the JS bundle small and constant as the word lists
grow. The vocab is **not part of the service-worker precache** either — it's
served from a separate runtime cache, so app-shell updates don't drag the
multi-MB word data along on every deploy (see
[How loading works](#how-loading-works) below).

## The vocabulary database

### How loading works

1. On startup the app reads any vocab already cached in **IndexedDB** and renders
   immediately (works fully offline).
2. If online, it fetches `vocab/manifest.json`, which lists each file, an
   `updated` timestamp (shown in the app) and a content `hash`.
3. Any file that is new or whose `hash` differs from the cached copy is
   downloaded, parsed and written back to IndexedDB; the drills update reactively.

The service worker keeps the vocab in a **runtime cache** (`slovarchik-vocab`,
`StaleWhileRevalidate`) rather than the app-shell precache: once you've loaded a
file online it's available offline, and a background refresh pulls fresh bytes
whenever you're online — so the app works **fully offline once you start using
it, and updates itself when connected**. Because vocab is no longer precached,
deploys re-ship only the app shell, not the multi-MB word data (issue #266). The
flow lives in [`src/stores/vocab.js`](src/stores/vocab.js) (reactive store +
sync), [`src/lib/idb.js`](src/lib/idb.js) (IndexedDB) and
[`src/lib/vocabBuild.js`](src/lib/vocabBuild.js) (pure records builder).

To publish updated words, just edit the YAML and commit it. `manifest.json` is a
**generated, uncommitted** artifact — `npm run build` (and `npm run dev`)
regenerate it from the files: the per-file content `hash` comes from the bytes
and the `updated` date from git history, so clients re-sync exactly the files
whose bytes changed with no manual step, and parallel edits to different vocab
files never conflict over the manifest. CI checks out with full history
(`fetch-depth: 0`) so the dates are accurate.

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
dropping a `.yml` file in `public/vocab/` and registering it in the `FILES` list
in [`scripts/gen-manifest.mjs`](scripts/gen-manifest.mjs).

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # run the unit tests once
npm run test:watch # watch mode
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm run gen:icons  # regenerate the PWA PNG icons
npm run gen:manifest # regenerate the (uncommitted) public/vocab/manifest.json
npm run check:corpus # the corpus gates CI runs and `npm test` doesn't (~5s)
npm run check:ci     # everything CI's `test` job runs, in order
```

`npm test` is not the whole of CI: three corpus gates (`verify:review`,
`check:inflect:cases`, `check:prompts`) run only in the workflow. `npm run
check:ci` runs the same list locally, so "will this pass?" is one command.

## Adding words

Append entries to the relevant file in [`public/vocab`](public/vocab) following
the schema above (keep each file sorted alphabetically by Russian) and commit —
the manifest regenerates itself at build time. The `vocabBuild.test.js` and
`declension.test.js` suites guard the shape — unique keys, a valid CEFR level, a
meaning, accepted answers, and complete case tables for nouns. Noun endings (for
the *type the endings* drill) are derived automatically from the forms.

📖 **Full reference:** [`public/vocab/CONTRIBUTING.md`](public/vocab/CONTRIBUTING.md)
documents every field, the per-part-of-speech schemas, stress marks, heteronyms,
and exactly what the tests check.

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
