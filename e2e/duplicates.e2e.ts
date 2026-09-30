import { expect, fixture, test } from './helpers';

test('a Citizens CSV, then the same month as a QFX statement: nothing doubles @smoke', async ({ app, page }) => {
  await app.importFile('citizens-sept.csv', { type: 'checking', newAccountName: 'Citizens Checking' });
  await app.closeSheets();

  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens-sept.qfx'));
  await expect(page.getByText('Review Import')).toBeVisible();
  // It finds the account the CSV went into, though the CSV had no account number.
  await expect(app.field('Account').locator('select')).toHaveValue(/.+/);
  await expect(app.field('Account').locator('select').locator('option:checked')).toHaveText('Citizens Checking');
  await expect(app.sheet().getByText('8 transactions matched ones you already have')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1', exact: true }).click();
  await expect(page.getByText('Imported 1 transaction')).toBeVisible();
  await app.closeSheets();

  await app.tab('Activity');
  await expect(app.txnRows('Blue Bottle')).toHaveCount(2);
  await expect(app.txnRows('Shaws')).toHaveCount(2);
  await expect(app.txnRows("Trader Joe's")).toHaveCount(1);
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Citizens Checking' })).toContainText('$1,445.87');
  // Importing either file again adds nothing.
  await app.tab('Overview');
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens-sept.csv'));
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
});

test('copies from before the fix are found and removed, keeping the bank balance', async ({ app, page }) => {
  await app.importFile('citizens-sept.csv', { type: 'checking', newAccountName: 'Citizens Checking' });
  await app.closeSheets();
  // Reproduce the old behavior: import the QFX with the matches included.
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens-sept.qfx'));
  await app.sheet().locator('.toggle-row', { hasText: 'Import these anyway' }).locator('input').check();
  await page.getByRole('button', { name: 'Import 9', exact: true }).click();
  await expect(page.getByText('Imported 9 transactions')).toBeVisible();
  await app.closeSheets();

  // Categorize one of the copies yourself: the change is kept on the transaction that stays.
  await app.tab('Activity');
  await expect(app.txnRows('Eversource')).toHaveCount(2);
  await app.txnRows('Eversource').first().click();
  await app.field('Category').locator('select').selectOption('bills');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();

  await app.tab('Overview');
  const callout = page.locator('.callout', { hasText: 'imported twice' });
  await expect(callout).toContainText('8 transactions were imported twice');
  await callout.click();
  await app.sheet().getByRole('button', { name: 'Remove 8 Duplicates' }).click();
  await expect(page.getByText('Removed 8 duplicates')).toBeVisible();
  await expect(callout).toHaveCount(0);

  await app.tab('Activity');
  await expect(app.txnRows('Blue Bottle')).toHaveCount(2);
  await expect(app.txnRows('Eversource')).toHaveCount(1);
  await expect(app.txnRows('Eversource')).toContainText('Bills');
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Citizens Checking' })).toContainText('$1,445.87');
});
