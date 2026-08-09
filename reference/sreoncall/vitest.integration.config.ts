
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include:  ['.claude/tests/integration/**/*.spec.ts'],
    globals:  true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 15000,
    setupFiles: ['.claude/tests/integration/setup.ts'],
    reporters:  ['verbose'],
  },
});
