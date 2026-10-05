import { expect, test } from './helpers';

test('tag a trip by dates and see what it cost @smoke', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Browse');
  await app.browseCard('Trips & Tags').click();
  await app.sheet().getByRole('button', { name: 'Tag a Trip or Event…' }).click();
  await app.sheet().getByLabel('Trip tag').fill('Boston Weekend');
  await app.sheet().getByLabel('From').fill('2026-09-20');
  await app.sheet().getByLabel('To').fill('2026-09-27');
  await expect(app.sheet().locator('.check-row').first()).toBeVisible();
  await app.sheet().getByRole('button', { name: /^Tag \d+/ }).click();
  await expect(page.getByText(/Tagged \d+ transactions? #Boston Weekend/)).toBeVisible();
  await app.sheet().locator('.row', { hasText: '#Boston Weekend' }).click();
  await expect(app.sheet().locator('.hero-card')).toContainText('Spent');
  await expect(app.sheet().getByText('By category')).toBeVisible();
  await app.sheet().getByRole('button', { name: /^View \d+ Transactions?/ }).click();
  await app.closeSheets();
  await expect(page.getByLabel('Filter by tag')).toHaveValue('Boston Weekend');
  await expect(app.txnRows().first()).toContainText('#Boston Weekend');
});

test('ask what a tagged trip cost', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await app.tab('Activity');
  await app.txnRows('Chipotle').first().click();
  const tag = app.sheet().getByLabel('Add a tag');
  await tag.fill('Italy 2026');
  await tag.press('Enter');
  await app.sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await app.tab('Today');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByLabel('Search or ask').fill('how much did the italy trip cost');
  await page.getByLabel('Search or ask').press('Enter');
  await expect(page.locator('.answer-card').getByText(/on #Italy 2026 overall/)).toBeVisible();
});

test('a question asked while the app is still loading waits for the data', async ({ app, page }) => {
  await app.importFile('discover.csv');
  await app.closeSheets();
  await page.reload();
  // Straight from a fresh load: Search opens before the transactions have been read.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search or ask').fill('how many times did I go to Chipotle');
  await page.getByLabel('Search or ask').press('Enter');
  await expect(page.locator('.answer-card .answer-headline')).toContainText(/Chipotle/);
  await expect(page.locator('.answer-card .answer-headline')).not.toContainText(/\b0 times/);
});
