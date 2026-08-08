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
      registerType: 'autoUpdate',
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
        // Serve the vocab from a separate runtime cache instead: cache-first for
        // instant, offline-capable loads once a file has been seen, with a
        // background revalidation that pulls fresh bytes when online. This keeps
        // the app fully usable offline after the first online visit, while
        // decoupling app-shell updates from the multi-MB word data — deploys no
        // longer re-ship vocab the client already has. (The store in
        // src/stores/vocab.js still owns its own IndexedDB cache + manifest-hash
        // sync; this SW cache is the network-fetch layer beneath it.)
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/vocab\/.*\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'slovarchik-vocab',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
