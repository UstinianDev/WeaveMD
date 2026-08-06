import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
  },
  webServer: {
    command: 'npx vite --config vite.test.config.ts',
    port: 5199,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
