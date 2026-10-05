import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** `npm run perf`: the speed benchmark in perf/ (not part of `npm run e2e` or CI). */
export default defineConfig({
  ...base,
  testDir: 'perf',
  testMatch: '**/*.bench.ts',
  reporter: 'list',
  projects: [base.projects![0]],
});
