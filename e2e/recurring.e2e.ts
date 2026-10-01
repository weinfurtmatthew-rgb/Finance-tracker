import { expect, test } from './helpers';

test('finds subscriptions and bills, and tracks them @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Recurring');
  await page.getByText(/Found \d+ possible recurring/).click();
  await expect(page.getByRole('heading', { name: 'Possible Recurring' })).toBeVisible();
  await expect(page.locator('.suggestion', { hasText: 'Netflix' })).toBeVisible();
  await page.getByRole('button', { name: 'Add All' }).click();
  await expect(page.locator('.cards .card').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await expect(page.locator('.calendar')).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await app.txnRows('Netflix').first().click();
  await page.getByRole('button', { name: 'Mark as Cancelled' }).click();
  await page.getByRole('button', { name: 'Mark as Cancelled' }).last().click();
  await expect(page.getByText('Marked as cancelled')).toBeVisible();
});

test('a free trial shows a reminder before it turns paid', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await app.tab('Recurring');
  await page.getByRole('button', { name: 'Track a Free Trial' }).click();
  await page.getByPlaceholder('e.g. Netflix').fill('Max');
  await page.locator('.sheet input[inputmode=decimal]').first().fill('16.99');
  await page.locator('.sheet input[type=date]').fill('2026-09-30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.callout strong', { hasText: 'Max' }).first()).toBeVisible();
});
