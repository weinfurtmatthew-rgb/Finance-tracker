import { readFile } from 'node:fs/promises';
import { expect, test } from './helpers';

test('back up with a password, check the file, and restore it @smoke', async ({ app, page }) => {
  await app.importAll();

  // Today reminds you until there's a backup; "Later" snoozes it.
  await app.tab('Today');
  const reminder = page.locator('.backup-callout');
  await expect(reminder).toContainText("You haven't made a backup yet.");
  await reminder.getByRole('button', { name: 'Later' }).click();
  await expect(reminder).toHaveCount(0);

  // Make a protected backup: it's read back and checked before it can be saved.
  await app.tab('Settings');
  await app.sheet().getByRole('button', { name: 'Back Up Now…' }).click();
  const sheet = app.sheet();
  await sheet.getByRole('switch', { name: 'Protect with a password' }).check();
  const create = sheet.getByRole('button', { name: 'Create Backup' });
  await app.field('Password').locator('input').fill('correct horse');
  await app.field('Again').locator('input').fill('correct hors');
  await expect(sheet.getByText("The passwords don't match.")).toBeVisible();
  await expect(create).toBeDisabled();
  await app.field('Again').locator('input').fill('correct horse');
  await create.click();
  await expect(sheet.locator('.backup-ready')).toContainText('Backup ready and checked');
  await expect(sheet.locator('.backup-ready')).toContainText('protected with your password');
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Save to Files…' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^finance-backup-\d{4}-\d{2}-\d{2}-protected\.json$/);
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  expect(JSON.parse(text).format).toBe('finance-tracker-backup-encrypted');
  expect(text).not.toContain('Chipotle');
  await expect(page.getByRole('status').filter({ hasText: 'First backup saved' })).toBeVisible();
  await expect(app.sheet()).toContainText('Last backup:');

  // Checking the file asks for its password, and a wrong one doesn't open it.
  await app.sheet().getByLabel('Check a Backup File…').setInputFiles(path);
  const pw = app.sheet().getByLabel('Password');
  await pw.fill('wrong password');
  await app.sheet().getByRole('button', { name: 'Open' }).click();
  await expect(app.sheet().getByRole('alert')).toContainText('doesn’t open this backup');
  await pw.fill('correct horse');
  await app.sheet().getByRole('button', { name: 'Open' }).click();
  await expect(app.sheet().locator('.backup-ready')).toContainText('This backup can be restored');
  await expect(app.sheet().locator('.row', { hasText: 'Transactions' })).toContainText(/[1-9]/);
  await app.closeSheets();

  // Restoring it brings everything back.
  await app.tab('Settings');
  await app.sheet().getByLabel('Restore from Backup…').setInputFiles(path);
  await app.sheet().getByLabel('Password').fill('correct horse');
  await app.sheet().getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Restore Backup' }).click();
  await expect(page.getByText('Backup restored')).toBeVisible();
});
