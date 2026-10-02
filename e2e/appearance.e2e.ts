import { expect, test } from './helpers';

test('pick an accent color; it recolors the app and sticks after a reload @smoke', async ({ app, page }) => {
  const tint = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tint').trim());
  const blue = await tint();
  await app.tab('Settings');
  // No support link in this build, so there's no Support row.
  await expect(app.sheet().getByText('Support Finance Tracker')).toHaveCount(0);
  await app.sheet().getByRole('button', { name: /Accent Color/ }).click();
  await page.getByRole('button', { name: 'Green', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
  expect(await tint()).not.toBe(blue);
  await expect(app.sheet().locator('.row', { hasText: 'Accent Color' })).toContainText('Green');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
  // Back to the default.
  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: /Accent Color/ }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-accent', /.+/);
  expect(await tint()).toBe(blue);
});
