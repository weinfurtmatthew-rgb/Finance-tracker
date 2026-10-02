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

test('search: top hit, results, questions answered in place, recents, back', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Activity');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const box = page.getByLabel('Search or ask');
  await expect(box).toBeFocused();
  await expect(page.locator('.search-chips .chip').first()).toBeVisible();
  await box.fill('coffee');
  await expect(page.locator('.top-hit')).toContainText('Coffee');
  await expect(page.locator('.top-hit')).toContainText('this month');
  await expect(app.txnRows().first()).toBeVisible();
  // A plain search goes to Recent when you press return.
  await box.press('Enter');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.section', { hasText: 'Recent' }).locator('.row', { hasText: 'coffee' })).toBeVisible();
  // A question is answered right on the page.
  await box.fill('what are my subscriptions');
  await expect(page.locator('.search-ask')).toContainText('press return');
  await box.press('Enter');
  await expect(page.locator('.answer-card')).toContainText('what are my subscriptions');
  await expect(page.locator('.answer-card .answer-headline')).toBeVisible();
  await expect(box).toHaveValue('');
  // An example question works the same way.
  await page.locator('.row', { hasText: 'Where did my money go this month?' }).click();
  await expect(page.locator('.answer-card')).toHaveCount(2);
  // The round button goes back where you were.
  await page.getByRole('button', { name: 'Back to Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
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

test('Money Health scores six parts, from Browse and from Today @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Today');
  const teaser = page.locator('.health-teaser');
  await expect(teaser).toContainText(/Great|Good|Fair|Needs work/);
  await teaser.click();
  await expect(page.getByRole('heading', { name: 'Money Health', level: 1 })).toBeVisible();
  await expect(page.locator('.pillar')).toHaveCount(6);
  await expect(page.locator('.pillar', { hasText: 'Cash cushion' })).toContainText('months of spending in cash');
  await app.tab('Browse');
  await expect(app.browseCard('Money Health')).toContainText(/\d+ · (Great|Good|Fair|Needs work)/);
});

test('Activity: month card, quick filters and day totals', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Activity');
  const card = page.locator('.month-card');
  await expect(card).toContainText('September 2026');
  await expect(card).toContainText('spent');
  // Quick filter: money in only.
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await expect(page.locator('.filter-button')).toHaveText('Income');
  const rows = app.txnRows();
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).toMatch(/Income|Interest/);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.filter-button')).toHaveText('Filters');
  // The arrows show one month at a time.
  await card.getByRole('button', { name: 'Previous month' }).click();
  await expect(card).toContainText('August 2026');
  await expect(page.locator('.section-title').first()).toContainText(/Aug/);
  await expect(page.locator('.section-title .day-total').first()).toBeVisible();
});

test('detail pages: a category, a store and an account', async ({ app, page }) => {
  await app.importAll();
  // Search → a category page: average, chart, budget, places, pin.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search or ask').fill('coffee');
  await page.locator('.top-hit').click();
  const sheet = app.sheet();
  await expect(sheet.locator('.detail-hero-card')).toContainText('Average a month');
  await expect(sheet.locator('.detail-budget')).toBeVisible();
  await sheet.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.getByText('Pinned to Browse')).toBeVisible();
  // A store from the category's top places.
  await sheet.locator('.place-row').first().click();
  await expect(app.sheet().locator('.detail-hero-card')).toContainText('this year');
  await expect(app.sheet()).toContainText('Every visit');
  // The pinned category shows up in Browse.
  await app.tab('Browse');
  await expect(page.locator('.browse-pin', { hasText: 'Coffee' })).toContainText('this month');
  // An account page from Net Worth.
  await app.tab('Net Worth');
  await page.locator('button.row', { hasText: 'Checking' }).first().click();
  await expect(app.sheet().locator('.detail-hero-card')).toContainText('Balance');
  await expect(app.sheet().getByRole('button', { name: /All .* transactions/ })).toBeVisible();
});
