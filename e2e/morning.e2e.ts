import { expect, fixture, test, type App } from './helpers';
import { DAYS, mockTwelveData, MOCK_KEY, SPY, type MockTicker } from './prices';

/** A made-up company whose stock jumped 20% on Sep 23, and 2% more on Sep 28 (the latest close). */
const NWRX: MockTicker = {
  ticker: 'NWRX',
  name: 'Northwind Robotics Inc',
  type: 'Common Stock',
  exchange: 'NASDAQ',
  price: (i) => (i === DAYS.length - 1 ? 61.2 : i >= DAYS.length - 4 ? 60 : 50),
};

/** Last week's purchases (Sep 21–27) into the checking account: a double charge, a late fee and a first visit among them. */
async function importWeek(app: App) {
  await app.openImport();
  await app.page.locator('.drop input[type=file]').setInputFiles(fixture('morning-week.csv'));
  await expect(app.page.getByText('Review Import')).toBeVisible();
  const account = app.field('Account').locator('select');
  const label = (await account.locator('option').allTextContents()).find((o) => o.includes('Checking'))!;
  await account.selectOption({ label });
  await app.page.getByRole('button', { name: /^Import \d+/ }).click();
  await expect(app.page.getByText(/Imported \d+ transactions?/)).toBeVisible();
  await app.closeSheets();
}

test.describe('on a Monday morning', () => {
  test.use({ today: new Date('2026-09-28T08:00:00') });

  test('the morning summary opens by itself on the first open of the morning, once @smoke', async ({ app, page }) => {
    await app.importAll();
    await app.closeSheets();
    // Importing doesn't open it; the next time the app opens does.
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
    await page.reload();
    const sheet = page.getByRole('dialog', { name: 'Morning Summary' });
    await expect(sheet.getByRole('heading', { name: /Good morning,\s*it’s Monday, Sep 28/ })).toBeVisible();
    await expect(sheet.getByText('From your bank files through today.')).toBeVisible();

    // Where you stand: the same net worth as Net Worth, and what changed this week.
    const stand = sheet.getByRole('region', { name: 'Where you stand', exact: true });
    await expect(stand.locator('.m-stat', { hasText: 'Net worth' })).toContainText('$19,186');
    await expect(stand.locator('.m-stat', { hasText: 'Net worth' })).toContainText('▼ $116 this week');
    await expect(stand.locator('.m-stat', { hasText: 'On cards' })).toContainText('$503');

    // To do: the top of Today's list, as cards; each opens what it's about.
    await expect(sheet.locator('.m-todo').first()).toContainText('Back up your data');
    await expect(sheet.getByRole('button', { name: /more on Today/ })).toBeVisible();

    // The last 7 days and the next 7.
    const week = sheet.locator('.m-part', { hasText: 'The last 7 days' });
    await expect(week).toContainText('Net worth down $116');
    await expect(week).toContainText('$384 → $503 owed');
    // On a Monday, spending is last week's (Monday to Sunday), in a part of its own at the top.
    await expect(week).not.toContainText(/\$[\d,]+ spent/);
    await expect(sheet.getByRole('region', { name: 'Last week', exact: true }).locator('.m-big')).toHaveText('$120');
    await expect(week.locator('.txn-row', { hasText: 'Chipotle' })).toContainText('−$119.68');
    await expect(sheet.locator('.m-part', { hasText: 'The next 7 days' })).toContainText('See your week ahead');

    // A stat opens where it comes from; the summary closes.
    await stand.locator('.m-stat', { hasText: 'Money Health' }).click();
    await expect(page.getByRole('heading', { name: 'Money Health', level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);

    // Seen today: opening the app again doesn't bring it back.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Money Health', level: 1 }).or(page.getByRole('heading', { name: 'Today', level: 1 }))).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
  });

  test('with bills tracked, the next 7 days shows what is due, and a stale import says so', async ({ app, page }) => {
    await app.importAll();
    await app.tab('Recurring');
    await page.getByText(/Found \d+ possible recurring/).click();
    await page.getByRole('button', { name: 'Add All' }).click();
    await app.closeSheets();
    await app.tab('Today');
    await page.getByRole('button', { name: 'Morning summary' }).click();
    const ahead = app.sheet().locator('.m-part', { hasText: 'The next 7 days' });
    await expect(ahead.locator('.m-day.today')).toContainText('28');
    await expect(ahead.locator('.txn-row').first()).toBeVisible();
    await expect(ahead.locator('.section-footer')).toContainText(/Paycheck .* in checking/);
  });
});

test.describe('a week after the last import', () => {
  test.use({ today: new Date('2026-10-05T07:30:00') });

  test('it says the numbers are behind, with a way to import', async ({ app, page }) => {
    await app.importAll();
    await app.closeSheets();
    await page.reload();
    const sheet = page.getByRole('dialog', { name: 'Morning Summary' });
    await expect(sheet.getByText(/Your newest transaction is from Sep \d+/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible();
  });
});

test('the sun button on Today opens it any time, greeting you by the name in Settings', async ({ app, page }) => {
  await app.importAll();
  await app.closeSheets();
  // Noon isn't the morning: it doesn't open by itself.
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);

  await app.tab('Settings');
  await app.field('Your Name').locator('input').fill('Sam');
  await app.field('Your Name').locator('input').blur();
  await app.closeSheets();
  await app.tab('Today');
  await page.getByRole('button', { name: 'Morning summary' }).click();
  await expect(app.sheet().getByRole('heading', { name: /Good afternoon, Sam,\s*it’s Tuesday, Sep 29/ })).toBeVisible();
  await expect(app.sheet().locator('.m-hero .m-tag')).toHaveText('Your day');
  await app.sheet().getByRole('button', { name: 'Go to Today' }).click();
  await expect(page.getByRole('dialog', { name: 'Morning Summary' })).toHaveCount(0);
});

test.describe('A Monday morning after a busy week', () => {
  test.use({ today: new Date('2026-09-28T08:00:00') });

  test('where last week’s money went, and the charges worth a look @smoke', async ({ app, page }) => {
    await app.importAll();
    await importWeek(app);
    await page.reload();
    const sheet = page.getByRole('dialog', { name: 'Morning Summary' });
    await expect(sheet).toBeVisible();

    // Mondays: Monday to Sunday's spending, by category, as circles and as a list with each one's share.
    const week = sheet.getByRole('region', { name: 'Last week', exact: true });
    await expect(week.locator('.m-big')).toHaveText('$765');
    await expect(week).toContainText('Spent Sep 21 to Sep 27');
    await expect(week.locator('.m-burst circle')).toHaveCount(6);
    await expect(week.locator('.ranked-row').first()).toContainText('Dining');
    await expect(week.locator('.ranked-row').first()).toContainText('$236 · 31%');
    await expect(week.locator('.ranked-row').last()).toContainText('3 other categories');
    await expect(week).toContainText('Most of it went to Best Buy ($214)');
    // The last 7 days leave spending to last week's total.
    await expect(sheet.getByRole('region', { name: 'The last 7 days', exact: true })).not.toContainText(/\$[\d,]+ spent/);

    // The likeliest mistakes first.
    const look = sheet.getByRole('region', { name: 'Worth a look', exact: true });
    const rows = look.locator('.row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Charged twice at Olive Garden');
    await expect(rows.nth(0)).toContainText('$58.30 twice on Thursday');
    await expect(rows.nth(1)).toContainText('Late Fee: $35.00');
    await expect(rows.nth(2)).toContainText('First time at Best Buy');

    // One you've opened stays for now, and isn't there next time.
    await rows.nth(2).click();
    await expect(page.getByRole('dialog', { name: 'Transaction' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Transaction' }).locator('.sheet-header button').first().click();
    await expect(rows).toHaveCount(3);
    await app.closeSheets();
    await page.getByRole('button', { name: 'Morning summary' }).click();
    await expect(app.sheet().getByRole('region', { name: 'Worth a look', exact: true }).locator('.row')).toHaveCount(2);
    await expect(app.sheet().getByRole('region', { name: 'Worth a look', exact: true })).not.toContainText('Best Buy');
  });
});

test.describe('A Tuesday morning with stocks, a goal and a credit score', () => {
  test.use({ today: new Date('2026-09-29T08:00:00') });

  test('your stocks, the month so far, and milestones', async ({ app, page }) => {
    await mockTwelveData(page, [NWRX, SPY]);
    await page.reload();
    await app.importAll();

    // Stock prices on, and $1,000 of a stock that jumped this week.
    await app.tab('Settings');
    await app.sheet().locator('.row', { hasText: 'Twelve Data' }).click();
    await app.field('API key').locator('input').fill(MOCK_KEY);
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText('Stock prices on');
    await app.closeSheets();
    await app.tab('Net Worth');
    await page
      .getByRole('button', { name: /^Add (account|Account)$/ })
      .first()
      .click();
    await app.field('Name').locator('input').fill('Brokerage');
    await app.field('Type').locator('select').selectOption('brokerage');
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await app.closeSheets();
    await page.locator('.row', { hasText: 'Brokerage' }).first().click();
    await app.sheet().getByRole('button', { name: 'Add a Stock, ETF or Fund' }).click();
    await app.field('Ticker').locator('input').fill('NWRX');
    await app.sheet().locator('.row', { hasText: 'Northwind Robotics' }).click();
    await app.field('Amount').locator('input').fill('1000');
    await app.field('Date').locator('input').fill('2026-06-01');
    await expect(app.sheet()).toContainText('About 20 shares at $50.00');
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText('NWRX added');
    await app.closeSheets();

    // A savings goal, and two credit scores.
    await app.tab('Net Worth');
    await page.getByRole('button', { name: 'Add a savings goal' }).click();
    await page.getByPlaceholder('e.g. Emergency fund').fill('Emergency fund');
    await app.field('Target').locator('input').fill('25000');
    await app.field('Account').locator('select').selectOption({ label: 'High-Yield Savings' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await app.closeSheets();
    await app.tab('Browse');
    await app.browseCard('Credit Score').click();
    for (const [score, date] of [
      ['712', '2026-08-20'],
      ['724', '2026-09-26'],
    ]) {
      await app.sheet().getByRole('button', { name: 'Add Score' }).first().click();
      await app.field('Score').locator('input').fill(score);
      await app.field('Date').locator('input').fill(date);
      await app.sheet().getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.toast')).toHaveText('Score added');
    }
    await app.closeSheets();

    await app.tab('Today');
    await page.getByRole('button', { name: 'Morning summary' }).click();
    const sheet = app.sheet();
    // Not a Monday: no last week.
    await expect(sheet.getByRole('region', { name: 'Last week', exact: true })).toHaveCount(0);

    // 20 shares, $50 a week ago and $61.20 at Monday's close (up 2% from Friday's $60).
    const stocks = sheet.getByRole('region', { name: 'Your stocks', exact: true });
    await expect(stocks.locator('.m-stat').nth(0)).toContainText('$1,224');
    await expect(stocks.locator('.m-stat').nth(0)).toContainText('▲ $224 this week');
    await expect(stocks.locator('.m-stat').nth(1)).toContainText('+2.0%');
    await expect(stocks.locator('.m-stat').nth(1)).toContainText('▲ $24, Monday');
    await expect(stocks).toContainText('NWRX up 22.4% this week');
    await expect(stocks).toContainText('The market: at its high');

    const month = sheet.getByRole('region', { name: 'September', exact: true });
    await expect(month.locator('.m-tag')).toHaveText('September');
    await expect(month).toContainText(/(under|over) pace|Right on pace/);
    await expect(month).toContainText('in a usual month');

    const miles = sheet.getByRole('region', { name: 'Milestones', exact: true });
    await expect(miles).toContainText('Credit score up 12, to 724');
    await expect(miles.locator('.goal-row')).toContainText('Emergency fund');
    await expect(miles.locator('.goal-row')).toContainText('of $25,000');

    // A stock that moved opens its page.
    await stocks.locator('.row', { hasText: 'NWRX' }).click();
    await expect(page.getByRole('dialog', { name: 'NWRX' })).toBeVisible();
  });
});
