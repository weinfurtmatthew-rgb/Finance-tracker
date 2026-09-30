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
  // It's the first thing on Overview: copies throw off every number below it.
  const cardTop = (await callout.boundingBox())!.y;
  expect(cardTop).toBeLessThan((await page.locator('.month-switch').boundingBox())!.y);
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

test('a Rocket Money export imported the old way is repaired, then the Citizens QFX adds nothing twice', async ({ app, page }) => {
  // Before: the whole Rocket Money file went into one account as a plain CSV (spending as income).
  await app.importFile('rocketmoney-plain.csv', { type: 'checking', newAccountName: 'Citizens Checking' });
  await app.closeSheets();
  // ...and the Citizens QFX matched none of it.
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('citizens-sept.qfx'));
  await app.field('Account').locator('select').selectOption({ label: 'Citizens Checking' });
  await page.getByRole('button', { name: 'Import 9', exact: true }).click();
  await expect(page.getByText('Imported 9 transactions')).toBeVisible();
  await app.closeSheets();

  // Now: the real Rocket Money file is recognized and offers the repair.
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('rocketmoney.csv'));
  await expect(app.sheet().getByText('Rocket Money', { exact: true })).toBeVisible();
  const repair = app.sheet().locator('.section', { hasText: 'Fix your earlier Rocket Money import' });
  await expect(repair).toContainText('11 transactions to fix');
  await expect(repair).toContainText('3 to move');
  await expect(repair).toContainText('8 already in your bank');
  await expect(repair.getByLabel('Account for Discover · Discover it ••1234')).toHaveValue('__new__');
  await repair.getByRole('button', { name: 'Fix Earlier Import' }).click();
  await expect(page.getByText(/Fixed 11 transactions · 8 merged/)).toBeVisible();
  await expect(repair).toHaveCount(0);
  // Nothing left to add from either account in the file.
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
  await app.field('From').locator('select').selectOption({ label: 'Discover · Discover it ••1234 (3)' });
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
  await app.closeSheets();

  await app.tab('Activity');
  await expect(app.txnRows('Blue Bottle')).toHaveCount(2);
  await expect(app.txnRows(/Shaw/)).toHaveCount(2);
  await expect(app.txnRows('Target')).toHaveCount(1);
  await expect(app.txnRows('Target')).toContainText('-$43.10');
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Citizens Checking' })).toContainText('$1,445.87');
  await expect(page.locator('button.row', { hasText: 'Discover it' })).toBeVisible();
});

test('a fresh Rocket Money export imports each account separately', async ({ app, page }) => {
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('rocketmoney.csv'));
  await expect(app.field('From').locator('select').locator('option:checked')).toContainText('Citizens Checking ••6789 (8)');
  await expect(app.field('Name').locator('input')).toHaveValue('Citizens Checking');
  await page.getByRole('button', { name: 'Import 8', exact: true }).click();
  await expect(page.getByText('Imported 8 transactions')).toBeVisible();
  await page.getByRole('button', { name: 'Import Next: Discover it' }).click();
  await expect(app.field('Type').locator('select')).toHaveValue('credit');
  await page.getByRole('button', { name: 'Import 3', exact: true }).click();
  await expect(page.getByText('Imported 3 transactions')).toBeVisible();
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows("Shaw's")).toHaveCount(2);
  await expect(app.txnRows("Shaw's").first()).toContainText('Groceries');
  await expect(app.txnRows('Acme Corp')).toContainText('+$2,400.00');
});
