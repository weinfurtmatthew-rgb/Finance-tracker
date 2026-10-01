import { expect, test } from './helpers';

test('net worth with an investment, a car and a savings goal @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Net Worth');
  for (const [name, type, value] of [['Honda Civic', 'vehicle', '18500'], ['Fidelity Brokerage', 'brokerage', '42000']]) {
    await page.getByRole('button', { name: 'Add account' }).first().click();
    await page.getByPlaceholder('e.g. Discover It').fill(name);
    await app.field('Type').locator('select').selectOption(type);
    await app.field('Value').locator('input').fill(value);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect(page.locator('button.row', { hasText: 'Fidelity Brokerage' })).toContainText('$42,000.00');
  await page.getByRole('button', { name: 'Add a savings goal' }).click();
  await page.getByPlaceholder('e.g. Emergency fund').fill('Emergency fund');
  await app.field('Target').locator('input').fill('5000');
  await app.field('Account').locator('select').selectOption({ label: 'High-Yield Savings' });
  await page.locator('.sheet .toggle-row input').check();
  await page.locator('.sheet input[type=date]').fill('2027-06-30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.goal-row')).toContainText('Emergency fund');
  await app.tab('Today');
  await expect(page.locator('.kpi').nth(2)).toContainText('Net worth');
});

test('a card APR and minimum can be saved on the account', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Net Worth');
  await page.locator('button.row', { hasText: /Discover/ }).first().click();
  await app.field('APR').locator('input').fill('24.99');
  await app.field('Minimum').locator('input').fill('40');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('button.row', { hasText: /Discover/ }).first().click();
  await expect(app.field('APR').locator('input')).toHaveValue('24.99');
});
