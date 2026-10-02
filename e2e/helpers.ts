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

type Options = { withAi: boolean; today: Date };

/**
 * Every test starts on a fresh, empty app at a fixed date, and fails if the page throws or logs an
 * error.
 */
export const test = base.extend<Options & { app: App }>({
  withAi: [false, { option: true }],
  today: [TODAY, { option: true }],
  app: async ({ page, withAi, today }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.clock.setFixedTime(today);
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

  /**
   * Go somewhere from the tab bar (closing any open sheets first): a tab, a screen in Browse, or
   * Settings (the profile button).
   */
  async tab(name: 'Today' | 'Activity' | 'Browse' | 'Spending' | 'Recurring' | 'Net Worth' | 'Settings') {
    const { page } = this;
    if (await page.locator('.sheet').count()) await this.closeSheets();
    // Search swaps the tab bar for its box and a back button.
    if (await page.locator('.search-mode').count()) await page.locator('.tab-back').click();
    if (name === 'Today' || name === 'Activity' || name === 'Browse') {
      await page.locator('.tabbar button', { hasText: name }).click();
      return;
    }
    await page.locator('.tabbar button', { hasText: 'Browse' }).click();
    if (name === 'Settings') await page.getByRole('button', { name: 'Settings', exact: true }).click();
    else await this.browseCard(name === 'Recurring' ? 'Bills & Subscriptions' : name).click();
  }

  /** A card in Browse → Everything, by its title. */
  browseCard(title: string) {
    return this.page.locator('.browse-card').filter({ has: this.page.locator('.browse-card-title', { hasText: new RegExp(`^${title}$`) }) });
  }

  /** Browse → Plan. */
  async openPlan() {
    await this.tab('Browse');
    await this.browseCard('Plan').click();
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
      // A sheet may be closing on its own (after Save): then there's nothing to click.
      await page
        .locator('.sheet')
        .last()
        .locator('.sheet-header button')
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
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

  /** A form field by its label (not by text inside its control, like a dropdown's options). */
  field(label: string | RegExp) {
    return this.sheet()
      .locator('.field')
      .filter({ has: this.page.locator('.field-label', { hasText: label }) });
  }

  txnRows(text?: string | RegExp) {
    return this.page.locator('.txn-row', text ? { hasText: text } : undefined);
  }
}
