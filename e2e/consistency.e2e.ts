import { expect, test } from './helpers';

const dollars = (s: string) => Number(s.replace(/[^0-9.-]/g, ''));

test('Today, Spending and Activity agree on what September cost', async ({ app, page }) => {
  await app.importAll();

  // Today: everyday spending, plus bills, makes the month's total.
  await app.tab('Today');
  const foot = page.locator('.pace-foot');
  await expect(foot).toContainText(/Plus \$[\d,]+ in bills like rent: \$[\d,]+ spent in all/);
  const [, billsText, totalText] = (await foot.innerText()).match(/Plus (\$[\d,]+) in bills.*: (\$[\d,]+) spent/)!;
  const everyday = page.locator('.pace-numbers .pace-big').first();
  await expect.poll(async () => dollars(await everyday.innerText()) + dollars(billsText)).toBe(dollars(totalText));

  // Spending: the same total, and the same bills.
  await app.tab('Spending');
  const kpi = (label: string) => page.locator('.kpi').filter({ hasText: label }).locator('.kpi-value');
  await expect.poll(async () => dollars(await kpi('Spent').innerText())).toBe(dollars(totalText));
  await expect.poll(async () => dollars(await kpi('Bills paid').innerText())).toBe(dollars(billsText));

  // Activity: the month card again.
  await app.tab('Activity');
  const card = page.locator('.month-card');
  await expect(card).toContainText('September 2026');
  await expect.poll(async () => dollars(await card.locator('.month-stat').first().innerText())).toBe(dollars(totalText));
});

test('the Activity month card adds up what the list shows', async ({ app, page }) => {
  await app.importAll();
  await app.tab('Activity');
  const card = page.locator('.month-card');
  const count = card.locator('.month-stat').nth(2);
  const all = Number(await count.innerText());
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await expect(card).toContainText('Totals are for this month and your filters');
  await expect.poll(async () => Number(await count.innerText())).toBeLessThan(all);
  await expect(card.locator('.month-stat').first()).toHaveText('$0');
});
