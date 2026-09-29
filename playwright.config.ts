import { defineConfig, devices } from '@playwright/test';

/**
 * Phone-size browser tests (`npm run e2e`). They build the app and click through it in Chromium at
 * iPhone size, in light and dark mode. Set PW_CHROMIUM to use an already-installed Chromium.
 */
const port = 4174;
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}/finance-tracker/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'light', use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', launchOptions: { executablePath } } },
    {
      name: 'dark',
      grep: /@smoke/,
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', colorScheme: 'dark', launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/finance-tracker/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { BASE_PATH: '/finance-tracker/' },
  },
});
