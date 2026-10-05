import { expect, test } from './helpers';

test('Today: recent transactions, money on hand, and one short To do list', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Today');
  await expect(page.locator('.on-hand')).toContainText('checking & cash');
  await expect(page.locator('.on-hand')).toContainText('on cards');
  const recent = page.locator('.section', { hasText: 'Recent' }).locator('.txn-row');
  await expect(recent).toHaveCount(3);
  // Three at a time, the rest a tap away.
  const todos = page.locator('.todo-row');
  await expect(todos).toHaveCount(3);
  await expect(todos.first()).toContainText('Back up your data');
  await page.locator('.todo-more').click();
  await expect.poll(() => todos.count()).toBeGreaterThan(3);
  // Monthly things live in Browse now.
  await expect(page.locator('.health-teaser, .recap-teaser')).toHaveCount(0);
});

test('Browse: grouped, as a list or as tiles, and it remembers', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Browse');
  for (const group of ['Money', 'Plan & Look Back', 'People & Trips']) await expect(page.getByRole('heading', { name: group })).toBeVisible();
  await expect(page.locator('.browse-row')).toHaveCount(9);
  await expect(app.browseCard('Categories')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show as tiles' }).click();
  await expect(page.locator('.browse-card')).toHaveCount(9);
  await page.reload();
  await app.tab('Browse');
  await expect(page.locator('.browse-card')).toHaveCount(9);
  await expect(page.getByRole('button', { name: 'Show as a list' })).toBeVisible();
  // Money owed to you is part of People.
  await app.browseCard('People').click();
  await expect(app.sheet().locator('.row', { hasText: 'Owed to You' })).toBeVisible();
});

test('Settings: setup only, Backup first', async ({ app, page }) => {
  await app.tab('Settings');
  await expect(app.sheet().locator('.section-title').first()).toHaveText('Backup');
  await expect(app.sheet().getByRole('button', { name: 'Backup Reminder' })).toBeVisible();
  for (const gone of ['Trips & Tags', 'People', 'Owed to You']) await expect(app.sheet().locator('.row-title', { hasText: new RegExp(`^${gone}$`) })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Categories/ }).first()).toBeVisible();
});
