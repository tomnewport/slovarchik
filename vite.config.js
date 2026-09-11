import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under https://<user>.github.io/slovarchik/ so assets need this base.
const base = '/slovarchik/'

function gitCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return null
  }
}

// The vocab YAML in public/vocab/ is the authoring source, but the client only
// ever fetches the build-generated JSON (see scripts/gen-manifest.mjs, #324).
// Vite copies all of public/ verbatim, so without this the deploy would ship
// both — doubling the ~5 MB vocab payload for bytes nothing loads. Drop the
// `.yml` (and the derived manifest, which is regenerated) from the output once
// Vite has finished writing it.
function dropVocabYaml() {
  return {
    name: 'drop-vocab-yaml',
    apply: 'build',
    closeBundle() {
      const dir = resolve('dist/vocab')
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        return // no dist/vocab (e.g. custom outDir) — nothing to prune
      }
      for (const f of entries) {
        if (f.endsWith('.yml')) rmSync(resolve(dir, f))
      }
    },
  }
}

export default defineConfig({
  base,
  // Build-time constants surfaced on the Data screen.
  define: {
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __APP_COMMIT_HASH__: JSON.stringify(gitCommitHash()),
  },
  plugins: [
    vue(),
    dropVocabYaml(),
    VitePWA({
      // 'prompt', not 'autoUpdate' (#691). Under 'autoUpdate' the plugin builds
      // the worker with skipWaiting + clientsClaim, so a new deploy activates
      // and claims the open page the moment a launch notices it — which, with
      // main.js reloading on that, meant a learner starting a session got the
      // page pulled out from under them a few seconds in. Under 'prompt' the
      // new worker installs and *waits*; src/stores/appUpdate.js records that
      // it is there and Home offers the swap when the learner is ready for it.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Slovarchik — Russian practice',
        short_name: 'Slovarchik',
        description: 'Offline-first drills for Russian vocabulary and noun declensions.',
        theme_color: '#0039a6',
        background_color: '#0b1021',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The two halves of "a new version takes over", set apart deliberately
        // (#691). `registerType: 'prompt'` above turns both off by default; the
        // e2e suite is what showed that only one of them should stay off.
        //
        // ⚠️  ONE-OFF RESCUE DEPLOY — `skipWaiting` is TRUE on purpose, and must
        // go back to `false` in the very next PR once this has reached Pages.
        // Left in place it is #691 regressed in full, silently. See #703.
        //
        // Why it has to be true exactly once: #702 shipped `skipWaiting: false`
        // to clients that were running an `autoUpdate` build, and those two do
        // not hand over to each other. The new worker will not activate itself,
        // and the old page cannot ask it to — under `autoUpdate` the register
        // script vite-plugin-pwa injects makes `updateServiceWorker` a no-op,
        // because autoUpdate expects the worker to call `self.skipWaiting()`:
        //
        //     if (!auto) { sendSkipWaitingMessage?.() }   // auto === true
        //
        // …and the old page is the old bundle, so it has no Update banner to
        // offer either. Every install from before #702 is therefore stranded on
        // the last autoUpdate build, collecting one more waiting worker per
        // deploy. Only the worker can break the deadlock, by taking itself.
        //
        // Those clients then reload on their own: their `main.js` still listens
        // on `controllerchange` (#190), so they land on a build that *has* the
        // banner, and the next deploy can go back to asking politely.
        //
        // Note this build's own `main.js` plays no part in that. At the moment
        // of claiming, every stranded client is still running the old bundle —
        // so re-adding a `controllerchange` reload here would rescue nobody and
        // would only bring #691 back.
        //
        // Once reverted, the comment below is true again:
        //
        // `skipWaiting: false` is the fix: a freshly deployed worker installs
        // and waits, instead of activating the moment a launch notices it.
        // Nothing takes over until the learner presses Update on Home.
        //
        // `clientsClaim: true` has to come back, though. It governs what a
        // worker does once it *has* activated, and on a first-ever visit that
        // is immediately — nothing is waiting for. Without it the page that
        // installed the worker is never controlled, and neither is the next
        // one if it happens to be created before activation finishes: the
        // offline spec caught exactly that, a second launch still uncontrolled
        // and therefore still not offline-capable. Claiming costs nothing here
        // now that nothing reloads on `controllerchange`.
        skipWaiting: true, // ⚠️ RESCUE ONLY — back to false next PR (#703)
        clientsClaim: true,
        // Precache the *app shell only* — JS/CSS/HTML/icons/fonts. The vocab
        // (`vocab/*.json` + `manifest.json`) is deliberately excluded (#266):
        // precaching it pulled the full ~4.4 MB into the SW on first install and,
        // because any word change alters the precache manifest revision, forced
        // every client to re-download the whole precache on *every deploy* — even
        // though only a couple of small vocab files actually changed. The `.yml`
        // authoring source is likewise not precached (the client only ever fetches
        // the build-generated `.json`).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        globIgnores: ['**/vocab/**'],
        // Nothing else caches the vocab at the network layer, deliberately (#670).
        //
        // There used to be a `runtimeCaching` rule giving vocab/*.json its own
        // StaleWhileRevalidate cache, on the reasoning that it made the corpus
        // available offline. It did not, and the e2e suite proved it: the
        // `slovarchik-vocab` cache is empty in a real browser on the path a
        // learner actually takes.
        //
        // Two things kept it empty. On a first visit the worker installs but
        // does not yet control the page that registered it, so `syncFromNetwork`'s
        // twelve fetches never reach it. On every visit after that the manifest
        // hashes match, so the store issues no vocab fetch at all — it reads
        // IndexedDB. What carries the corpus across a network cut has always
        // been `src/stores/vocab.js`'s IndexedDB cache, not the worker.
        //
        // It was not merely inert. The rule also matched `manifest.json`, and a
        // worker intercepts a request regardless of the `cache: 'no-cache'` the
        // store passes to `fetch` — that option controls the HTTP cache, not the
        // worker — so the manifest was answered from the previous launch's copy.
        // Since its content hashes are the only thing that tells the store a
        // word file changed, a deploy's vocab change stayed invisible until the
        // launch after next. Removing the rule fixes that outright.
        //
        // #266's split is untouched: the app shell is still precached, the vocab
        // still is not, so a word change does not re-ship the shell.
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.mjs'],
    // The mount-heavy view tests take a few seconds each, and v8's coverage
    // instrumentation roughly doubles that — enough to trip the 5 s default
    // under `test:coverage`. Give every test the same headroom so a run means
    // the same thing with and without `--coverage`.
    testTimeout: 15000,
    // Coverage is measured over the *logic* layers only — the framework-free
    // `lib/` engine, the reactive stores and the composables (#535). Two
    // reasons to scope it rather than take a repo-wide number: the `.vue`
    // views are exercised by @vue/test-utils and Playwright, where line
    // coverage says little about whether a drill actually works; and the test
    // count is dominated by data-driven corpus oracles asserting over
    // thousands of vocab entries, which inflate the totals while touching only
    // a handful of code paths. A number over the code that holds the logic is
    // the one worth acting on.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'json-summary'],
      reportOnFailure: true,
      include: ['src/lib/**/*.js', 'src/stores/**/*.js', 'src/composables/**/*.js'],
      exclude: [
        '**/*.{test,spec}.js',
        'src/lib/seed.js', // test-support fixtures, not shipped logic
        'src/lib/morphGolden.js', // curated oracle data, not code
        'src/lib/stressGolden.js',
      ],
      // Thresholds are a ratchet, not an aspiration: they sit just under the
      // current numbers so a change that drops coverage fails loudly, and are
      // meant to be raised when the real figure climbs past them.
      thresholds: {
        'src/lib/**/*.js': { statements: 95, branches: 84, functions: 97, lines: 97 },
        'src/stores/**/*.js': { statements: 92, branches: 85, functions: 92, lines: 95 },
        'src/composables/**/*.js': { statements: 95, branches: 92, functions: 95, lines: 96 },
      },
    },
  },
})
