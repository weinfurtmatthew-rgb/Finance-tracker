import { expect, test } from './helpers';

const CALCULATORS = [
  'Emergency fund',
  'Can I afford it?',
  'Rent calculator',
  'Mortgage calculator',
  'Debt payoff',
  'True cost of a habit',
  'Savings growth',
  'Investment growth',
  'Retirement savings',
  'Financial independence',
  'Will my money last?',
];

test('every calculator opens with your numbers filled in @smoke', async ({ app }) => {
  await app.importAll();
  await app.openPlan();
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
  await app.openPlan();
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

test('can I afford it gives a verdict for a financed purchase', async ({ app }) => {
  await app.importAll();
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Can I afford it?' }).click();
  await app.sheet().getByRole('tab', { name: 'Finance it' }).click();
  await app.field('Price').locator('input').fill('25000');
  await app.field('Down payment').locator('input').fill('2000');
  await expect(app.sheet().locator('.status-badge')).toBeVisible();
  await expect(app.sheet().locator('.kpis')).toContainText('Payment');
});

test('rent calculator: ranges, roommates, a listing and the landlord check @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Rent calculator' }).click();
  // Known numbers, so the ranges are exact.
  await app.field('Take-home / mo').locator('input').fill('5000');
  await app.field('Other costs / mo').locator('input').fill('2500');
  await app.field('Save / mo').locator('input').fill('1000');
  await expect(app.sheet().locator('.hero-card')).toContainText('$1,500/mo');
  await expect(app.sheet().locator('.rent-range-row', { hasText: 'Cheap' })).toContainText('up to $1,000/mo');
  await page.screenshot({ path: 'test-results/rent-alone.png' });

  await app.field(/^People/).locator('input').fill('3');
  await app.field('Utilities / mo').locator('input').fill('180');
  await app.field('Your extras / mo').locator('input').fill('40');
  // Your share after $100 of extras: $1,400 of rent each, so a $4,200 place.
  await expect(app.sheet().locator('.hero-card')).toContainText('a place up to $4,200');
  await app.field('Listing rent / mo').locator('input').fill('3600');
  await expect(app.sheet().locator('.hero-card')).toContainText('Acceptable');
  await expect(app.sheet().locator('.hero-card')).toContainText('You’d pay $1,300 a month ($1,200 rent + $100 extras)');
  await app.sheet().getByRole('tab', { name: 'Whole place' }).click();
  await expect(app.sheet().locator('.rent-readout').first()).toContainText('This place: $3,600 rent');

  await app.field('Gross salary / yr').locator('input').fill('45000');
  await expect(app.sheet().locator('.kpi', { hasText: 'Your share, max' })).toContainText('$1,125');
  await expect(app.sheet().getByText(/more than your share can be/)).toBeVisible();
  await app.sheet().locator('.rent-band').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/rent-roommates.png' });
  await app.field('Listing rent / mo').locator('input').fill('5400');
  await expect(app.sheet().locator('.hero-card')).toContainText('Expensive');
  await expect(app.sheet().locator('.takehome-legend')).toContainText('Saving $600');
  await app.sheet().locator('.takehome').screenshot({ path: `test-results/rent-takehome-${test.info().project.name}.png` });
});

test('mortgage calculator: the monthly cost, PMI under 20% down, paying extra, and cash to buy', async ({ app }) => {
  await app.importAll();
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Mortgage calculator' }).click();
  // Before a price: the price that fits 28% of take-home pay.
  await expect(app.sheet().locator('.hero-card')).toContainText('A price that fits');
  // $500,000 with 20% down at 6.5% for 30 years: $2,528 principal and interest, $458 tax, $167 insurance.
  await app.field('Home price').locator('input').fill('500000');
  await expect(app.sheet().locator('.hero-card')).toContainText('$3,153');
  await expect(app.sheet().locator('.hero-card')).toContainText('$2,528 principal & interest');
  await expect(app.sheet().locator('.status-badge')).toContainText('of your take-home pay');
  await expect(app.sheet().locator('.kpis')).toContainText('$400K');
  const month = app.sheet().locator('.section', { hasText: 'Principal & interest' });
  await expect(month.locator('.row', { hasText: 'Property tax' })).toContainText('$458');
  await expect(month.locator('.row', { hasText: 'PMI' })).toHaveCount(0);
  // 10% down: PMI, until the loan is 78% of the price.
  await app.field('Down payment').locator('input').fill('10');
  await expect(month.locator('.row', { hasText: 'PMI' })).toContainText('$188');
  await expect(month).toContainText('PMI stops once you owe 78% of the price');
  await expect(app.sheet().locator('.section', { hasText: 'Cash to buy' }).locator('.row', { hasText: 'Down payment' })).toContainText('$50,000');
  // $500 extra a month pays it off years sooner.
  await app.field('Extra / month').locator('input').fill('500');
  await expect(app.sheet().locator('.section', { hasText: 'Pay extra' })).toContainText(/Paid off [\d.]+ years sooner, with \$[\d,]+ less interest\./);
});
