import { defineConfig } from '@playwright/test';

// End-to-end tests against the production build (npm run test:e2e).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4329' },
  webServer: {
    command: 'npm run build && npx astro preview --port 4329 --host 127.0.0.1',
    url: 'http://127.0.0.1:4329/play/',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
