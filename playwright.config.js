import { defineConfig, devices } from '@playwright/test'

// Two servers, because the suite needs two different things (#665).
//
// Most specs only need the app, and the dev server is much faster to start. But
// vite-plugin-pwa registers no service worker under `npm run dev`, so anything
// about offline, precaching or the update-and-reload path is untestable there —
// which is exactly why the offline claim went untested for so long. The offline
// project therefore runs against the real production build via `vite preview`.
const DEV_URL = 'http://localhost:5173/slovarchik/'
const PREVIEW_URL = 'http://localhost:4173/slovarchik/'

// Honour a pre-provisioned Chromium (e.g. a sandbox whose bundled build differs
// from the pinned Playwright one) when PW_EXECUTABLE_PATH is set. Unset in
// normal/CI runs, where Playwright uses its own download.
const launch = process.env.PW_EXECUTABLE_PATH
  ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
  : {}

export default defineConfig({
  testDir: './e2e',
  // A full-session run is long; give one flake a single retry on CI without
  // cascading. Locally, fail fast.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: DEV_URL,
    // Record a video of every run and keep it — the full-session walkthrough is
    // the artifact called for in #322. Trace is captured on a retry to debug flakes.
    video: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /offline\.spec\.js/,
      use: { ...devices['Desktop Chrome'], ...launch },
    },
    {
      // The app is phone-first and nothing rendered it at a phone size, so a
      // layout that only works on a wide viewport could ship unnoticed (#665).
      // This is the cheap smoke — Home at 393×851 — not the full session: the
      // long walkthrough is a flow test, and running it twice would double the
      // slowest job in CI to re-assert logic that has nothing to do with width.
      name: 'pixel5',
      testMatch: /homepage\.spec\.js/,
      use: { ...devices['Pixel 5'], ...launch },
    },
    {
      // Served from the production build, where the service worker actually
      // exists. Chromium only — Playwright's offline emulation and SW support
      // are what this project is here to exercise.
      name: 'offline',
      testMatch: /offline\.spec\.js/,
      use: { ...devices['Desktop Chrome'], ...launch, baseURL: PREVIEW_URL },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The offline project needs a real service worker, which only a built
      // app has. Building here (rather than relying on a prior `npm run build`)
      // keeps `npm run test:e2e` self-contained.
      command: 'npm run build && npm run preview',
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
