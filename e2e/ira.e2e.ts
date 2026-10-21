import { expect, test } from './helpers';

// The app's clock is frozen at Sep 29, 2026, past April 15, so contributions count for 2026.
test('a Roth IRA: a transfer spotted in a bank file counts as a contribution, toward the limit @smoke', async ({ app, page }) => {
  await app.tab('Net Worth');
  await page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill('Fidelity Roth IRA');
  await app.field('Type').locator('select').selectOption('roth-ira');
  await app.field('Bank').locator('input').fill('Fidelity');
  await app.field('Value').locator('input').fill('20000');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();

  // A bank file with $500 sent to Fidelity: Today asks whether it went into the IRA.
  await app.importFile('ira-transfer.csv', { type: 'checking' });
  await app.closeSheets();
  const todo = await app.todo('Was this an IRA contribution?');
  await expect(todo).toContainText('$500 on Sep 3');
  await todo.click();
  await app.sheet().getByRole('button', { name: 'IRA Contribution' }).click();
  await expect(page.locator('.toast')).toHaveText('Counted as an IRA contribution');
  await expect(app.sheet()).toContainText('All caught up');
  await app.closeSheets();

  // It counts toward the year's limit (shown under Retirement). The value typed in today already
  // includes money sent on Sep 3, so it isn't added again.
  await app.tab('Net Worth');
  const retirement = page.locator('.section', { hasText: 'Retirement' });
  const row = retirement.locator('.row', { hasText: 'Fidelity Roth IRA' });
  await expect(retirement).toContainText('2026 IRA contributions: $500 of $7,500');
  await expect(row).toContainText('$20,000.00');

  // Its page: the limit meter, and adding one by hand.
  await row.click();
  await expect(app.sheet().locator('.ira-room')).toContainText('$500 of $7,500');
  await app.sheet().getByRole('button', { name: 'Add Contribution' }).click();
  await app.field('Amount').locator('input').fill('1000');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Added $1,000 for 2026');
  await expect(app.sheet().locator('.ira-room')).toContainText('$1,500 of $7,500');
  await expect(app.sheet().locator('.ira-room')).toContainText('$6,000 left');

  // The money sent to Fidelity isn't spending.
  await app.closeSheets();
  await app.tab('Activity');
  await expect(app.txnRows('FIDELITY').first()).toContainText('Investments');
});

test('the retirement projection grows your IRAs to the age you retire', async ({ app, page }) => {
  await app.tab('Net Worth');
  await page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill('Vanguard IRA');
  await app.field('Type').locator('select').selectOption('ira');
  await app.field('Value').locator('input').fill('50000');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();

  await app.openPlan();
  await app
    .sheet()
    .getByRole('button', { name: /Retirement savings/ })
    .click();
  await expect(app.sheet().locator('.plan-answer')).toContainText('Add your birth year');
  await app.field('Birth year').locator('input').fill('1990');
  // 36 at the frozen date, so 29 years to 65.
  await expect(app.sheet().locator('.plan-answer')).toContainText('At 65, in 2055');
  await expect(app.sheet().locator('.plan-answer')).toContainText('in today’s dollars');
});
