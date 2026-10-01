import { expect, fixture, test } from './helpers';

test('imports checking, card and savings files @smoke', async ({ app, page }) => {
  expect(await app.importFile('checking.csv', { type: 'checking' })).toContain('Imported 31 transactions');
  await app.closeSheets();
  expect(await app.importFile('discover.csv')).toContain('Imported 75 transactions');
  await app.closeSheets();
  await app.tab('Activity');
  // Paying the card from checking is a card payment on both sides, not spending or income.
  await expect(app.txnRows('Discover E-Payment').first()).toContainText('Credit Card Payment');
  await expect(app.txnRows('Internet Payment').first()).toContainText('Credit Card Payment');
  await expect(app.txnRows('Netflix').first()).toContainText('Subscriptions');
  await app.tab('Today');
  await expect(page.locator('.kpi').first()).toContainText('Spent');
});

test('re-importing the same file skips every duplicate', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await page.getByRole('button', { name: 'Import a file' }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('checking.csv'));
  await expect(page.getByText('Preview · 0 new')).toBeVisible();
});

test('an OFX/QFX file sets the balance too', async ({ app, page }) => {
  await page.getByRole('button', { name: /Import a Bank File/ }).click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens.qfx'));
  await expect(page.getByText(/Set balance to \$5,321.40/)).toBeVisible();
  await page.getByRole('button', { name: /^Import 3/ }).click();
  await expect(page.getByText(/Imported 3 transactions/)).toBeVisible();
  await app.closeSheets();
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Citizens' })).toContainText('$5,321.40');
});

test('fixing a category updates the same payee and teaches future imports', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.importFile('card2.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows('Green Leaf Market')).toHaveCount(2);
  await app.txnRows('Green Leaf Market').first().click();
  await app.field('Category').locator('select').selectOption('groceries');
  await expect(page.getByText('Also change 1 other Green Leaf Market transaction')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · 1 more updated')).toBeVisible();
  await expect(app.txnRows('Green Leaf Market').filter({ hasText: 'Groceries' })).toHaveCount(2);
  // The next file from the same store (including a refund) follows your choice.
  await app.tab('Today');
  await app.importFile('card3.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows('Green Leaf Market').filter({ hasText: 'Groceries' })).toHaveCount(4);
  // Unknown money coming back on a card isn't income.
  await expect(app.txnRows('Mystery LLC')).not.toContainText('Income');
});

test('adding a transaction by hand', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await app.tab('Activity');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Amount').fill('12.34');
  await page.getByPlaceholder('Who was it?').fill('Farmers Market');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Transaction added')).toBeVisible();
  await expect(app.txnRows('Farmers Market')).toContainText('-$12.34');
});
