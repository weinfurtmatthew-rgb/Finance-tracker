import { expect, test } from './helpers';

test('a 401(k): the match check, the yearly limit, and your savings @smoke', async ({ app, page }) => {
  await app.tab('Net Worth');
  await page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill('Acme 401(k)');
  await app.field('Type').locator('select').selectOption('401k');
  await app.field('Value').locator('input').fill('42000');
  // $100,000 a year; 4% in, and the employer matches half of it up to 6% of pay.
  await app.field('Pay / yr').locator('input').fill('100000');
  await app.field('You put in').locator('input').fill('4');
  await app.field('Match').locator('input').fill('50');
  await app.field('Up to').locator('input').fill('6');
  await expect(app.sheet()).toContainText('You put in $4,000 a year and your employer adds $2,000. Put in 6% to get the full match: $1,000 more a year.');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();

  // Under Retirement in Net Worth, with the year at your rate.
  await app.tab('Net Worth');
  const retirement = page.locator('.section', { hasText: 'Retirement' });
  await expect(retirement.locator('.row', { hasText: 'Acme 401(k)' })).toContainText('$42,000.00');
  await expect(retirement).toContainText('2026 401(k): $4,000 of $24,500 at your rate');

  // Today: the match you're missing.
  const todo = await app.todo('Get your full 401(k) match');
  await expect(todo).toContainText('Put in 6% instead of 4%: $1,000 more a year');
  await todo.click();
  const section = app.sheet().locator('.section', { hasText: 'Contributions' });
  await expect(section).toContainText('Missing $1,000 a year of match');
  await expect(section.locator('.k401-limit')).toContainText('$4,000 of $24,500');

  // Put in 6%: the full match, and the reminder goes away.
  await app.sheet().getByRole('button', { name: 'Edit' }).click();
  await app.field('You put in').locator('input').fill('6');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(section).toContainText('You get the full match');
  await expect(section).toContainText('$3,000/yr');
  await app.closeSheets();
  await app.tab('Today');
  await expect(page.locator('.todo-row', { hasText: 'Get your full 401(k) match' })).toHaveCount(0);

  // Plan counts what goes in each month as investing: $9,000 a year with the match.
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Financial independence' }).click();
  await expect(app.field('Invest / mo')).toContainText('plus $750 into your 401(k) with the match');
});
