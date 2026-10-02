import { expect, test } from './helpers';

/** The payee column in Activity for rows matching `text` and an amount. */
const rowsWith = (app: import('./helpers').App, text: string, amount: string) => app.txnRows(text).filter({ hasText: amount });

test('bank first, then Venmo: bank-paid payments merge, paybacks settle @smoke', async ({ app, page }) => {
  await app.importFile('bank-venmo.csv', { type: 'checking' });
  await app.closeSheets();
  // Casey owes you for the electric bill.
  await app.tab('Activity');
  await app.txnRows('Eversource').first().click();
  await app.sheet().locator('.toggle-row', { hasText: 'Paid for someone else' }).locator('input').check();
  await app.field('Who owes you').locator('input').fill('Casey');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();

  await app.tab('Today');
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(await import('./helpers').then((h) => h.fixture('venmo.csv')));
  await expect(app.sheet().getByText('Venmo statement')).toBeVisible();
  await expect(app.field('Name').locator('input')).toHaveValue('Venmo');
  await expect(app.field('Type').locator('select')).toHaveValue('wallet');
  await expect(app.sheet().getByText(/Set balance to \$70\.50/)).toBeVisible();
  await page.getByRole('button', { name: /^Import \d+/ }).click();
  await expect(page.getByText(/Imported 5 transactions/)).toBeVisible();
  await expect(app.sheet()).toContainText('1 payment paid from your bank was matched');
  // Casey's Venmo request paid you back for the electric bill.
  await expect(app.sheet().locator('.payback-row')).toContainText('Casey Park paid you back $62.50?');
  await app.sheet().locator('.payback-row').getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Casey is paid up')).toBeVisible();
  await expect(app.sheet().locator('.payback-row')).toHaveCount(0);
  await app.closeSheets();

  await app.tab('Activity');
  // One $24 pizza payment to Alex (the bank's line, now with Alex's name), not two.
  await expect(rowsWith(app, 'Alex Smith', '24.00')).toHaveCount(1);
  await expect(app.txnRows('VENMO PAYMENT')).toHaveCount(0);
  await expect(rowsWith(app, 'Alex Smith', '24.00')).toContainText('Dining');

  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Venmo' })).toContainText('$70.50');

  // Importing the same statement again adds nothing.
  await app.tab('Today');
  await page.getByRole('button', { name: /Import a Bank File|Import a file/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(await import('./helpers').then((h) => h.fixture('venmo.csv')));
  await expect(app.sheet().getByText(/6 already imported/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
});

test('Venmo first, then the bank: the waiting payment merges into the bank line', async ({ app, page }) => {
  const summary = await app.importFile('venmo.csv');
  expect(summary).toContain('1 payment paid from your bank will be matched when you import');
  await app.closeSheets();
  const bank = await app.importFile('bank-venmo.csv', { type: 'checking', newAccountName: 'Citizens Checking' });
  expect(bank).toContain('1 payment paid from your bank was matched');
  await app.closeSheets();
  await app.tab('Activity');
  await expect(rowsWith(app, 'Alex Smith', '24.00')).toHaveCount(1);
  await expect(app.txnRows('From CITIZENS BANK')).toHaveCount(0);
  // Venmo's transfer to the bank is a transfer on both sides.
  await expect(app.txnRows('VENMO CASHOUT').first()).toContainText('Transfer');
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Venmo' })).toContainText('$70.50');
});

test('Cash App: what was this, people, log an Apple Cash payment, ask', async ({ app, page }) => {
  await app.importFile('cashapp.csv');
  await app.closeSheets();
  await app.tab('Today');
  const callout = page.locator('.callout', { hasText: 'What was this payment?' });
  await callout.click();
  const row = app.sheet().locator('.what-row', { hasText: 'Jamie Fox' });
  await expect(row).toContainText('“gas money”');
  await row.getByLabel('Category for Jamie Fox').selectOption('gas');
  await expect(page.getByText('Filed under Gas')).toBeVisible();
  await expect(app.sheet().getByText('All explained')).toBeVisible();
  await app.closeSheets();
  await expect(callout).toHaveCount(0);

  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: /^People/ }).click();
  await expect(app.sheet().locator('.row', { hasText: 'Morgan Diaz' })).toContainText('sent $40');
  await app.sheet().getByRole('button', { name: '＋ Log a Payment' }).click();
  await app.field(/^App/).locator('select').selectOption('applecash');
  await app.sheet().getByLabel('Amount').fill('15');
  await app.field(/^To/).locator('input').fill('Riley Chen');
  await app.field(/^Note/).locator('input').fill('🌮 tacos');
  await expect(app.field('Category').locator('select')).toHaveValue('dining');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Payment saved')).toBeVisible();
  await app.sheet().locator('.row', { hasText: 'Riley Chen' }).click();
  await expect(app.sheet()).toContainText('🌮 tacos');
  await expect(app.sheet()).toContainText('Apple Cash');
  await app.closeSheets();

  await app.tab('Today');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByLabel('Search or ask').fill('how much have I sent Morgan');
  await page.getByLabel('Search or ask').press('Enter');
  await expect(page.locator('.answer-card').getByText('You sent Morgan Diaz $40.00 and received $0.00 overall.')).toBeVisible();
});

test('a bank line from Apple Cash asks who it was for', async ({ app, page }) => {
  await app.importFile('bank-venmo.csv', { type: 'checking' });
  await app.closeSheets();
  const callout = page.locator('.callout', { hasText: /What were these|What was this/ });
  await callout.click();
  await expect(app.sheet().locator('.what-row', { hasText: 'Apple Cash' })).toBeVisible();
  // The bank-funded Venmo payment asks too, until the Venmo statement explains it.
  await expect(app.sheet().locator('.what-row')).toHaveCount(2);
});
