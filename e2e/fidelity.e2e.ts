import { readFileSync } from 'node:fs';
import { expect, fixture, test, type App } from './helpers';

const FILE = 'fidelity-activity.csv';

/** An account to import into, with the last 4 digits of its account number. */
async function addAccount(app: App, name: string, type: string, last4?: string) {
  await app.tab('Net Worth');
  await app.page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill(name);
  await app.field('Type').locator('select').selectOption(type);
  if (last4) await app.field('Last 4 digits').locator('input').fill(last4);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();
}

async function chooseFile(app: App, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await app.openImport();
  await app.page.locator('.drop input[type=file]').setInputFiles(typeof file === 'string' ? fixture(file) : file);
  await expect(app.page.getByText('Review Import')).toBeVisible();
}

test('a Fidelity file with every account goes into the right ones, and next time the same places @smoke', async ({ app, page }) => {
  await addAccount(app, 'Fidelity Brokerage', 'brokerage', '5678');
  await chooseFile(app, FILE);
  await expect(app.sheet()).toContainText('Fidelity · 3 accounts');
  const routes = app.sheet().locator('.section', { hasText: 'Accounts in this file' });

  // The brokerage account by its last 4 digits; the others, new accounts named and typed from the file.
  const into = (label: string) => routes.getByLabel(`Account for ${label}`, { exact: true });
  await expect(into('Individual - TOD ••5678').locator('option:checked')).toHaveText('Fidelity Brokerage');
  await expect(into('Cash Management (Individual) ••5432')).toHaveValue('__new__');
  const cma = routes.getByRole('group', { name: 'New account for Cash Management (Individual) ••5432' });
  await expect(cma.locator('input')).toHaveValue('Fidelity Cash Management (Individual)');
  await expect(cma.locator('select')).toHaveValue('checking');
  await cma.locator('input').fill('Fidelity Cash Management');
  const roth = routes.getByRole('group', { name: 'New account for Roth IRA ••3456' });
  await expect(roth.locator('select')).toHaveValue('roth-ira');
  await expect(routes).toContainText('4 transactions · 4 new');

  // The Roth IRA's activity isn't wanted here.
  await into('Roth IRA ••3456').selectOption({ label: 'Don’t import' });
  await expect(routes).toContainText('2 transactions, not imported');
  // Each preview row starts with the account it's from.
  await expect(app.sheet().locator('.txn-row', { hasText: /Wholefds/i })).toContainText('••5432 · Sat, Sep 26');
  await page.getByRole('button', { name: 'Import 7', exact: true }).click();
  await expect(page.getByText('Imported 7 transactions')).toBeVisible();
  await expect(app.sheet()).toContainText('Into Fidelity Cash Management (4) and Fidelity Brokerage (3).');
  await app.closeSheets();

  // Each row in its account.
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Fidelity Cash Management' })).toBeVisible();
  await expect(page.locator('button.row', { hasText: 'Roth IRA' })).toHaveCount(0);
  await app.tab('Activity');
  await expect(app.txnRows(/Wholefds/i)).toContainText('Fidelity Cash Management');
  await expect(app.txnRows('Acme Corp')).toContainText('Fidelity Cash Management');
  await expect(app.txnRows('Bought VTI')).toContainText('Fidelity Brokerage');

  // The same file again: every account where it went, and nothing new.
  await chooseFile(app, FILE);
  await expect(into('Cash Management (Individual) ••5432').locator('option:checked')).toHaveText('Fidelity Cash Management');
  await expect(into('Individual - TOD ••5678').locator('option:checked')).toHaveText('Fidelity Brokerage');
  await expect(into('Roth IRA ••3456').locator('option:checked')).toHaveText('Don’t import');
  await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
});

test('a Fidelity file imported before with every account in one is put right', async ({ app, page }) => {
  // Before: the whole file went into one account (the app didn't read the account columns).
  const plain = readFileSync(fixture(FILE), 'utf8')
    .split('\n')
    .map((line) => (/^(Run Date|\d\d\/)/.test(line) ? line.replace(/^(Run Date|[^,]+),("[^"]*"|[^,]*),("[^"]*"|[^,]*),/, '$1,') : line))
    .join('\n');
  await chooseFile(app, { name: 'Accounts_History.csv', mimeType: 'text/csv', buffer: Buffer.from(plain) });
  await app.field('Account').locator('select').selectOption('__new__');
  await app.field('Name').locator('input').fill('Fidelity');
  await page.getByRole('button', { name: 'Import 9', exact: true }).click();
  await expect(page.getByText('Imported 9 transactions')).toBeVisible();
  await app.closeSheets();

  // Now: the brokerage account's rows stay where they are; the others move to new accounts.
  await chooseFile(app, FILE);
  const routes = app.sheet().locator('.section', { hasText: 'Accounts in this file' });
  await routes.getByLabel('Account for Individual - TOD ••5678', { exact: true }).selectOption({ label: 'Fidelity' });
  await expect(routes).toContainText('6 of these transactions were imported before with every account in one');
  await expect(routes).toContainText('4 transactions · 4 to move here');
  await expect(routes).toContainText('3 transactions, all imported already');
  await page.getByRole('button', { name: 'Fix 6', exact: true }).click();
  await expect(page.getByText('Fixed 6 transactions')).toBeVisible();
  // The moved ones aren't counted as skipped.
  await expect(app.sheet()).toContainText('6 moved to their accounts. 3 already-imported transactions were skipped.');
  await app.closeSheets();

  await app.tab('Activity');
  // Each moved, none twice.
  await expect(app.txnRows(/Wholefds/i)).toHaveCount(1);
  await expect(app.txnRows(/Wholefds/i)).toContainText('Fidelity Cash Management (Individual)');
  await expect(app.txnRows('Acme Corp')).toHaveCount(1);
  await expect(app.txnRows('Bought FZROX')).toHaveCount(1);
  await expect(app.txnRows('Bought FZROX')).toContainText('Fidelity Roth IRA');
  await expect(app.txnRows('Bought VTI')).toHaveCount(1);
});

test('a positions file opened in Import says where it goes', async ({ app, page }) => {
  await app.openImport();
  await page.locator('.drop input[type=file]').setInputFiles(fixture('fidelity-positions.csv'));
  await expect(page.getByRole('alert')).toContainText('This is a positions file');
  await expect(page.getByRole('alert')).toContainText('Import Positions');
});
