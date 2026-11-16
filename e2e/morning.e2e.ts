import { expect, fixture, test, type App } from './helpers';
import { DAYS, mockAlphaVantage, mockTwelveData, MOCK_KEY, MOCK_NEWS_KEY, SPY, type MockArticle, type MockTicker } from './prices';

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

/** Northwind again, with two announcements of its own (one from before the week). */
const NWRX_NEWS: MockTicker = {
  ...NWRX,
  pressReleases: [
    {
      id: 41,
      datetime: '2026-09-24T12:30:00',
      title: 'Northwind Robotics reports a <b>record</b> quarter',
      body: '<p>Revenue rose 18%.</p><script>alert(1)</script>',
    },
    { id: 40, datetime: '2026-08-30T12:00:00', title: 'Northwind Robotics names a new chief', body: '<p>An old one.</p>' },
  ],
};

const ARTICLES: MockArticle[] = [
  {
    title: 'Northwind Robotics wins a warehouse contract',
    url: 'https://news.example.com/northwind-contract',
    time: '20260928T150000',
    source: 'Example Wire',
    summary: 'A big order.',
    ticker: 'NWRX',
    relevance: 0.8,
  },
  {
    title: 'Robot makers rally',
    url: 'https://news.example.com/robots-rally',
    time: '20260925T140000',
    source: 'Example Daily',
    summary: 'Shares rose.',
    ticker: 'NWRX',
    relevance: 0.6,
  },
  // Only a mention: not news about it.
  {
    title: 'Markets close higher',
    url: 'https://news.example.com/markets',
    time: '20260928T210000',
    source: 'Example Daily',
    summary: 'A list of movers.',
    ticker: 'NWRX',
    relevance: 0.1,
  },
];

/** Prices on, and $1,000 of Northwind bought on Jun 1. */
async function holdNorthwind(app: App) {
  const { page } = app;
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
}

test.describe('Stock news', () => {
  test.use({ today: new Date('2026-09-29T08:00:00') });

  test('headlines with your own key, and the company’s announcements, as plain text; only tickers are sent', async ({ app, page }) => {
    const prices = await mockTwelveData(page, [NWRX_NEWS, SPY]);
    const news = await mockAlphaVantage(page, ARTICLES);
    await page.reload();
    await app.importAll();
    await holdNorthwind(app);

    // Without a news key: announcements only, and a way to add headlines.
    await app.tab('Today');
    await page.getByRole('button', { name: 'Morning summary' }).click();
    const stocks = app.sheet().getByRole('region', { name: 'Your stocks', exact: true });
    const announcement = stocks.locator('details.m-announce');
    await expect(announcement).toHaveCount(1);
    await expect(announcement.locator('summary')).toContainText('NWRX · From the company · Thursday');
    await expect(announcement.locator('summary')).toContainText('Northwind Robotics reports a record quarter');
    await expect(announcement.locator('b, script')).toHaveCount(0);
    await announcement.locator('summary').click();
    await expect(announcement.locator('.m-news-text')).toHaveText('Revenue rose 18%.');
    await expect(stocks).toContainText('Announcements from Twelve Data.');
    expect(prices.filter((r) => r.startsWith('/press_releases'))).toEqual([
      '/press_releases?symbol=NWRX&start_date=2026-09-22T00%3A00%3A00&outputsize=5&apikey=test-key',
    ]);

    // Add a key in Settings → Stock News, from the summary's link.
    await stocks.getByRole('button', { name: 'Get headlines about your stocks' }).click();
    await expect(app.sheet().getByRole('link', { name: /Claim a key at alphavantage\.co/ })).toHaveAttribute(
      'href',
      'https://www.alphavantage.co/support/#api-key',
    );
    await app.field('API key').locator('input').fill(MOCK_NEWS_KEY);
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText('Stock news on');
    await app.sheet().locator('.sheet-header button').first().click();

    // Headlines about it (not a passing mention), newest first; each opens its article elsewhere.
    const headlines = stocks.locator('a.m-news-row');
    await expect(headlines).toHaveCount(2);
    await expect(headlines.nth(0)).toContainText('NWRX · Example Wire · Yesterday');
    await expect(headlines.nth(0)).toContainText('Northwind Robotics wins a warehouse contract');
    await expect(headlines.nth(0)).toHaveAttribute('href', 'https://news.example.com/northwind-contract');
    await expect(headlines.nth(0)).toHaveAttribute('target', '_blank');
    await expect(headlines.nth(0)).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(stocks).not.toContainText('Markets close higher');
    await expect(stocks).toContainText('Headlines from Alpha Vantage, announcements from Twelve Data.');
    await expect(stocks.locator('img')).toHaveCount(0);
    // Only the ticker and the key, once.
    expect(news).toEqual([`function=NEWS_SENTIMENT&tickers=NWRX&time_from=20260922T0000&sort=LATEST&limit=50&apikey=${MOCK_NEWS_KEY}`]);

    // Asked once a day: opening it again doesn't ask again.
    await app.closeSheets();
    await page.getByRole('button', { name: 'Morning summary' }).click();
    await expect(app.sheet().locator('a.m-news-row')).toHaveCount(2);
    expect(news).toHaveLength(1);
    expect(prices.filter((r) => r.startsWith('/press_releases'))).toHaveLength(1);
  });

  test('a key it won’t take, or the day’s limit, says so', async ({ app, page }) => {
    await mockTwelveData(page, [NWRX, SPY]);
    await mockAlphaVantage(page, ARTICLES, { limitReached: true });
    await page.reload();
    await app.importAll();
    await holdNorthwind(app);
    await app.tab('Settings');
    await app.sheet().locator('.row', { hasText: 'Alpha Vantage' }).click();
    await app.field('API key').locator('input').fill(MOCK_NEWS_KEY);
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await app.closeSheets();
    await app.tab('Today');
    await page.getByRole('button', { name: 'Morning summary' }).click();
    await expect(app.sheet().getByRole('region', { name: 'Your stocks', exact: true })).toContainText(
      'Alpha Vantage’s free requests for today are used up. Headlines come back tomorrow.',
    );
    await app.closeSheets();
    await app.tab('Settings');
    await expect(app.sheet().locator('.row', { hasText: 'Alpha Vantage' })).toContainText('free requests for today are used up');
  });
});
