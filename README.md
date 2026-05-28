# Словарчик · Slovarchik

An offline-first **PWA for practising Russian** — built because Duolingo kept
drilling the same tiny slice of vocabulary. No backend, no tracking, no account.
Everything runs in your browser and works fully offline once loaded.

> **Status:** skeleton app. The core drills work end-to-end; the word/noun data
> sets are intentionally small and meant to grow.

## What it does

### 📚 Vocabulary

Translate words in either direction (RU → EN / EN → RU) across three difficulty
levels:

| Level        | How it works                                         |
| ------------ | ---------------------------------------------------- |
| Easy         | **Match** — pick the right translation (4 choices).  |
| Intermediate | **Hinted typing** — type it, first letter(s) shown.  |
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

## Tech

- **Vue 3** + **Vite 6**, **Vue Router** (hash history for clean offline deep links)
- **vite-plugin-pwa** (Workbox) for the service worker, manifest and offline cache
- **Vitest** + **@vue/test-utils** for tests
- Deployed to **GitHub Pages** via GitHub Actions

The quiz/declension logic lives in framework-free modules under
[`src/lib`](src/lib) so it can be unit-tested in isolation. The vocabulary lives
in human-editable **YAML files** under [`src/data/vocab`](src/data/vocab) (one
per part of speech) which [`src/data/db.js`](src/data/db.js) bundles and parses
into an in-memory database at startup — no backend, no fetch, works offline.

## The vocabulary database

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

`db.js` exposes `words` (all entries, sorted alphabetically by Russian),
`byPos`, `getByKey(key)` and `parseKey()`. Words are loaded via
`import.meta.glob`, so **adding a new `.yml` file is picked up automatically**.

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

Append entries to the relevant file in [`src/data/vocab`](src/data/vocab)
following the schema above (keep each file sorted alphabetically by Russian).
The `db.test.js` and `declension.test.js` suites guard the shape — unique keys,
a valid CEFR level, a meaning, accepted answers, and complete case tables for
nouns. Noun endings (for the advanced drill) are derived automatically from the
forms.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages. The site is served from the `/slovarchik/`
base path (configured in `vite.config.js`); update `base` if you fork under a
different name.

To enable it on your repo: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

## License

MIT
