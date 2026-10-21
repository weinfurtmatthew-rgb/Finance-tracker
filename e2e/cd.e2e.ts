import { expect, test, type App } from './helpers';

// The app's clock is frozen at Sep 29, 2026 (see helpers.ts).
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function addCd(app: App, name: string, opened: string, apy: string) {
  await app.tab('Net Worth');
  await app.page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill(name);
  await app.field('Type').locator('select').selectOption('cd');
  await app.field('Deposit').locator('input').fill('10000');
  await app.field('Opened').locator('input').fill(opened);
  await app.field('APY').locator('input').fill(apy);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
}

test('a CD grows on its own, and Today mentions it before it matures @smoke', async ({ app, page }) => {
  await addCd(app, 'Ally 12-Month CD', '2025-10-10', '4');
  await expect(page.locator('.toast')).toHaveText('CD added');

  // $10,000 at 4.00% APY, 354 days in: it's under Investments with its grown value.
  const value = money(Math.round(1_000_000 * 1.04 ** (354 / 365)));
  const investments = page.locator('.section', { hasText: 'Investments' });
  const row = investments.locator('.row', { hasText: 'Ally 12-Month CD' });
  await expect(row).toContainText(value);
  await expect(row).toContainText('4% APY · matures Oct 10');

  // Its page: the deposit, the interest so far and the value at maturity.
  await row.click();
  await expect(app.sheet().locator('.cd-facts')).toContainText('$10,000');
  await expect(app.sheet().locator('.cd-facts')).toContainText('$10,400');
  await app.closeSheets();

  // Eleven days out, Today gives a heads-up.
  const todo = await app.todo('CD matures Oct 10');
  await expect(todo).toContainText('Ally 12-Month CD: about $10,400 then');
});

test('a matured CD: it renewed, or the money moved', async ({ app, page }) => {
  await addCd(app, 'Bank CD', '2025-09-01', '4');
  const todo = await app.todo('CD matured Sep 1');
  await todo.click();
  await expect(app.sheet().getByRole('heading', { name: 'CD Matured' })).toBeVisible();
  await app.sheet().getByRole('button', { name: 'It Renewed' }).click();
  await app.field('New APY').locator('input').fill('4.25');
  await app.sheet().getByRole('button', { name: 'Renew' }).click();
  await expect(page.locator('.toast')).toHaveText('Renewed until Sep 1, 2027');
  await expect(page.locator('.todo-row', { hasText: 'Bank CD' })).toHaveCount(0);

  await app.tab('Net Worth');
  const row = page.locator('.section', { hasText: 'Investments' }).locator('.row', { hasText: 'Bank CD' });
  await expect(row).toContainText('4.25% APY · matures Sep 1, 2027');
  // The new term started at what it was worth when it matured: $10,400.
  await row.click();
  await expect(app.sheet().locator('.cd-facts')).toContainText('$10,400');
  await app.closeSheets();

  // Another one matured, and this time the money moved: it's closed and worth nothing from then on.
  await addCd(app, 'Old CD', '2025-08-15', '3');
  await (await app.todo('CD matured Aug 15')).click();
  await app.sheet().getByRole('button', { name: 'I Moved the Money' }).click();
  await expect(page.locator('.toast')).toHaveText('CD closed');
  await app.tab('Net Worth');
  await expect(page.locator('.section', { hasText: 'Hidden' }).locator('.row', { hasText: 'Old CD' })).toContainText('$0.00');
});
