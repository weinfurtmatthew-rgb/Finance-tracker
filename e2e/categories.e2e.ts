import { expect, test } from './helpers';

test('create a category right from the picker', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Target').first().click();
  await app.field('Category').locator('select').selectOption({ label: '＋ New Category…' });
  await expect(page.getByRole('heading', { name: 'New Category' })).toBeVisible();
  await app.field('Name').locator('input').fill('Household');
  await app.sheet().getByRole('button', { name: '🧹' }).click();
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  // Back in the transaction, the new category is selected.
  await expect(app.field('Category').locator('select')).toHaveValue(/.+/);
  await expect(app.field('Category').locator('select option:checked')).toHaveText(/Household/);
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.txnRows('Target').first()).toContainText('Household');
});

test('new built-ins are used at import, and merging moves everything', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows('Starbucks').first()).toContainText('Coffee');
  await app.tab('Settings');
  await page.locator('.row', { hasText: 'Categories' }).first().click();
  await app.sheet().locator('.row', { hasText: 'Coffee' }).click();
  await app.field('Merge into').locator('select').selectOption('dining');
  await app.sheet().getByRole('button', { name: 'Merge', exact: true }).click();
  await page.getByRole('button', { name: 'Merge', exact: true }).last().click();
  await expect(page.getByText('Merged into Dining')).toBeVisible();
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows('Starbucks').first()).toContainText('Dining');
});

test('hidden categories leave the pickers', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await app.tab('Settings');
  await page.locator('.row', { hasText: 'Categories' }).first().click();
  await app.sheet().locator('.row', { hasText: 'Kids' }).click();
  await app.sheet().locator('.toggle-row', { hasText: 'Hide from pickers' }).locator('input').check();
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.sheet().locator('.row', { hasText: 'Kids' })).toContainText('Hidden');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows().first().click();
  await expect(app.field('Category').locator('select option', { hasText: 'Kids' })).toHaveCount(0);
});
