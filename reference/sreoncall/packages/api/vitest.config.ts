
// Vitest config for sreoncall-api unit tests
// Place this file as packages/api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include:  ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    globals:  true,
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider:    'v8',
      include:     ['src/middleware/**', 'src/services/**'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
});
