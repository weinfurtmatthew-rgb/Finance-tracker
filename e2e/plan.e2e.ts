import { expect, test } from './helpers';

const CALCULATORS = [
  'Emergency fund',
  'Can I afford it?',
  'Debt payoff',
  'True cost of a habit',
  'Savings growth',
  'Investment growth',
  'Financial independence',
  'Will my money last?',
];

test('every calculator opens with your numbers filled in @smoke', async ({ app, page }) => {
  await app.importAll();
  await page.getByRole('button', { name: 'Plan: financial calculators' }).click();
  await expect(app.sheet()).toContainText('Your numbers');
  for (const name of CALCULATORS) {
    await app.sheet().locator('.row', { hasText: name }).click();
    if (name === 'Can I afford it?') await app.field('Price').locator('input').fill('3000');
    await expect(app.sheet().locator('.hero-card').first()).toBeVisible();
    await expect(app.sheet().locator('.hero-card').first()).not.toContainText('NaN');
    await app.sheet().getByRole('button', { name: 'Done', exact: true }).click();
  }
});

test('debt payoff compares avalanche and snowball', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await page.getByRole('button', { name: 'Plan: financial calculators' }).click();
  await app.sheet().locator('.row', { hasText: 'Debt payoff' }).click();
  // Make the card the bigger, pricier debt so the two strategies pick different orders.
  const card = app.sheet().locator('.section', { hasText: /Discover/ });
  await card.locator('.field', { hasText: 'Balance' }).locator('input').fill('1500');
  await card.locator('.field', { hasText: 'APR' }).locator('input').fill('24.99');
  await app.sheet().getByRole('button', { name: 'Add a Debt' }).click();
  const debt = app.sheet().locator('.section').filter({ has: page.getByPlaceholder('e.g. Car loan') });
  await debt.getByPlaceholder('e.g. Car loan').fill('Car loan');
  await debt.locator('.field', { hasText: 'Balance' }).locator('input').fill('400');
  await debt.locator('.field', { hasText: 'APR' }).locator('input').fill('6.5');
  await debt.locator('.field', { hasText: 'Minimum' }).locator('input').fill('50');
  // With nothing extra both orders behave the same (the app then shows one plan), so add some.
  await app.field('Extra').locator('input').fill('100');
  await expect(app.sheet().locator('.kpis')).toContainText('Avalanche');
  await expect(app.sheet().locator('.kpis')).toContainText('Snowball');
  await expect(app.sheet().getByText('Payoff order')).toBeVisible();
});

test('can I afford it gives a verdict for a financed purchase', async ({ app, page }) => {
  await app.importAll();
  await page.getByRole('button', { name: 'Plan: financial calculators' }).click();
  await app.sheet().locator('.row', { hasText: 'Can I afford it?' }).click();
  await app.sheet().getByRole('tab', { name: 'Finance it' }).click();
  await app.field('Price').locator('input').fill('25000');
  await app.field('Down payment').locator('input').fill('2000');
  await expect(app.sheet().locator('.status-badge')).toBeVisible();
  await expect(app.sheet().locator('.kpis')).toContainText('Payment');
});
