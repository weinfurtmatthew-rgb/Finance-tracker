import { expect, test } from './helpers';

test('budgets are suggested, and over-budget categories are flagged @smoke', async ({ app, page }) => {
  await app.importAll();
  await (await app.todo('Set up monthly budgets')).click();
  await expect(page.getByRole('heading', { name: 'Monthly Budgets', exact: true })).toBeVisible();
  const dining = app.field('Dining').locator('input');
  await expect(dining).not.toHaveValue('');
  await dining.fill('40');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Today measures the month against the budgets…
  await expect(page.locator('.left-tile')).toContainText(/Left to spend|Over by/);
  await expect(page.locator('.left-tile')).toContainText('budget');
  // …and Browse → Spending has the details.
  await app.tab('Spending');
  await expect(page.locator('.hero-card').first()).toContainText(/Left to spend|Over budget/);
  await expect(page.locator('.callout.warn').first()).toContainText('Dining');
});

test('tapping a month in the chart switches the dashboard', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Spending');
  await expect(page.locator('.month-switch strong')).toHaveText('September 2026');
  await page.locator('.chart-svg .col').nth(9).click();
  await expect(page.locator('.month-switch strong')).toHaveText('July 2026');
  await page.locator('.ranked-row').first().click();
  await expect(app.sheet()).toBeVisible();
});

test('the passcode lock keeps the app closed until the right code', async ({ app, page }) => {
  await app.tab('Settings');
  await page.getByText('Turn Passcode On').click();
  for (let pass = 0; pass < 2; pass++) for (const d of '123456') await page.locator('.sheet .key', { hasText: new RegExp(`^${d}$`) }).click();
  await expect(page.getByText('Passcode set')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Enter Passcode')).toBeVisible();
  for (const d of '000000') await page.keyboard.press(d);
  await expect(page.getByText('Wrong passcode')).toBeVisible();
  for (const d of '123456') await page.keyboard.press(d);
  await expect(page.locator('.tabbar')).toBeVisible();
});
