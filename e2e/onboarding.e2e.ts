import { test as base } from '@playwright/test';
import { expect, test, TODAY } from './helpers';

// The shared fixture skips the intro, so this one opens the app itself.
base('a fresh app shows the intro once, ending in Import or a look around @smoke', async ({ page }) => {
  await page.clock.setFixedTime(TODAY);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your money, on your phone' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 1 of 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Bring in your transactions' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Keep it safe' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import a Bank File' }).click();
  await expect(page.locator('.sheet h2', { hasText: 'Import' })).toBeVisible();

  // Once finished, it doesn't come back.
  await page.reload();
  await expect(page.getByText('Welcome')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your money, on your phone' })).toHaveCount(0);
});

test('About shows the version, the privacy policy and the intro again', async ({ app, page }) => {
  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: /About Finance Tracker/ }).click();
  await expect(app.sheet().locator('.row', { hasText: 'Version' })).toContainText(/\d+\.\d+\.\d+/);
  await app.sheet().getByRole('button', { name: 'Privacy' }).click();
  await expect(app.sheet()).toContainText('Your financial data never leaves this phone.');
  await app.sheet().getByRole('button', { name: 'Done' }).click();
  await app.sheet().getByRole('button', { name: 'Show the Intro Again' }).click();
  await expect(page.getByRole('heading', { name: 'Your money, on your phone' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Your money, on your phone' })).toHaveCount(0);
});
