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
  router/index.js       # 17 routes → views. Highlights: / (home), /session, /batch,
                        #   /practice, /progress, /data, /vocab, /phrases, /phrase-fix,
                        #   /verb-government, /listening, /speaking, /numbers, and the
                        #   shared inflection view at /declension /verbs /pronouns
                        #   /adjectives (one InflectionView fed a different `pos` prop).
  views/*.vue           # one screen per route (HomeView + SessionView are the big ones)
  components/*.vue       # shared UI (RussianKeyboard, SpeakButton, HintablePhrase,
                        #   ProgressPill, ReportButton, CelebrationBurst, AchievementBadge,
                        #   BatchSearchAdd, WordProgressModal, WordFacts, AnnotatedEnglish, …)
    exercises/*.vue     #   per-exercise UIs (Flashcard, Type, WordBank, Inflect, Speak,
                        #   PhraseFix, VerbContrast)
    inflection/*.vue    #   inflection-table UIs (DragTable, BlindEndings, IdentifyForm)
  composables/          # stateful Vue orchestration shared between views (needs a
                        #   component lifecycle, so it can't live in lib/):
    useSpeechLoop.js    #   sequence guards, timer registry, speech watchdogs, wake
                        #   lock, mic lifecycle — SpeakingView + PracticeView
  stores/               # VUE reactive stores (app state), NOT Redux:
    vocab.js            #   reactive vocab/nouns/phrases + IndexedDB sync
    progress.js         #   the core engine (~1.3k lines) — per-word attempts → states, batches, sessions
    settings.js         #   user preferences (not learning progress)
    reports.js          #   offline-queued issue reports
    keyboard.js         #   shared on-screen keyboard hint state
    hints.js            #   in-phrase word-hint glue
    errorToast.js       #   transient error toast state
  lib/                  # framework-free pure modules (unit-tested in isolation). Grouped:
                        #   progression/schedule/batches/session/sessionPools/sessionRunner/
                        #     practices/exerciseBuild/flashcardRepeat/focus/achievements/streak  — the learning engine
                        #   declension/paradigm/adjectiveDeclension/participles/numerals/numberDrill  — inflection & numbers
                        #   verbGovernment  — which case / preposition frame a verb forces on its object
                        #   wordFacts  — a word's authored facts (build/root/origin/mnemonic) and its related words, derived + authored
                        #   phrases/phraseHint/phraseContext/phraseAmbiguity/promptDisambiguation/glossCoverage/glossaryPromotion  — phrases & glossary→curriculum
                        #   quiz/recognition/handsFree/handsFreePools/speakingDrill/speech/feedbackSound/spellReveal  — drills & speech
                        #   confusables  — what a wrong answer actually was (aspect partner, synonym, wrong form…) and how to say so, in either direction
                        #   flashcardOptions/initialism/stressAudit/spellPrompt/homeDashboard  — drill & dashboard view-model helpers
                        #   stressAudit/stressGolden/morphOracle/morphGolden/genderBalance/degreeCoverage/participleCoverage/spellPrompt/wordFacts  — corpus data-integrity oracles (CI guards on the vocab)
                        #   translationAudit  — ranks example sentences for a translation-quality review (a worklist, NOT a CI guard — see docs/translation-review.md)
                        #   vocabBuild/idb/plain/text/collections/reportIssue/seed  — data & utilities
  test/fixtures.js      # shared test fixtures
  test/idbFailure.js    # forces IndexedDB writes to abort (persistence-failure tests)
public/vocab/           # *.yml word data (one per part of speech) + manifest.json
e2e/                    # Playwright specs
docs/                   # design notes for in-flight features
scripts/                # node maintenance scripts (icons, vocab sorting, coverage)
```

Tests live next to their source as `*.test.js`; e2e specs live in `e2e/`.

Coverage is measured over the logic layers only — `src/lib/`, `src/stores/` and
`src/composables/` — not the `.vue` views, which @vue/test-utils and Playwright
cover in ways a line count says little about. Each layer has a threshold in
`vite.config.js` set just under where it stands today, so a change that drops
coverage fails CI; raise the thresholds when the real figure climbs past them.

## Commands

```bash
npm install
npm run dev         # local dev server
npm test            # run unit tests once (vitest)
npm run test:watch  # watch mode
npm run test:coverage # same suite + coverage over src/lib, src/stores, src/composables
npm run lint        # eslint (correctness rules; formatting left to Prettier/editor)
npm run build       # production build into dist/
npm run preview     # serve the production build
npm run test:e2e    # Playwright end-to-end tests
```

CI (`.github/workflows/ci.yml`) runs `lint`, `test:coverage`, `build`, and the
Playwright `e2e` job on every push, publishing the coverage table to the run's
job summary via `scripts/coverage-summary.mjs`.

## Where to make common changes

- **A drill's behaviour/UI** → the matching `src/views/*View.vue`.
- **Quiz/declension/grading logic** → the pure module in `src/lib/` (keep it
  framework-free so it stays unit-testable), and add/extend its `*.test.js`.
- **Add/edit words** → just edit the YAML in `public/vocab/`. `manifest.json` is
  generated (content hashes drive the client's cache invalidation, dates come
  from git history) and **not committed** — `npm run build` and `npm run dev`
  regenerate it, so there's nothing to bump and nothing to conflict over on
  parallel branches. `npm run gen:manifest` regenerates it on demand if you want
  to eyeball it. `vocabBuild.test.js`/`declension.test.js` guard the shape.
  Full schema reference: [`public/vocab/CONTRIBUTING.md`](public/vocab/CONTRIBUTING.md).
- **App-wide state** → the relevant `src/stores/*.js` (Vue reactive store);
  most learning state lives in `progress.js`, delegating to the pure `lib` engine.
- **The session/practice flow** → `src/views/SessionView.vue` +
  `src/lib/sessionRunner.js` / `session.js` / `exerciseBuild.js`.
- **Mic/speech timing in the spoken drills** (watchdogs, sequence guards, wake
  lock) → `src/composables/useSpeechLoop.js`, shared by SpeakingView and
  PracticeView — fix it once, both get it.
- **Routing** → `src/router/index.js`. There's no nav bar; the user navigates
  from `HomeView` (the header in `App.vue` is just the Home logo + Data avatar).

See `README.md` for the deeper architecture (vocab loading, offline caching).

## Agent workflow (GitHub issues)

When working from a GitHub issue:

1. **Branch name** — create a branch that reflects the issue, e.g. `fix/123-short-description` or `feat/123-short-description`. Do not use random suffixes.
2. **Implement** the changes on that branch and push.
3. **Raise a PR** when the work is complete — do not wait to be asked.
4. **Reference the issue in a commit message** — put `Closes #<issue-number>` (or `Fixes`/`Resolves`) in the body of a commit, not just the PR title or description. That way the link travels with the commits into whatever PR is opened, even when you don't open it yourself, and GitHub auto-closes the issue on merge. A `#123` in the title does nothing; a mention without a closing keyword doesn't auto-close. If the change genuinely closes no issue (a chore, a pure refactor), say so explicitly with a `No-issue: <reason>` line in a commit message. CI enforces this: the **PR issue link** check fails a PR with neither a closing reference (in a commit message or the PR body) nor a `No-issue` declaration (or the `no-issue` label, which Dependabot-style PRs use).

**Keep this map honest.** When a change adds or removes a route, store, or a
`src/lib/` module — or a whole `components/` subtree — update the "Project map"
above in the same PR. The map above drifts every few features otherwise; a
one-line edit alongside the code keeps onboarding (human and agent) accurate.
