import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs';
import globals from 'globals';

const base = await generateEslintConfig({ ignores: ['pkg/', 'src/vendor/'] });

export default [
  ...base,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
    rules: {
      // The packaging tool bundles src, and tests and scripts run from the repo, so dev dependencies are fine.
      'n/no-unpublished-import': 'off',
      'n/no-process-exit': 'off',
    },
  },
  {
    // node:test mock timers are marked experimental in Node 22 but work there.
    files: ['test/**/*.js'],
    rules: { 'n/no-unsupported-features/node-builtins': 'off' },
  },
];
