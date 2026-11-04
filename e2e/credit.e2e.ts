import { expect, test } from './helpers';

// The app's clock is frozen at Sep 29, 2026.
test('credit: card limits and the statement nudge, the score log, a goal, and where it shows up @smoke', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();

  // The Discover card ($503 owed): a $2,000 limit, and a statement that closes Oct 2.
  await app.tab('Net Worth');
  const cards = page.locator('.section', { hasText: 'Credit cards' });
  await cards.locator('.row', { hasText: 'Discover' }).click();
  await app.sheet().getByRole('button', { name: 'Edit', exact: true }).click();
  await app.field('Credit limit').locator('input').fill('2000');
  await app.field('Statement day').locator('input').fill('2');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(app.sheet().locator('.detail-hero-card')).toContainText('25% of the $2,000 limit · statement closes Oct 2');
  await app.closeSheets();
  await expect(cards).toContainText('Using 25% of your $2,000 in card limits');

  // Today: pay it down to $200 before the statement closes.
  const nudge = await app.todo('Pay $304 on Discover');
  await expect(nudge).toContainText('Before the statement closes Oct 2, to report under 10% of the limit');

  // The score log, from empty.
  await app.tab('Browse');
  await app.browseCard('Credit Score').click();
  await expect(app.sheet()).toContainText('Track your credit score');
  for (const [score, date] of [
    ['690', '2026-06-01'],
    ['712', '2026-08-20'],
  ]) {
    await app.sheet().getByRole('button', { name: 'Add Score' }).first().click();
    await app.field('Score').locator('input').fill(score);
    await app.field('Date').locator('input').fill(date);
    await app.field('From').locator('input').fill('Credit Karma');
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText('Score added');
  }
  const hero = app.sheet().locator('.credit-hero');
  await expect(hero).toContainText('712');
  await expect(hero).toContainText('Good · +22 since Jun 1 · Credit Karma');
  await expect(app.sheet().locator('.credit-use')).toContainText('25% used · under 30%: good');

  // A goal.
  await app.sheet().getByRole('button', { name: 'Set a Score Goal' }).click();
  await app.field('Goal').locator('input').fill('750');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(app.sheet().locator('.credit-goal')).toContainText('38 points to go');
  await app.closeSheets();

  // A month on from the last score, Today asks for a new one.
  await expect(await app.todo('Update your credit score')).toContainText('Last one: 712 on Aug 20');

  // Money Health has a credit part now, and Plan starts from a typical rate for a 712.
  await app.tab('Browse');
  await app.browseCard('Money Health').click();
  await expect(page.locator('.pillar', { hasText: 'Credit' })).toContainText('Score 712 · 25% of card limits used');
  await app.openPlan();
  await app.sheet().locator('.row', { hasText: 'Can I afford it?' }).click();
  await app.field('Price').locator('input').fill('20000');
  await app.sheet().getByRole('tab', { name: 'Finance it' }).click();
  await expect(app.field('APR').locator('input')).toHaveValue('8');
  await expect(app.field('APR')).toContainText('Typical for a 712 credit score (Good)');
  await app.closeSheets();

  // Year in Review: how the score moved.
  await app.tab('Browse');
  await page.locator('.recap-teaser').click();
  await expect(app.sheet().locator('.recap-card', { hasText: 'Credit score' })).toContainText('Up 22 points, from 690');
});
