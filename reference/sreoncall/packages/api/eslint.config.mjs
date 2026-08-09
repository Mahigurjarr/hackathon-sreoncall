// Flat ESLint config (ESLint 9). Lenient baseline: correctness-oriented
// rules stay as errors; stylistic/noisy rules are warnings so CI stays green
// on a codebase that was never linted. Tighten over time.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Noise on an unlinted TS codebase — downgrade, don't block.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'off',
      'prefer-const': 'warn',
    },
  },
);
