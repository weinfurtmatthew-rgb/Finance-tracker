import { expect, test } from './helpers';

test('year in review: the Overview card, the page, and the story @smoke', async ({ app, page }) => {
  await app.importAll();
  const teaser = page.locator('.recap-teaser');
  await expect(teaser).toContainText('2026 so far');
  await teaser.click();
  await expect(page.getByRole('heading', { name: 'Year in Review' })).toBeVisible();
  await expect(app.sheet().locator('.recap-card').first()).toContainText('spent');
  await expect(app.sheet().locator('.recap-card', { hasText: 'Where it went' })).toBeVisible();
  await expect(app.sheet().locator('.recap-card', { hasText: 'Your spending style' })).toBeVisible();
  await expect(app.sheet().getByText('Month by month')).toBeVisible();

  await page.getByRole('button', { name: '▶ Play your year' }).click();
  const story = page.getByRole('dialog', { name: /Year in review/ });
  await expect(story).toBeVisible();
  const count = await story.locator('.story-progress span').count();
  expect(count).toBeGreaterThan(8);
  for (let i = 1; i < count; i++) await story.getByRole('button', { name: 'Next' }).click();
  await expect(story.locator('.story-kicker')).toContainText('That was 2026 so far');
  const download = page.waitForEvent('download');
  await story.getByRole('button', { name: 'Save as Image' }).click();
  expect((await download).suggestedFilename()).toBe('year-in-review-2026-so-far.png');
  await story.getByRole('button', { name: 'Close' }).first().click();
  await expect(story).toHaveCount(0);
});

test('a past year and the last 12 months can be picked', async ({ app, page }) => {
  await app.importAll();
  await page.locator('.recap-teaser').click();
  await app.sheet().getByLabel('Period').selectOption({ label: 'Last 12 months' });
  await expect(app.sheet().locator('.recap-card').first()).toContainText('Last 12 months');
});

test.describe('in December', () => {
  test.use({ today: new Date('2026-12-05T12:00:00') });
  test('the year in review opens by itself on launch, once', async ({ app, page }) => {
    await app.importAll();
    const story = page.getByRole('dialog', { name: /Year in review/ });
    // Never in the middle of importing; next time the app opens.
    await expect(story).toHaveCount(0);
    await page.reload();
    await expect(story).toBeVisible();
    await story.getByRole('button', { name: 'Close' }).first().click();
    await page.reload();
    await expect(page.locator('.tabbar')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(story).toHaveCount(0);
  });
});
