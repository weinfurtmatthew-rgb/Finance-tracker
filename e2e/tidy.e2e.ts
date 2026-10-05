import { expect, test } from './helpers';

test.use({ withAi: true });

test('old guessed categories can be tidied up in one review @smoke', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.importFile('card2.csv');
  await app.closeSheets();
  const callout = await app.todo('Tidy up');
  await expect(callout).toBeVisible();
  await callout.click();
  const row = app.sheet().locator('.suggest-row', { hasText: 'Green Leaf Market' });
  await expect(row).toContainText('now Other');
  await row.locator('select').selectOption('groceries');
  await app.sheet().getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText(/Updated \d+ payee/)).toBeVisible();
  await expect(callout).toHaveCount(0);
  await app.tab('Activity');
  await expect(app.txnRows('Green Leaf Market').filter({ hasText: 'Groceries' })).toHaveCount(2);
  // Still reachable later from Settings.
  await app.tab('Settings');
  await expect(page.locator('.row', { hasText: 'Tidy Up Old Categories' })).toBeVisible();
});
