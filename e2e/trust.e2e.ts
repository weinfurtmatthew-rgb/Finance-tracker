import { expect, test } from './helpers';

test('an import can be undone right away, or later from Settings', async ({ app, page }) => {
  await app.importFile('checking.csv', { type: 'checking' });
  await app.sheet().getByRole('button', { name: 'Undo This Import' }).click();
  await expect(page.locator('.toast')).toHaveText('Import undone');
  await app.tab('Activity');
  await expect(app.txnRows()).toHaveCount(0);

  // Two imports; Settings undoes the newest, and only that one.
  await app.importFile('checking.csv', { type: 'checking' });
  await app.closeSheets();
  await app.tab('Activity');
  const checking = await app.txnRows().count();
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await expect.poll(() => app.txnRows().count()).toBeGreaterThan(checking);
  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: /Undo Last Import/ }).click();
  await page.getByRole('button', { name: 'Undo Import' }).click();
  await expect(page.locator('.toast')).toHaveText('Import undone');
  await app.tab('Activity');
  await expect.poll(() => app.txnRows().count()).toBe(checking);
});

test("what's new shows once after an update, and any time from Settings", async ({ app, page }) => {
  // Someone who last saw an older release.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('finance-tracker');
        open.onsuccess = () => {
          const tx = open.result.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ key: 'whatsNewSeen', value: '2026-10-02' });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(app.sheet().getByRole('heading', { name: 'What’s New' })).toBeVisible();
  await expect(app.sheet()).toContainText('Numbers you can trust');
  await expect(app.sheet()).not.toContainText('A livelier app');
  await app.closeSheets();

  // Seen: it doesn't come back.
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.sheet')).toHaveCount(0);

  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: 'What’s New' }).click();
  await expect(app.sheet()).toContainText('A livelier app');
});
