# AGENTS.md — orientation for AI agents (and humans in a hurry)

> **Stack in one line: this is a Vue 3 + Vite app. It is _not_ React.**
> There is no JSX, no `react`/`react-dom`, no hooks, no Redux. If you catch
> yourself about to write `useState`, a `.jsx` file, or `ReactDOM.render`, stop —
> you've pattern-matched the wrong framework. Read this file first; treat any
> further checking as a quick confirmation, not an exploration.

## Why agents mistake this for React (and the quick tells that it isn't)

A few signals here look React-ish at a glance. Here's what each one actually is:

| Looks like React because…            | …but it's actually                                                |
| ------------------------------------ | ----------------------------------------------------------------- |
| It's built with **Vite**             | Vite is framework-agnostic; here it runs **`@vitejs/plugin-vue`**. |
| There's a **`src/stores/`** dir      | Vue **reactive stores** (`reactive()`/`computed()`), not Redux/Zustand. |
| There's `src/views/` + `src/components/` | Standard Vue SPA layout; the files are **`.vue`** Single-File Components. |
| There's an `@` import alias          | Vue convention too — `@` → `src/` (see `vite.config.js`).          |

**The 10-second confirmation:** `package.json` `dependencies` are `vue` +
`vue-router` (no react). `index.html` mounts `<div id="app">` (not `#root`).
`src/main.js` calls `createApp(App).use(router).mount('#app')`. Components are
`.vue` files using `<script setup>` + `<template>`.

## What this is

**Slovarchik** — an offline-first **PWA** for practising Russian: vocabulary
(both directions), inflection drills for every inflecting part of speech (nouns,
adjectives, pronouns, verbs), phrases, listening and speaking. A
spaced-repetition engine tracks per-word mastery and assembles practice
sessions. No backend, no accounts; everything runs in the browser and works
offline. Deployed to GitHub Pages under the `/slovarchik/` base path.

- **Vue 3** (`<script setup>` SFCs) + **Vue Router** (hash history)
- **Vite 6** build, **vite-plugin-pwa** (Workbox) for the service worker/offline cache
- **Vitest** + **@vue/test-utils** + jsdom for unit tests; **Playwright** for e2e
- Vocabulary is **YAML files** in `public/vocab/`, cached in **IndexedDB** (and
  precached by the service worker for first-launch offline) — not part of the JS
  bundle. (`js-yaml` is a **runtime** dependency, not a devDep: the app parses
  the YAML in the browser.)

## Project map

```
index.html              # app shell — mounts #app, loads src/main.js
vite.config.js          # Vite + Vue plugin + PWA + Vitest config; base = /slovarchik/
playwright.config.js    # e2e config (serves the preview build)
eslint.config.js        # flat config: js.recommended + eslint-plugin-vue
src/
  main.js               # entry: createApp(App).use(router).mount('#app')
  App.vue               # shell: header (Home logo + Data avatar) + <RouterView>
                        #   + global RussianKeyboard + ErrorToast. Navigation is
                        #   session-driven from HomeView, not a route bar.
  router/index.js       # ~17 routes → views. Highlights: / (home), /session, /batch,
                        #   /practice, /progress, /data, /vocab, /phrases, /phrase-fix,
                        #   /listening, /speaking, /numbers, and the shared inflection
                        #   view at /declension /verbs /pronouns /adjectives (one
                        #   InflectionView fed a different `pos` prop).
  views/*.vue           # one screen per route (HomeView + SessionView are the big ones)
  components/*.vue       # shared UI (RussianKeyboard, SpeakButton, HintablePhrase,
                        #   ProgressPill, ReportButton, CelebrationBurst, …)
    exercises/*.vue     #   per-exercise UIs (Match, Type, WordBank, Inflect, Speak, PhraseFix)
    inflection/*.vue    #   inflection-table UIs (DragTable, BlindEndings, IdentifyForm)
  stores/               # VUE reactive stores (app state), NOT Redux:
    vocab.js            #   reactive vocab/nouns/phrases + IndexedDB sync
    progress.js         #   the core engine — per-word attempts → states, batches, sessions
    settings.js         #   user preferences (not learning progress)
    reports.js          #   offline-queued issue reports
    keyboard.js         #   shared on-screen keyboard hint state
    hints.js            #   in-phrase word-hint glue
    errorToast.js       #   transient error toast state
  lib/                  # framework-free pure modules (unit-tested in isolation). Grouped:
                        #   progression/batches/session/sessionRunner/practices/
                        #     exerciseBuild/focus/achievements  — the learning engine
                        #   declension/paradigm/numerals/numberDrill  — inflection & numbers
                        #   phrases/phraseHint/phraseContext/glossCoverage  — phrases
                        #   quiz/recognition/handsFree/speech/feedbackSound  — drills & speech
                        #   vocabBuild/idb/text/collections/reportIssue  — data & utilities
  test/fixtures.js      # shared test fixtures
public/vocab/           # *.yml word data (one per part of speech) + manifest.json
e2e/                    # Playwright specs
docs/                   # design notes for in-flight features
scripts/                # node maintenance scripts (icons, vocab sorting, coverage)
```

Tests live next to their source as `*.test.js`; e2e specs live in `e2e/`.

## Commands

```bash
npm install
npm run dev         # local dev server
npm test            # run unit tests once (vitest)
npm run test:watch  # watch mode
npm run lint        # eslint (correctness rules; formatting left to Prettier/editor)
npm run build       # production build into dist/
npm run preview     # serve the production build
npm run test:e2e    # Playwright end-to-end tests
```

CI (`.github/workflows/ci.yml`) runs `lint`, `test`, `build`, and the Playwright
`e2e` job on every push.

## Where to make common changes

- **A drill's behaviour/UI** → the matching `src/views/*View.vue`.
- **Quiz/declension/grading logic** → the pure module in `src/lib/` (keep it
  framework-free so it stays unit-testable), and add/extend its `*.test.js`.
- **Add/edit words** → the YAML in `public/vocab/` + bump `updated` in
  `manifest.json`. `vocabBuild.test.js`/`declension.test.js` guard the shape.
  Full schema reference: [`public/vocab/CONTRIBUTING.md`](public/vocab/CONTRIBUTING.md).
- **App-wide state** → the relevant `src/stores/*.js` (Vue reactive store);
  most learning state lives in `progress.js`, delegating to the pure `lib` engine.
- **The session/practice flow** → `src/views/SessionView.vue` +
  `src/lib/sessionRunner.js` / `session.js` / `exerciseBuild.js`.
- **Routing** → `src/router/index.js`. There's no nav bar; the user navigates
  from `HomeView` (the header in `App.vue` is just the Home logo + Data avatar).

See `README.md` for the deeper architecture (vocab loading, offline caching).

## Agent workflow (GitHub issues)

When working from a GitHub issue:

1. **Branch name** — create a branch that reflects the issue, e.g. `fix/123-short-description` or `feat/123-short-description`. Do not use random suffixes.
2. **Implement** the changes on that branch and push.
3. **Raise a PR** when the work is complete — do not wait to be asked.
4. **Reference the issue** in the PR body with `Closes #<issue-number>` so GitHub auto-closes it on merge.
