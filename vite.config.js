import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under https://<user>.github.io/slovarchik/ so assets need this base.
const base = '/slovarchik/'

export default defineConfig({
  base,
  // The date the running app code was built, surfaced on the Data screen.
  define: {
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    vue(),
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
        // Precache the app shell *and* the vocab manifest/YAML so the very first
        // offline launch (after install) still has data to download into IDB.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,yml}'],
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
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
})
