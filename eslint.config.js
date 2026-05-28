import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'

// Correctness-focused config. Formatting is intentionally left to the editor /
// Prettier rather than enforced here, so we use Vue's "essential" rules.
export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // Vitest globals (vite.config.js sets `globals: true`).
    files: ['src/**/*.{test,spec}.js'],
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
  },
  {
    // Node scripts and config files.
    files: ['scripts/**', '*.config.js'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
]
