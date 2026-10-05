import { expect, test } from '../e2e/helpers';
import { fileURLToPath } from 'node:url';

/**
 * How fast the app is with years of history (`npm run perf`). Prints timings at full speed and with the
 * CPU slowed 4× (roughly a phone); it doesn't fail on numbers, since timings vary run to run. Aim: every
 * tab under 500 ms at 4×.
 */
test.setTimeout(600_000);

test('speed with three years of history', async ({ app, page }) => {
  const log = (label: string, ms: number) => console.log(`${label.padEnd(28)} ${String(Math.round(ms)).padStart(6)} ms`);
  let t = Date.now();
  await page.getByRole('button', { name: /Import a Bank File/ }).first().click();
  await page.locator('.drop input[type=file]').setInputFiles(fileURLToPath(new URL('./history.csv', import.meta.url)));
  await expect(page.getByText('Review Import')).toBeVisible({ timeout: 120_000 });
  log('read the file', Date.now() - t);
  await app.field('Type').locator('select').selectOption('checking');
  t = Date.now();
  await page.getByRole('button', { name: /^Import \d+/ }).click();
  await expect(page.getByText(/Imported \d+ transactions?/)).toBeVisible({ timeout: 300_000 });
  log('import', Date.now() - t);
  await app.closeSheets();
  const cdp = await page.context().newCDPSession(page);
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    t = Date.now();
    await page.reload();
    await expect(page.locator('.pace-card')).toBeVisible({ timeout: 120_000 });
    log(`${rate}× open the app`, Date.now() - t);
    for (const name of ['Activity', 'Browse', 'Today'] as const) {
      t = Date.now();
      await page.locator('.tabbar button', { hasText: name }).click();
      await page.waitForFunction(() => document.querySelectorAll('main .card, main .group').length > 2, null, { timeout: 120_000 });
      log(`${rate}× switch to ${name}`, Date.now() - t);
    }
    t = Date.now();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByLabel('Search or ask').pressSequentially('star', { delay: 0 });
    await expect(page.locator('.top-hit')).toBeVisible({ timeout: 120_000 });
    log(`${rate}× search "star"`, Date.now() - t);
    const worst = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          let w = 0;
          new PerformanceObserver((l) => l.getEntries().forEach((e) => (w = Math.max(w, e.duration)))).observe({ type: 'longtask', buffered: true });
          setTimeout(() => done(w), 300);
        }),
    );
    log(`${rate}× longest freeze`, worst);
    await page.locator('.tab-back').click();
  }
});
