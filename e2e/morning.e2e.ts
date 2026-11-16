import { expect, test } from './helpers';

test.describe('on a Monday morning', () => {
  test.use({ today: new Date('2026-09-28T08:00:00') });

  test('the morning summary opens by itself on the first open of the morning, once @smoke', async ({ app, page }) => {
    await app.importAll();
    await app.closeSheets();
    // Importing doesn't open it; the next time the app opens does.
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
    await page.reload();
    const sheet = page.getByRole('dialog', { name: 'Morning Summary' });
    await expect(sheet.getByRole('heading', { name: /Good morning,\s*it’s Monday, Sep 28/ })).toBeVisible();
    await expect(sheet.getByText('From your bank files through today.')).toBeVisible();

    // Where you stand: the same net worth as Net Worth, and what changed this week.
    const stand = sheet.locator('.m-grid');
    await expect(stand.locator('.m-stat', { hasText: 'Net worth' })).toContainText('$19,186');
    await expect(stand.locator('.m-stat', { hasText: 'Net worth' })).toContainText('▼ $116 this week');
    await expect(stand.locator('.m-stat', { hasText: 'On cards' })).toContainText('$503');

    // To do: the top of Today's list, as cards; each opens what it's about.
    await expect(sheet.locator('.m-todo').first()).toContainText('Back up your data');
    await expect(sheet.getByRole('button', { name: /more on Today/ })).toBeVisible();

    // The last 7 days and the next 7.
    const week = sheet.locator('.m-part', { hasText: 'The last 7 days' });
    await expect(week).toContainText('Net worth down $116');
    await expect(week).toContainText('$384 → $503 owed');
    await expect(week).toContainText('$120 spent');
    await expect(week.locator('.txn-row', { hasText: 'Chipotle' })).toContainText('−$119.68');
    await expect(sheet.locator('.m-part', { hasText: 'The next 7 days' })).toContainText('See your week ahead');

    // A stat opens where it comes from; the summary closes.
    await stand.locator('.m-stat', { hasText: 'Money Health' }).click();
    await expect(page.getByRole('heading', { name: 'Money Health', level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);

    // Seen today: opening the app again doesn't bring it back.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Money Health', level: 1 }).or(page.getByRole('heading', { name: 'Today', level: 1 }))).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
  });

  test('with bills tracked, the next 7 days shows what is due, and a stale import says so', async ({ app, page }) => {
    await app.importAll();
    await app.tab('Recurring');
    await page.getByText(/Found \d+ possible recurring/).click();
    await page.getByRole('button', { name: 'Add All' }).click();
    await app.closeSheets();
    await app.tab('Today');
    await page.getByRole('button', { name: 'Morning summary' }).click();
    const ahead = app.sheet().locator('.m-part', { hasText: 'The next 7 days' });
    await expect(ahead.locator('.m-day.today')).toContainText('28');
    await expect(ahead.locator('.txn-row').first()).toBeVisible();
    await expect(ahead.locator('.section-footer')).toContainText(/Paycheck .* in checking/);
  });
});

test.describe('a week after the last import', () => {
  test.use({ today: new Date('2026-10-05T07:30:00') });

  test('it says the numbers are behind, with a way to import', async ({ app, page }) => {
    await app.importAll();
    await app.closeSheets();
    await page.reload();
    const sheet = page.getByRole('dialog', { name: 'Morning Summary' });
    await expect(sheet.getByText(/Your newest transaction is from Sep \d+/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible();
  });
});

test('the sun button on Today opens it any time, greeting you by the name in Settings', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();
  // Noon isn't the morning: it doesn't open by itself.
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);

  await app.tab('Settings');
  await app.field('Your Name').locator('input').fill('Sam');
  await app.field('Your Name').locator('input').blur();
  await app.closeSheets();
  await app.tab('Today');
  await page.getByRole('button', { name: 'Morning summary' }).click();
  await expect(app.sheet().getByRole('heading', { name: /Good afternoon, Sam,\s*it’s Tuesday, Sep 29/ })).toBeVisible();
  await expect(app.sheet().locator('.m-hero .m-tag')).toHaveText('Your day');
  await app.sheet().getByRole('button', { name: 'Go to Today' }).click();
  await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
});
