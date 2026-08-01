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
  },
})
