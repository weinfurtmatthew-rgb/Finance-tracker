import { expect, fixture, test, type App } from './helpers';

const FILE = 'fidelity-periodic.csv';

/** A new investment account. */
async function addAccount(app: App, name: string, last4?: string) {
  await app.tab('Net Worth');
  await app.page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill(name);
  await app.field('Type').locator('select').selectOption('brokerage');
  if (last4) await app.field('Last 4 digits').locator('input').fill(last4);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();
}

/** An account's page, from Net Worth. */
async function openAccount(app: App, name: string) {
  await app.tab('Net Worth');
  await app.page.locator('button.row', { hasText: name }).first().click();
  await expect(app.page.getByRole('dialog', { name })).toBeVisible();
}

async function importPeriodic(app: App, rows = 10) {
  await app.openImport();
  await app.page.locator('.drop input[type=file]').setInputFiles(fixture(FILE));
  await expect(app.field('Account').locator('select option:checked')).toHaveText('Fidelity Brokerage');
  // Each purchase says what it bought, where the bank's line was cut off before the fund.
  await expect(app.sheet().locator('.txn-row', { hasText: 'Bought FXAIX' })).toHaveCount(4);
  await app.page.getByRole('button', { name: `Import ${rows}`, exact: true }).click();
  await expect(app.page.getByText(`Imported ${rows} transactions`)).toBeVisible();
}

const section = (app: App, title: RegExp) =>
  app
    .sheet()
    .locator('.section')
    .filter({ has: app.page.locator('.section-title', { hasText: title }) });

test('a periodic investment goes into the holdings with each import @smoke', async ({ app, page }) => {
  await addAccount(app, 'Fidelity Brokerage', '5678');
  await openAccount(app, 'Fidelity Brokerage');
  // What it held on Sep 10, from a positions file.
  await app.sheet().getByLabel('Import positions from your brokerage').setInputFiles(fixture('fidelity-positions.csv'));
  await app.field('As of').locator('input').fill('2026-09-10');
  await app.sheet().getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.toast')).toHaveText('Imported 3 positions');
  const holdings = section(app, /^Holdings/);
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('25.123 shares');
  await app.closeSheets();

  // $100 of FXAIX each week since, the shares from the file.
  await importPeriodic(app);
  // The purchase before the positions file's day is counted in it already.
  await expect(app.sheet()).toContainText('3 purchases of FXAIX also went into Fidelity Brokerage’s holdings.');
  await app.closeSheets();
  await openAccount(app, 'Fidelity Brokerage');
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('26.674 shares');
  await expect(section(app, /^From your bank files$/)).toHaveCount(0);
  await app.closeSheets();

  // Each line says how it stands.
  await app.tab('Activity');
  const line = section(app, /^Holdings$/);
  await app.txnRows('Bought FXAIX').first().click();
  await expect(line).toContainText('Bought FXAIX · 0.512 shares');
  await expect(line).toContainText('In this account’s holdings');
  await app.closeSheets();
  await app.txnRows('Bought FXAIX').last().click();
  await expect(line).toContainText('Counted in the positions you imported for Sep 10');
  await app.closeSheets();

  // The same file again: nothing new, and nothing in the holdings twice.
  await app.openImport();
  await page.locator('.drop input[type=file]').setInputFiles(fixture(FILE));
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
});

test('purchases imported before the account had holdings go in from its page', async ({ app, page }) => {
  await addAccount(app, 'Fidelity Brokerage', '5678');
  await importPeriodic(app);
  // Without holdings yet, its value would become just these: they wait for you.
  await expect(app.sheet()).toContainText('4 purchases of FXAIX can go into Fidelity Brokerage’s holdings: open the account in Net Worth to add them.');
  await app.closeSheets();

  await openAccount(app, 'Fidelity Brokerage');
  const fromBank = section(app, /^From your bank files$/);
  await expect(fromBank.locator('.row').first()).toContainText('4 purchases of FXAIX');
  await expect(fromBank.locator('.row').first()).toContainText('Sep 8 – Sep 28 · not in its holdings yet');
  await expect(fromBank.locator('.row').first()).toContainText('$400');
  await expect(fromBank).toContainText('if it holds more than these, import a positions file first');
  await fromBank.getByRole('button', { name: 'Add All 4 to Holdings' }).click();
  await expect(page.locator('.toast')).toHaveText('4 purchases of FXAIX added');
  const holdings = section(app, /^Holdings/);
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('2.076 shares');
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('FIDELITY 500 INDEX FUND');
  await expect(fromBank).toHaveCount(0);

  // A purchase taken out of the holdings stays out, until you put it back from its line.
  await holdings.locator('.holding-row', { hasText: 'FXAIX' }).click();
  await app.sheet().locator('.row', { hasText: 'Sep 28' }).click();
  await app.sheet().getByRole('button', { name: 'Delete Trade' }).click();
  await page.getByRole('button', { name: 'Delete Trade' }).last().click();
  await expect(page.locator('.toast')).toHaveText('Trade deleted');
  await app.closeSheets();
  await openAccount(app, 'Fidelity Brokerage');
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('1.564 shares');
  await expect(fromBank).toHaveCount(0);
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Bought FXAIX').first().click();
  const line = section(app, /^Holdings$/);
  await expect(line).toContainText('Kept out of this account’s holdings');
  await line.getByRole('button', { name: 'Add to Holdings' }).click();
  await expect(page.locator('.toast')).toHaveText('FXAIX added to holdings');
  await expect(line).toContainText('In this account’s holdings');
});

test('a purchase that doesn’t say its stock: picked once, the same for lines like it', async ({ app, page }) => {
  await addAccount(app, 'Schwab Brokerage');
  const csv = [
    'Date,Description,Amount',
    '09/15/2026,AUTOMATIC INVESTMENT 09/15 REF 4471,-50.00',
    '09/22/2026,AUTOMATIC INVESTMENT 09/22 REF 4519,-50.00',
  ].join('\n');
  await app.openImport();
  await page.locator('.drop input[type=file]').setInputFiles({ name: 'activity.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await app.field('Account').locator('select').selectOption({ label: 'Schwab Brokerage' });
  await page.getByRole('button', { name: 'Import 2', exact: true }).click();
  await expect(app.sheet()).toContainText('2 purchases can go into Schwab Brokerage’s holdings');
  await app.closeSheets();

  await openAccount(app, 'Schwab Brokerage');
  const fromBank = section(app, /^From your bank files$/);
  await expect(fromBank.locator('.row', { hasText: 'Automatic Investment' })).toContainText('2 purchases · doesn’t say which stock');
  await fromBank.locator('.row', { hasText: 'Automatic Investment' }).click();
  await expect(app.sheet().getByRole('heading', { name: 'Add Purchase' })).toBeVisible();
  await expect(section(app, /^From your bank file$/)).toContainText('AUTOMATIC INVESTMENT 09/15 REF 4471');
  await expect(app.field('Amount').locator('input')).toHaveValue('50.00');
  await app.field('Ticker').locator('input').fill('SCHB');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('SCHB added');
  // The other one is SCHB too now.
  await expect(fromBank.locator('.row').first()).toContainText('A purchase of SCHB');
  await fromBank.getByRole('button', { name: 'Add It to Holdings' }).click();
  await expect(section(app, /^Holdings/).locator('.holding-row', { hasText: 'SCHB' })).toContainText('valued at what you put in');
  await expect(section(app, /^Holdings/).locator('.holding-row', { hasText: 'SCHB' })).toContainText('$100');
  await expect(fromBank).toHaveCount(0);
});
