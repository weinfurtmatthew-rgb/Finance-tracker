import { expect, test } from './helpers';

test('numbers count up to the right value, and Today has its live marker and shimmer', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();
  await page.reload();
  const score = page.locator('.readiness-tile .gauge-score');
  // After counting up it lands on the same score the tile announces (both settle once the data has loaded).
  await expect
    .poll(async () => {
      const label = (await page.locator('.readiness-tile').getAttribute('aria-label')) ?? '';
      return label.includes(`Spend Readiness ${await score.textContent()} out of 10`);
    })
    .toBe(true);
  await page.waitForTimeout(1000);
  const label = (await page.locator('.readiness-tile').getAttribute('aria-label')) ?? '';
  expect(label).toContain(`Spend Readiness ${await score.textContent()} out of 10`);
  await expect(page.locator('.pace-svg .live-ring')).toHaveCount(1);
  await expect(page.locator('.gauge .live-glow')).toHaveCount(1);
  await app.tab('Browse');
  await expect(page.locator('.recap-teaser.shimmer, .browse-pin.shimmer')).not.toHaveCount(0);
});

test('the tab pill slides to the selected tab', async ({ app, page }) => {
  const pill = page.locator('.tab-pill');
  await expect(pill).toHaveAttribute('style', /translateX\(0%\)/);
  await app.tab('Browse');
  await expect(pill).toHaveAttribute('style', /translateX\(200%\)/);
  // Pages opened from Browse keep Browse selected.
  await app.browseCard('Spending').click();
  await expect(pill).toHaveAttribute('style', /translateX\(200%\)/);
});

test('with Reduce Motion, numbers show their final value straight away', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.left-value')).toBeVisible();
  // Watch every value the number shows for a second: a count-up would pass through dozens; without
  // motion it only changes when the data does (at most a couple of times while it finishes loading).
  const seen = await page.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const values = new Set<string>();
        const end = performance.now() + 1000;
        const look = () => {
          values.add(document.querySelector('.left-value')?.textContent ?? '');
          if (performance.now() < end) requestAnimationFrame(look);
          else done([...values]);
        };
        look();
      }),
  );
  expect(seen.length).toBeLessThanOrEqual(3);
});

test('without Reduce Motion, the same number does count up', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();
  await page.reload();
  const seen = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const values = new Set<string>();
        const end = performance.now() + 1500;
        const look = () => {
          const t = document.querySelector('.left-value')?.textContent;
          if (t) values.add(t);
          if (performance.now() < end) requestAnimationFrame(look);
          else done(values.size);
        };
        look();
      }),
  );
  expect(seen).toBeGreaterThan(3);
});
