import { test as base, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export { expect };

/** The sample bank files are dated around this day, so the clock is frozen here for every test. */
export const TODAY = new Date('2026-09-29T12:00:00');

export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/**
 * A stand-in for the on-device AI model: letter-trigram vectors, so payees with similar spelling are
 * similar. Good enough to exercise the AI screens without downloading the real model.
 */
function installAiMock() {
  const vec = (t: string) => {
    const v = new Array(64).fill(0);
    const s = ` ${t.toLowerCase()} `;
    for (let i = 0; i < s.length - 2; i++) {
      let h = 0;
      for (const c of s.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) % 64;
      v[h] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  };
  (window as unknown as { __financeAiMock: unknown }).__financeAiMock = { embed: async (texts: string[]) => texts.map(vec) };
}

type Options = { withAi: boolean };

/**
 * Every test starts on a fresh, empty app at a fixed date, and fails if the page throws or logs an
 * error.
 */
export const test = base.extend<Options & { app: App }>({
  withAi: [false, { option: true }],
  app: async ({ page, withAi }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.clock.setFixedTime(TODAY);
    if (withAi) await page.addInitScript(installAiMock);
    await page.goto('./');
    await expect(page.getByText('Welcome')).toBeVisible();
    await use(new App(page));
    expect(errors, 'page errors').toEqual([]);
  },
});

export class App {
  constructor(readonly page: Page) {}

  /** The top-most open sheet. */
  sheet() {
    return this.page.locator('.sheet').last();
  }

  async tab(name: 'Overview' | 'Activity' | 'Recurring' | 'Net Worth' | 'Settings') {
    await this.page.locator('.tabbar button', { hasText: name }).click();
  }

  /** Import a bank file through the real flow and return the summary text. */
  async importFile(file: string, opts: { type?: string; newAccountName?: string } = {}) {
    const { page } = this;
    await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
    await page.locator('.drop input[type=file]').setInputFiles(fixture(file));
    await expect(page.getByText('Review Import')).toBeVisible();
    if (opts.newAccountName) {
      await this.field('Account').locator('select').selectOption('__new__');
      await this.field('Name').locator('input').fill(opts.newAccountName);
    }
    if (opts.type) await this.field('Type').locator('select').selectOption(opts.type);
    await page.getByRole('button', { name: /^Import \d+/ }).click();
    await expect(page.getByText(/Imported \d+ transactions?/)).toBeVisible();
    return (await this.sheet().locator('.empty').innerText()).replace(/\s+/g, ' ');
  }

  /** Close every open sheet. */
  async closeSheets() {
    const { page } = this;
    while (await page.locator('.sheet').count()) {
      await page.locator('.sheet').last().locator('.sheet-header button').first().click();
      await page.waitForTimeout(300);
    }
  }

  /** The usual starting point: checking, a Discover card and a savings account. */
  async importAll() {
    await this.importFile('checking.csv', { type: 'checking' });
    await this.closeSheets();
    await this.importFile('discover.csv');
    await this.closeSheets();
    await this.importFile('savings.csv', { type: 'savings', newAccountName: 'High-Yield Savings' });
    await this.closeSheets();
  }

  field(label: string | RegExp) {
    return this.sheet().locator('.field', { hasText: label });
  }

  txnRows(text?: string | RegExp) {
    return this.page.locator('.txn-row', text ? { hasText: text } : undefined);
  }
}
