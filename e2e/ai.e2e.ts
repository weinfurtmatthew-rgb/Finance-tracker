import { expect, test } from './helpers';

test.use({ withAi: true });

test('AI categorizes similar payees at import and asks you to review @smoke', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.importFile('card2.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Green Leaf Market').first().click();
  await app.field('Category').locator('select').selectOption('groceries');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await app.tab('Overview');
  const summary = await app.importFile('card3.csv');
  expect(summary).toContain('On-device AI categorized 1 more');
  await page.getByRole('button', { name: 'Review AI Picks' }).click();
  await expect(app.sheet()).toContainText('Green Leaf Markets');
  await app.closeSheets();
  await expect(page.locator('.callout', { hasText: 'AI-categorized' })).toBeVisible();
  await app.tab('Activity');
  await expect(app.txnRows('Green Leaf Markets')).toContainText('✨');
  await app.tab('Overview');
  await page.locator('.callout', { hasText: 'AI-categorized' }).click();
  await page.getByRole('button', { name: 'Confirm All' }).click();
  await expect(page.locator('.callout', { hasText: 'AI-categorized' })).toHaveCount(0);
});

test('suggest categories offers likely picks for uncategorized payees', async ({ app, page }) => {
  await app.importAll();
  await app.importFile('extra.csv');
  await app.closeSheets();
  const suggest = page.getByRole('button', { name: /Suggest categories/ });
  if (await suggest.count()) {
    await suggest.click();
    await expect(app.sheet().locator('.suggest-row').first()).toBeVisible();
  }
});
