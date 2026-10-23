import { defineConfig, devices } from '@playwright/test';

const API_PORT = process.env['E2E_API_PORT'] ?? '3100';
const WEB_PORT = process.env['E2E_WEB_PORT'] ?? '4300';

/**
 * End-to-end journeys against the real API and web app. Each test signs up fresh accounts, so tests
 * are independent and need no database reset. Run with `npm run e2e` from the repository root.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    // The welcome tour would cover the page in every test; tour.spec.ts turns it back on.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${WEB_PORT}`, localStorage: [{ name: 'fh.tourSeen', value: '1' }] }] },
    ...(process.env['PW_CHROMIUM_PATH'] ? { launchOptions: { executablePath: process.env['PW_CHROMIUM_PATH'] } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /(responsive|tour)\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node scripts/api.mjs',
      url: `http://localhost:${API_PORT}/health/live`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { E2E_API_PORT: API_PORT, E2E_WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npx ng serve --port ${WEB_PORT} --proxy-config ../e2e/proxy.json`,
      cwd: '../frontend',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 240_000,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
