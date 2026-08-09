// Flat ESLint config (ESLint 9) for the Next.js app. Lenient baseline so CI
// stays green on a previously-unlinted codebase; tighten over time.
// `next lint` is deprecated in Next 15, so we invoke eslint directly.
// FlatCompat is avoided on purpose: the repo pins minimatch@10 (ESM, no
// default export) which crashes @eslint/eslintrc. We use the Next plugin's
// native flat config instead.
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'next-env.d.ts'],
  },
  nextPlugin.flatConfig.coreWebVitals,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@next/next/no-img-element': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      'no-unused-vars': 'off',
      'prefer-const': 'warn',
    },
  },
];
