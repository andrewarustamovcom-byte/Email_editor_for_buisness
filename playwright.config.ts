import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: { command: 'npm run dev:fixture', url: 'http://127.0.0.1:5173/tests/fixtures/gmail.html', reuseExistingServer: !process.env.CI },
});
