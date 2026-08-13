// Static checks for the whole repo.
//
// The rule that earns its keep here is no-undef. `node --check` only validates
// syntax, so a module used but never required is valid right up until the line
// runs — which is how a missing require reached production and broke PDF Check.
//
// The rule set is deliberately small. A linter that reports hundreds of things
// nobody intends to fix gets ignored, and then it catches nothing at all.

const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

// Reported rather than errors: worth seeing, but not worth blocking a commit
// over, and not worth a sweep through existing code to clear out.
const SHARED_RULES = {
  'no-unused-vars': ['warn', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',            // `catch {}` and unused err are used deliberately here
    ignoreRestSiblings: true,        // `const { cost_price, ...rest } = row` strips a field
  }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  // Flags the placeholder-counter idiom used to build parameterised SQL
  // (`params.push(x); p++;` on the last condition). That increment is there so
  // the next condition added doesn't quietly reuse a number, which is worth
  // more than the assignment it costs.
  'no-useless-assignment': 'off',
};

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'client/dist/**',
      'client/dev-dist/**',
      'client/public/**',
      'server/uploads/**',
      '**/*.min.js',
    ],
  },

  // ── Server: CommonJS on Node ──────────────────────────────────────────────
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...SHARED_RULES,
      'no-undef': 'error',
    },
  },

  // ── Client: ES modules in the browser, with JSX ───────────────────────────
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...SHARED_RULES,
      'no-undef': 'error',
      // Hooks called conditionally, or a component that isn't one, break in
      // ways that are hard to trace back from the symptom.
      'react-hooks/rules-of-hooks': 'error',
      // Stale closures are real bugs but the fix is often a judgement call,
      // and some deps are deliberately omitted here.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Build tooling under client/ runs on Node, not in the browser — the icon
  // generator is a CommonJS script, the Vite config is an ES module.
  {
    files: ['client/scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['client/*.config.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },

  // ── Apps Script: its own runtime and globals ──────────────────────────────
  {
    files: ['automation/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        GmailApp: 'readonly', DriveApp: 'readonly', Drive: 'readonly',
        DocumentApp: 'readonly', UrlFetchApp: 'readonly', Utilities: 'readonly',
        Logger: 'readonly', PropertiesService: 'readonly', ScriptApp: 'readonly',
        Session: 'readonly', SpreadsheetApp: 'readonly', console: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...SHARED_RULES,
      'no-undef': 'error',
      // Entry points are called by triggers and menus, never from the file.
      'no-unused-vars': 'off',
    },
  },
];
