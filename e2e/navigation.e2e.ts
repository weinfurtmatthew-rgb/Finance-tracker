import { expect, test } from './helpers';

test('Browse opens every part of the app, and pinned cards come first @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Browse');
  // Net worth and bills are pinned to start with.
  await expect(page.locator('.browse-pin')).toHaveCount(2);
  await expect(page.locator('.browse-pin').first()).toContainText('Net Worth');

  // Pin Spending, unpin Bills.
  await page.getByRole('button', { name: 'Edit' }).click();
  await app.browseCard('Spending').click();
  await app.browseCard('Bills & Subscriptions').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.browse-pin')).toHaveText([/Net Worth/, /Spending/]);

  // A Browse screen shows Browse lit and a way back.
  await app.browseCard('Net Worth').click();
  await expect(page.getByRole('heading', { name: 'Net Worth', level: 1 })).toBeVisible();
  await expect(page.locator('.tabbar button', { hasText: 'Browse' })).toHaveAttribute('aria-current', 'page');
  await page.locator('.back-pill').click();
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible();

  // Settings is behind the profile button.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(app.sheet().getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('search finds categories and transactions, and passes the words to Ask', async ({ app, page }) => {
  await app.importAll();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search transactions, categories and tags').fill('coffee');
  await expect(page.locator('.section', { hasText: 'Categories' }).locator('.row', { hasText: 'Coffee' })).toBeVisible();
  await expect(app.txnRows().first()).toBeVisible();
  await page.locator('.search-ask').click();
  await expect(app.sheet().locator('.ask-bar input')).toHaveValue('coffee');
});

test('Today: the day in money, Spend Readiness, pace and bills @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Today');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.locator('.day-summary')).toContainText(/pace|early in September/);
  // The readiness tile opens what the score is made of.
  const tile = page.locator('.readiness-tile');
  await expect(tile).toHaveAttribute('aria-label', /Spend Readiness \d+ out of 10, (Go For It|On Track|Pace Yourself|Hold Off)/);
  await tile.click();
  await expect(app.sheet().locator('.factor-row')).toHaveCount(4);
  await expect(app.sheet()).toContainText('Bills before payday');
  await app.closeSheets();
  // With a few months of history, the month is measured against the usual.
  await expect(page.locator('.left-tile')).toContainText('usual');
  await expect(page.locator('.pace-card')).toContainText(/under pace|over pace/);
});
