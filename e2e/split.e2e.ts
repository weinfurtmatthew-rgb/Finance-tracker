import { expect, test } from './helpers';

test('split a purchase into two categories @smoke', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Target').first().click();
  await app.sheet().getByRole('button', { name: 'Split into parts…' }).click();
  await app.sheet().getByLabel('Part 1 amount').fill('10');
  await app.sheet().getByLabel('Part 1 category').selectOption('groceries');
  await app.sheet().getByLabel('Part 2 category').selectOption('shopping');
  await expect(app.sheet().getByText(/left to assign/)).toBeVisible();
  await expect(app.sheet().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await app.sheet().getByRole('button', { name: 'Put the rest here' }).nth(1).click();
  await expect(app.sheet().getByText(/Parts add up to/)).toBeVisible();
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.txnRows('Target').first()).toContainText('Split · 2 parts');
  // Filtering by Groceries finds the split purchase.
  await page.getByLabel('Filter by category').selectOption('groceries');
  await expect(app.txnRows('Target').first()).toBeVisible();
});

test('paid for someone else, then paid back @smoke', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Chipotle').first().click();
  await app.sheet().locator('.toggle-row', { hasText: 'Paid for someone else' }).locator('input').check();
  await app.field('Who owes you').locator('input').fill('Alex');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.txnRows('Chipotle').first()).toContainText('Owed by Alex');
  await app.tab('Overview');
  const callout = page.locator('.callout', { hasText: 'owed to you' });
  await expect(callout).toContainText('Alex');
  await callout.click();
  await app.sheet().locator('.row', { hasText: 'Chipotle' }).click();
  await app.sheet().getByRole('button', { name: 'Paid in cash, or not in the app' }).click();
  await expect(page.getByText('Marked as paid back')).toBeVisible();
  await app.closeSheets();
  await expect(callout).toHaveCount(0);
});

test('tag transactions for a trip', async ({ app }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Shell').first().click();
  const tag = app.sheet().getByLabel('Add a tag');
  await tag.fill('Italy 2026');
  await tag.press('Enter');
  await expect(app.sheet().locator('.tag-chip')).toContainText('#Italy 2026');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.txnRows('Shell').first()).toContainText('#Italy 2026');
});

test('part of a split paid for someone, settled by a real deposit', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  // An older charge, so a paycheck arrived after it.
  await app.txnRows('Chipotle').last().click();
  await app.sheet().getByRole('button', { name: 'Split into parts…' }).click();
  await app.sheet().getByLabel('Part 1 amount').fill('5');
  await app.sheet().getByLabel('Part 1 category').selectOption('dining');
  await app.sheet().getByRole('button', { name: 'Put the rest here' }).nth(1).click();
  await app.sheet().locator('.split-part').nth(1).locator('.toggle-row input').check();
  await app.sheet().getByLabel('Part 2 owed by').fill('Sam');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await app.tab('Overview');
  await page.locator('.callout', { hasText: 'owed to you' }).click();
  await app.sheet().getByRole('button', { name: 'Paid all back' }).click();
  // Pick the first incoming payment offered.
  await app.sheet().locator('.section', { hasText: 'Money that came in' }).locator('button.row').first().click();
  await expect(page.getByText('Marked as paid back')).toBeVisible();
  await app.closeSheets();
  await expect(page.locator('.callout', { hasText: 'owed to you' })).toHaveCount(0);
  await app.tab('Activity');
  await expect(app.txnRows().filter({ hasText: 'Owed to Me' }).first()).toBeVisible();
});
