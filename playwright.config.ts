import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4310', browserName: 'chromium', headless: true, reducedMotion: 'reduce', screenshot: 'only-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:4310', reuseExistingServer: true, timeout: 20_000 },
});
