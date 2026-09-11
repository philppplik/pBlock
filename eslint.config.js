import globals from 'globals';

/**
 * ESLint-Flat-Config für pBlock.
 *
 * Drei Umgebungen mit unterschiedlichen Globals:
 *  - `src/core`               : plattformneutrale Logik (kein `chrome`, kein DOM)
 *  - `src/background`         : Service Worker (chrome + worker globals)
 *  - `src/content`, `src/ui`  : DOM + chrome
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'website/**', 'src/vendor/**'],
  },

  // Gemeinsame Basis
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.es2021 },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // Korrektheit
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-promise-executor-return': 'error',
      'no-return-await': 'error',

      // Lesbarkeit / Wartbarkeit
      'prefer-template': 'error',
      'object-shorthand': ['error', 'properties'],
      'no-nested-ternary': 'error',
      complexity: ['warn', 18],
      'max-depth': ['warn', 4],

      // Sicherheit: in einer Extension nicht verhandelbar.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
    },
  },

  // Reine Logik — bewusst ohne `chrome` und ohne DOM, damit sie testbar bleibt.
  {
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'src/core muss plattformneutral bleiben — Adapter injizieren.' },
        { name: 'window', message: 'src/core muss plattformneutral bleiben.' },
        { name: 'document', message: 'src/core muss plattformneutral bleiben.' },
      ],
      'no-console': 'error',
    },
  },

  // Service Worker
  {
    files: ['src/background/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, chrome: 'readonly' },
    },
    rules: {
      // `window` existiert im Service Worker nicht — genau das war ein realer Bug in v4.
      'no-restricted-globals': [
        'error',
        { name: 'window', message: '`window` existiert im Service Worker nicht.' },
        { name: 'document', message: '`document` existiert im Service Worker nicht.' },
        {
          name: 'localStorage',
          message: 'Im Service Worker nicht verfügbar — chrome.storage verwenden.',
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Content-Scripts und UI-Seiten
  {
    files: ['src/content/**/*.js', 'src/ui/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Build-Skripte laufen unter Node
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests
  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-globals': 'off',
    },
  },
];
