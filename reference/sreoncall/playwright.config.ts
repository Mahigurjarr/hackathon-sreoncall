import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ||
  path.join('.claude', 'reports', `run-${Date.now()}`);

export default defineConfig({
  testDir: '.claude/playwright/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACT_DIR, 'playwright-html'), open: 'never' }],
    ['json', { outputFile: path.join(ARTIFACT_DIR, 'logs', 'results.json') }],
  ],
  use: {
    baseURL: WEB_URL,
    screenshot: 'on',
    trace: 'on-first-retry',
    video: 'on-failure',
    headless: true,
    recordHar: {
      path: path.join(ARTIFACT_DIR, 'logs', 'network.har'),
      mode: 'full',
    },
    extraHTTPHeaders: {
      'X-Forwarded-Host': process.env.TEST_TENANT_HOST || 'acme.localhost',
    },
  },
  outputDir: path.join(ARTIFACT_DIR, 'traces'),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
