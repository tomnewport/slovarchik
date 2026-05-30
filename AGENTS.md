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

**Slovarchik** — an offline-first **PWA** for drilling Russian vocabulary and
noun declensions. No backend, no accounts; everything runs in the browser and
works offline. Deployed to GitHub Pages under the `/slovarchik/` base path.

- **Vue 3** (`<script setup>` SFCs) + **Vue Router** (hash history)
- **Vite 6** build, **vite-plugin-pwa** (Workbox) for the service worker/offline cache
- **Vitest** + **@vue/test-utils** + jsdom for tests
- Vocabulary is **YAML files** in `public/vocab/`, loaded on demand and cached in **IndexedDB** — not bundled. (`js-yaml` is a **runtime** dependency, not a devDep: the app parses the YAML in the browser.)

## Project map

```
index.html              # app shell — mounts #app, loads src/main.js
vite.config.js          # Vite + Vue plugin + PWA + Vitest config; base = /slovarchik/
eslint.config.js        # flat config: js.recommended + eslint-plugin-vue
src/
  main.js               # entry: createApp(App).use(router).mount('#app')
  App.vue               # shell: header nav + <RouterView> + global RussianKeyboard
  router/index.js       # routes → views (/, /vocab, /declension, /numbers, /phrases, /listening, /progress)
  views/*.vue           # one screen per route (the drills + Progress page)
  components/*.vue       # shared UI (RussianKeyboard, SpeakButton, HintKeyboard, CelebrationBurst)
  stores/               # VUE reactive stores (app state), NOT Redux:
    vocab.js            #   reactive vocab/nouns/phrases + IndexedDB sync
    progress.js         #   IndexedDB-backed attempt history + live queries
    keyboard.js         #   tiny shared hint state between drills + keyboard
  lib/                  # framework-free pure modules (unit-tested in isolation):
                        #   declension, quiz, phrases, numerals, numberDrill, text,
                        #   progress (model/queries), skills, practice, vocabBuild, idb, speech, collections
  test/fixtures.js      # shared test fixtures
public/vocab/           # *.yml word data (one per part of speech) + manifest.json
scripts/                # node maintenance scripts (icons, vocab sorting, coverage)
```

Tests live next to their source as `*.test.js`.

## Commands

```bash
npm install
npm run dev         # local dev server
npm test            # run unit tests once (vitest)
npm run test:watch  # watch mode
npm run lint        # eslint (correctness rules; formatting left to Prettier/editor)
npm run build       # production build into dist/
npm run preview     # serve the production build
```

CI (`.github/workflows/ci.yml`) runs `lint`, `test`, then `build` on every push.

## Where to make common changes

- **A drill's behaviour/UI** → the matching `src/views/*View.vue`.
- **Quiz/declension/grading logic** → the pure module in `src/lib/` (keep it
  framework-free so it stays unit-testable), and add/extend its `*.test.js`.
- **Add/edit words** → the YAML in `public/vocab/` + bump `updated` in
  `manifest.json`. `vocabBuild.test.js`/`declension.test.js` guard the shape.
  Full schema reference: [`public/vocab/CONTRIBUTING.md`](public/vocab/CONTRIBUTING.md).
- **App-wide state** → the relevant `src/stores/*.js` (Vue reactive store).
- **Routing/nav** → `src/router/index.js` + the `<nav>` in `App.vue`.

See `README.md` for the deeper architecture (vocab loading, progress model,
skills/mastery/exam-readiness).
</content>
</invoke>


<result>
<name>File not found</result>
</invoke>
