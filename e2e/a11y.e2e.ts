import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, fixture, test } from './helpers';
import { mockTwelveData, MOCK_KEY, SPY } from './prices';

/** What axe finds on the page right now, as "rule: element" lines (empty when clean). */
async function problems(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The glass blurs whatever is behind it, which axe can't see, so it can't judge contrast there.
    .disableRules(['color-contrast'])
    .analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? v.help}`));
}

/** Nothing on the page is wider than the phone (no sideways scrolling). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('main *, .sheet *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > width + 1 || r.left < -1) && !el.closest('.scroll-x, .chart, .recap, .filters, .segmented');
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  });
}

test('every main screen has accessible names and roles, and fits the phone @smoke', async ({ app, page }) => {
  await app.importAll();
  const check = async (where: string) => {
    await page.waitForTimeout(400);
    expect(await problems(page), where).toEqual([]);
    expect(await overflow(page), `${where}: sideways overflow`).toEqual([]);
  };
  await app.tab('Today');
  await check('Today');
  await app.tab('Activity');
  await check('Activity');
  await app.tab('Browse');
  await check('Browse');
  for (const name of ['Spending', 'Recurring', 'Net Worth'] as const) {
    await app.tab(name);
    await check(name);
  }
  await app.tab('Browse');
  await app.browseCard('Money Health').click();
  await check('Money Health');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search or ask').fill('coffee');
  await check('Search');
  await page.locator('.top-hit').click();
  await check('Category page');
  await app.tab('Activity');
  await app.txnRows().first().click();
  await check('Transaction editor');
  await app.tab('Settings');
  await check('Settings');
  await app.sheet().getByRole('button', { name: /About Finance Tracker/ }).click();
  await check('About');
  await app.sheet().getByRole('button', { name: 'Privacy' }).click();
  await check('Privacy');
});

test('the sheets opened from Browse are accessible too', async ({ app, page }) => {
  await app.importAll();
  for (const card of ['Plan', 'Year in Review', 'Budgets', 'People', 'Trips & Tags']) {
    await app.tab('Browse');
    await app.browseCard(card).click();
    await expect(app.sheet()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await problems(page), card).toEqual([]);
    expect(await overflow(page), `${card}: sideways overflow`).toEqual([]);
  }
  await app.closeSheets();
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Mortgage calculator' }).click();
  await app.field('Home price').locator('input').fill('450000');
  await app.field('Down payment').locator('input').fill('10');
  await page.waitForTimeout(400);
  expect(await problems(page), 'Mortgage').toEqual([]);
  expect(await overflow(page), 'Mortgage: sideways overflow').toEqual([]);
});

test('the stock sheets are accessible too', async ({ app, page }) => {
  await mockTwelveData(page, [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market Index Fund ETF', type: 'ETF', exchange: 'NYSE', price: (i) => 240 + 0.1 * i },
    SPY,
  ]);
  await page.reload();
  const check = async (where: string) => {
    await page.waitForTimeout(400);
    expect(await problems(page), where).toEqual([]);
    expect(await overflow(page), `${where}: sideways overflow`).toEqual([]);
  };
  await app.tab('Net Worth');
  await page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill('Brokerage');
  await app.field('Type').locator('select').selectOption('brokerage');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();
  await page.locator('.row', { hasText: 'Brokerage' }).first().click();
  await app.sheet().getByRole('button', { name: 'Turn On Stock Prices' }).click();
  await check('Stock Prices');
  await app.field('API key').locator('input').fill(MOCK_KEY);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Stock prices on');
  await check('Stock Prices (on)');
  await app.sheet().locator('.sheet-header button').first().click();
  await app.sheet().getByRole('button', { name: 'Add a Stock, ETF or Fund' }).click();
  await app.field('Ticker').locator('input').fill('vti');
  await app.sheet().locator('.row', { hasText: 'Vanguard Total Stock Market' }).click();
  await app.field('Amount').locator('input').fill('1000');
  await app.field('Date').locator('input').fill('2026-01-05');
  await expect(app.sheet()).toContainText('the close on Jan 5');
  await check('Add Holding');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(app.sheet().locator('.holding-row', { hasText: 'VTI' })).toBeVisible();
  await check('Account with holdings');
  await app.sheet().getByLabel('Import positions from your brokerage').setInputFiles(fixture('fidelity-positions.csv'));
  await expect(app.sheet().getByRole('heading', { name: 'Import Positions' })).toBeVisible();
  await check('Import Positions');
  await app.sheet().locator('.sheet-header button').first().click();
  await app.sheet().locator('.holding-row', { hasText: 'VTI' }).click();
  await check('Holding');
  await app.closeSheets();
  await app.tab('Browse');
  await app.browseCard('Portfolio').click();
  await expect(app.sheet().locator('.portfolio-hero .chart')).toBeVisible();
  await check('Portfolio');
  await app.sheet().locator('.row', { hasText: 'If you sold it all today' }).click();
  await expect(app.sheet().getByRole('heading', { name: 'Taxes' })).toBeVisible();
  await check('Taxes');
  await app.sheet().locator('.sheet-header button').first().click();
  await app.sheet().getByRole('button', { name: 'Set Target' }).click();
  await check('Target Mix');
});
