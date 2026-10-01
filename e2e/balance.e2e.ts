import { expect, fixture, test } from './helpers';

test('after a CSV import, the balance check sets the starting balance @smoke', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await expect(app.sheet().getByText('Check your balance')).toBeVisible();
  await app.field('Bank shows').locator('input').fill('5,000.00');
  await app.sheet().getByRole('button', { name: 'Check', exact: true }).click();
  await expect(app.sheet().locator('.balance-result')).toContainText('Starting balance');
  await app.sheet().getByRole('button', { name: 'Match my bank' }).click();
  await app.closeSheets();
  await app.tab('Net Worth');
  const row = page.locator('button.row', { hasText: 'Checking' }).first();
  await expect(row).toContainText('$5,000.00');
  await expect(row).toContainText('✓ Sep 29');
});

test('a purchase entered twice is found, and removing it makes the balance match', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.field('Bank shows').locator('input').fill('5000');
  await app.sheet().getByRole('button', { name: 'Check', exact: true }).click();
  await app.sheet().getByRole('button', { name: 'Match my bank' }).click();
  await app.closeSheets();
  // The same electric bill, typed in by hand.
  await app.tab('Activity');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Amount').fill('78.88');
  await page.getByPlaceholder('Who was it?').fill('Eversource Energy Payment');
  await page.locator('.sheet input[type=date]').fill('2026-04-12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await app.tab('Net Worth');
  await page.locator('button.row', { hasText: 'Checking' }).first().click();
  await app.sheet().getByRole('button', { name: 'Edit', exact: true }).click();
  await app.sheet().getByRole('button', { name: /Check balance against my bank/ }).click();
  await app.field('Bank shows').locator('input').fill('5000');
  await app.sheet().getByRole('button', { name: 'Check', exact: true }).click();
  const result = app.sheet().locator('.balance-result');
  await expect(result).toContainText('Off by $78.88');
  await expect(result).toContainText('removing them makes it match exactly');
  await app.sheet().getByRole('button', { name: 'Remove the duplicate' }).click();
  await expect(app.sheet().getByText('✓ Matches your bank')).toBeVisible();
});

test('OFX files count as checked', async ({ app, page }) => {
  await page.getByRole('button', { name: /Import a Bank File/ }).click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens.qfx'));
  await page.getByRole('button', { name: /^Import 3/ }).click();
  await expect(app.sheet().getByText("✓ Balance set from your bank's file.")).toBeVisible();
});
