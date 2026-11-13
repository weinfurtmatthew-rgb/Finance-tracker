import { expect, test } from './helpers';

test('finds subscriptions and bills, and tracks them @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Recurring');
  await page.getByText(/Found \d+ possible recurring/).click();
  await expect(page.getByRole('heading', { name: 'Possible Bills & Subscriptions' })).toBeVisible();
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

test('Apple charges are listed by price and can be named; their transactions show the name', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Recurring');
  await page.getByText(/Found \d+ possible recurring/).click();
  await expect(page.getByText(/Apple bills every App Store subscription as “Apple”/)).toBeVisible();
  const music = page.locator('.suggestion', { hasText: 'Apple ($10.99)' });
  await music.getByRole('textbox', { name: /What Apple \(\$10\.99\) is/ }).fill('Apple Music');
  await music.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.suggestion', { hasText: 'Apple ($10.99)' })).toHaveCount(0);
  await app.closeSheets();

  // The $10.99 charges show "Apple Music"; the $2.99 ones (not named) still show "Apple".
  await app.tab('Activity');
  await expect(app.txnRows('Apple Music').first()).toContainText('−$10.99');
  const plainApple = page.locator('.txn-row').filter({ has: page.locator('.row-title', { hasText: /^Apple$/ }) });
  await expect(plainApple.first()).toContainText('−$2.99');
  await app.txnRows('Apple Music').first().click();
  await expect(app.sheet().getByText('Shown as “Apple Music”, from Bills & Subscriptions')).toBeVisible();
  await app.closeSheets();
  // Search finds them by that name too.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search or ask').fill('apple music');
  await expect(app.txnRows('Apple Music').first()).toBeVisible();
});

test('adding a subscription by hand counts only its own charges', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Recurring');
  await page.getByRole('button', { name: 'Add recurring' }).click();
  await page.getByPlaceholder('e.g. Netflix').fill('Apple Music');
  await page.locator('.sheet input[inputmode=decimal]').first().fill('10.99');
  // Named "Apple Music", nothing matches yet: the tip says how Apple charges come in.
  await expect(app.sheet().getByText(/Apple subscriptions come in as “Apple”/)).toBeVisible();
  await app.field('Contains').locator('input').fill('apple');
  // A subscription only counts charges close to its price: the six $10.99 ones, not the $2.99 ones.
  await expect(app.sheet().getByText('Matches 6 transactions')).toBeVisible();
  await expect(app.sheet().locator('.toggle-row', { hasText: 'Only amounts close to this one' }).locator('input')).toBeChecked();
  await expect(app.sheet().locator('.toggle-row', { hasText: 'Show “Apple Music” on its transactions' }).locator('input')).toBeChecked();
  await app.sheet().locator('.toggle-row', { hasText: 'Only amounts close to this one' }).click();
  await expect(app.sheet().getByText('Matches 12 transactions')).toBeVisible();
  await app.sheet().locator('.toggle-row', { hasText: 'Only amounts close to this one' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Added')).toBeVisible();
  await app.tab('Activity');
  await expect(app.txnRows('Apple Music').first()).toContainText('−$10.99');
  await expect(
    page
      .locator('.txn-row')
      .filter({ has: page.locator('.row-title', { hasText: /^Apple$/ }) })
      .first(),
  ).toContainText('−$2.99');
});

test('a paycheck that takes turns between Thursday and Tuesday is expected on the right day', async ({ app, page }) => {
  // Thu Jul 16, Tue Jul 28, Thu Aug 13, … Tue Sep 22: the next one is Thursday Oct 8, not Tuesday Oct 6.
  await app.importFile('paycheck-turns.csv', { type: 'checking' });
  await app.closeSheets();
  await app.tab('Recurring');
  await page.getByText(/Found \d+ possible recurring/).click();
  const pay = page.locator('.suggestion', { hasText: /globex/i });
  await expect(pay).toContainText('Every 2 weeks');
  await pay.getByRole('button', { name: 'Add' }).click();
  await app.closeSheets();
  await expect(page.locator('.txn-row', { hasText: /globex/i }).first()).toContainText('Due Oct 8');
});
