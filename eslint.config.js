import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'

// Correctness-focused config. Formatting is intentionally left to the editor /
// Prettier rather than enforced here, so we use Vue's "essential" rules.
//
// The `globals` declarations below are load-bearing and deliberately explicit.
// Until eslint-plugin-vue 10 they were a freebie: v9's `flat/essential` injected
// the whole browser global list into *every* linted file, scripts included.
// v10 dropped that (correctly — a Node script has no `window`), so each layer
// now says which runtime it targets. Getting one wrong surfaces as `no-undef`,
// not as silence.
export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', '.claude/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    // The app: browser runtime, plus the constants Vite injects at build time.
    files: ['src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Build-time constants injected by Vite (see vite.config.js `define`).
        __APP_BUILD_DATE__: 'readonly',
        __APP_COMMIT_HASH__: 'readonly',
        __APP_RELEASE_NOTES__: 'readonly',
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // Vitest globals (vite.config.js sets `globals: true`).
    files: ['src/**/*.{test,spec}.js', 'src/test/**/*.js'],
    languageOptions: {
      globals: globals.vitest,
    },
  },
  {
    // Node scripts and config files.
    files: ['scripts/**', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // Playwright e2e specs: the spec body runs under Node, while the callbacks
    // handed to page.evaluate() run in the browser — so both sets apply.
    files: ['e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
]
