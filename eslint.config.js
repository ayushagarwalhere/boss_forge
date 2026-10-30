import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.artifacts/**', 'forge/*/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'fetch', 'Date', 'performance', 'setTimeout', 'setInterval', 'process'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the explicit seeded RNG.' }],
      'no-restricted-imports': ['error', { patterns: ['node:*'] }],
    },
  },
);
