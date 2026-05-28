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
[`src/lib`](src/lib) so it can be unit-tested in isolation; the word and noun
data live in [`src/data`](src/data).

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

## Adding words & nouns

- Vocabulary: append entries to [`src/data/vocab.js`](src/data/vocab.js).
  `en` may be a string or an array of accepted answers.
- Nouns: append a full declension table to
  [`src/data/nouns.js`](src/data/nouns.js). The `data integrity` test guards the
  shape, and endings are derived automatically from the forms.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages. The site is served from the `/slovarchik/`
base path (configured in `vite.config.js`); update `base` if you fork under a
different name.

To enable it on your repo: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

## License

MIT
