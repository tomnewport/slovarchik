import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // A full-session run is long; give one flake a single retry on CI without
  // cascading. Locally, fail fast.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173/slovarchik/',
    // Record a video of every run and keep it — the full-session walkthrough is
    // the artifact called for in #322. Trace is captured on a retry to debug flakes.
    video: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Honour a pre-provisioned Chromium (e.g. a sandbox whose bundled build
        // differs from the pinned Playwright one) when PW_EXECUTABLE_PATH is set.
        // Unset in normal/CI runs, where Playwright uses its own download.
        ...(process.env.PW_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/slovarchik/',
    reuseExistingServer: !process.env.CI,
  },
})
