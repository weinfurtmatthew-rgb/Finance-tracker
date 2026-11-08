import { expect, test, type App } from './helpers';
import { closeOn, mockTwelveData, MOCK_KEY, SPY, type MockTicker } from './prices';

// The app's clock is frozen at Sep 29, 2026 (before the market opens): the latest close is Sep 28's.

/** A fund that split 2-for-1 on Jun 15 and paid $0.90 a share (in today's shares) on Mar 25. */
const VTI: MockTicker = {
  ticker: 'VTI',
  name: 'Vanguard Total Stock Market Index Fund ETF',
  type: 'ETF',
  exchange: 'NYSE',
  price: (i) => 240 + 0.1 * i,
  splits: [['2026-06-15', 2]],
  dividends: [['2026-03-25', 0.9]],
};

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const wholeMoney = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

async function addInvestmentAccount(app: App, name: string, type: string) {
  await app.tab('Net Worth');
  await app.page
    .getByRole('button', { name: /^Add (account|Account)$/ })
    .first()
    .click();
  await app.field('Name').locator('input').fill(name);
  await app.field('Type').locator('select').selectOption(type);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await app.closeSheets();
  await app.page.locator('.row', { hasText: name }).first().click();
}

test('stocks: prices with your own key, a purchase by amount and date, a split, a dividend and a sale @smoke', async ({ app, page }) => {
  const requests = await mockTwelveData(page, [VTI, SPY]);
  await page.reload();
  await addInvestmentAccount(app, 'Fidelity Brokerage', 'brokerage');
  const holdings = app.sheet().locator('.section', { hasText: 'Holdings' });
  await expect(holdings).toContainText('With a free price key (Settings → Stock Prices), how much you put in and when is enough.');

  // Turning prices on: a key it doesn't accept, then yours.
  await holdings.getByRole('button', { name: 'Turn On Stock Prices' }).click();
  await expect(app.sheet()).toContainText('The app asks Twelve Data only for prices, by ticker symbol');
  await app.field('API key').locator('input').fill('not-my-key');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(app.sheet()).toContainText('Twelve Data didn’t accept this key.');
  await app.field('API key').locator('input').fill(MOCK_KEY);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Stock prices on');
  await expect(app.sheet()).toContainText('•••• -key');
  await app.sheet().locator('.sheet-header button').first().click();

  // $1,000 into VTI on Jan 5: found by name, and the shares come from that day's close ($500.80 before the split).
  await holdings.getByRole('button', { name: 'Add a Stock, ETF or Fund' }).click();
  await app.field('Ticker').locator('input').fill('total stock');
  await app.sheet().locator('.row', { hasText: 'Vanguard Total Stock Market' }).click();
  await app.field('Amount').locator('input').fill('1000');
  await app.field('Date').locator('input').fill('2026-01-05');
  const jan5 = closeOn(VTI, '2026-01-05');
  const bought = 1000 / jan5;
  const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  await expect(app.sheet()).toContainText(`About ${shares(bought / 2)} shares at ${money(jan5 * 2 * 100)}, the close on Jan 5.`);
  await expect(app.sheet()).toContainText(`After its 2-for-1 split on Jun 15, that’s ${shares(bought)} shares today.`);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('VTI added');

  // The Mar 25 dividend bought more shares at that day's close; today it's worth Sep 28's close.
  const dividend = Math.round(0.9 * bought * 100);
  const held = bought + dividend / 100 / closeOn(VTI, '2026-03-25');
  const last = closeOn(VTI, '2026-09-28');
  const value = Math.round(held * last * 100);
  await expect(app.sheet().locator('.detail-big')).toHaveText(money(value));
  await expect(holdings.locator('.holding-row', { hasText: 'VTI' })).toContainText(`${shares(held)} shares · ${money(last * 100)}`);
  await expect(holdings).toContainText('Prices from Twelve Data, as of the close Sep 28.');

  // Up close: what it cost (the purchase and the reinvested dividend), the gain, and its trades.
  await holdings.locator('.holding-row', { hasText: 'VTI' }).click();
  const cost = 100_000 + dividend;
  const hero = app.sheet().locator('.detail-hero-card');
  await expect(hero).toContainText(`${shares(held)} shares at ${money(last * 100)} · close Sep 28 · ETF`);
  await expect(hero).toContainText(`Cost${wholeMoney(cost)}`);
  await expect(hero).toContainText(`Dividends${wholeMoney(dividend)}`);
  await expect(hero).toContainText(`Gain+${wholeMoney(value - cost)}+${(((value - cost) / cost) * 100).toFixed(1)}%`);
  await expect(app.sheet().locator('.section', { hasText: 'Trades' })).toContainText(
    `Bought $1,000.00Jan 5 · ${shares(bought / 2)} shares at ${money(jan5 * 2 * 100)}`,
  );
  await expect(app.sheet().locator('.section', { hasText: 'Dividends' })).toContainText('Mar 25$0.90 a share');

  // Selling $500 on Aug 3, kept in the account as cash.
  await app.sheet().getByRole('button', { name: 'Sell', exact: true }).click();
  await app.field('Amount').locator('input').fill('500');
  await app.field('Date').locator('input').fill('2026-08-03');
  await expect(app.sheet().getByRole('switch', { name: 'Kept in this account as cash' })).toBeChecked();
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Sale of VTI added');
  await app.sheet().locator('.sheet-header button').first().click();
  const left = held - 500 / closeOn(VTI, '2026-08-03');
  await expect(holdings.locator('.row', { hasText: 'Cash' })).toContainText('$500');
  await expect(app.sheet().locator('.detail-big')).toHaveText(money(Math.round(left * last * 100) + 50_000));
  await app.closeSheets();

  // Net Worth: valued from its holdings, with no "update its value" reminder.
  await app.tab('Net Worth');
  await expect(page.locator('button.row', { hasText: 'Fidelity Brokerage' })).toContainText('1 holding · prices Sep 28');
  await expect(page.getByText('Update Investment & Vehicle Values')).toHaveCount(0);

  // Only what's needed was asked for: the key twice, the search, and VTI's closes three ways (once), then
  // the S&P 500's to compare with.
  await expect.poll(() => requests.filter((r) => r.startsWith('/time_series')).length).toBe(6);
  expect(requests.filter((r) => r.startsWith('/time_series')).map((r) => new URLSearchParams(r.split('?')[1]).get('symbol'))).toEqual([
    'VTI',
    'VTI',
    'VTI',
    'SPY',
    'SPY',
    'SPY',
  ]);
  expect(requests.filter((r) => r.startsWith('/api_usage'))).toHaveLength(2);
  expect(requests.every((r) => !r.startsWith('/symbol_search') || !r.includes('apikey'))).toBe(true);
  await app.tab('Settings');
  await expect(app.sheet().locator('.row', { hasText: 'Twelve Data' })).toContainText('11 of 800 requests used today');
});

test('stocks without a key: shares and a price you type in, and nothing is sent anywhere', async ({ app, page }) => {
  const requests = await mockTwelveData(page, [VTI, SPY]);
  await page.reload();
  await addInvestmentAccount(app, 'Fidelity Roth IRA', 'roth-ira');
  const holdings = app.sheet().locator('.section', { hasText: 'Holdings' });
  await holdings.getByRole('button', { name: 'Add a Stock, ETF or Fund' }).click();
  await app.field('Ticker').locator('input').fill('fxaix');
  await app.field('Name').locator('input').fill('Fidelity 500 Index Fund');
  await app.field('Amount').locator('input').fill('2000');
  await app.field('Date').locator('input').fill('2026-03-02');
  await expect(app.sheet()).toContainText('Without a price key, add the shares too');
  await app.sheet().getByRole('switch', { name: 'I know the shares' }).check();
  await app.field('Shares').locator('input').fill('10');
  await expect(app.sheet()).toContainText('$200.00 a share.');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('FXAIX added');
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('Fidelity 500 Index Fund');
  await expect(holdings.locator('.holding-row', { hasText: 'FXAIX' })).toContainText('10 shares · $200.00');
  await expect(app.sheet().locator('.detail-big')).toHaveText('$2,000.00');

  // Today's price, from the brokerage.
  await holdings.locator('.holding-row', { hasText: 'FXAIX' }).click();
  await expect(app.sheet()).toContainText('Without a price key, it’s valued at the prices you enter.');
  await app.field('Price today').locator('input').fill('230');
  await app.sheet().getByRole('button', { name: 'Save Price' }).click();
  await expect(page.locator('.toast')).toHaveText('Price saved');
  await expect(app.sheet().locator('.detail-big')).toHaveText('$2,300.00');
  await expect(app.sheet().locator('.detail-hero-card')).toContainText('Gain+$300+15.0%');
  await app.closeSheets();
  await app.tab('Net Worth');
  await expect(page.locator('.section', { hasText: 'Retirement' }).locator('.row', { hasText: 'Fidelity Roth IRA' })).toContainText('$2,300.00');
  expect(requests).toEqual([]);
});

test('portfolio: what it all comes to, by period, next to the S&P 500 @smoke', async ({ app, page }) => {
  await mockTwelveData(page, [VTI, SPY]);
  await page.reload();
  await app.tab('Settings');
  await app.sheet().locator('.row', { hasText: 'Twelve Data' }).click();
  await app.field('API key').locator('input').fill(MOCK_KEY);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Stock prices on');
  await app.closeSheets();

  // VTI in two accounts: $1,000 on Jan 5 and $500 on Mar 2.
  const buys: [string, string, number, string][] = [
    ['Brokerage', 'brokerage', 1000, '2026-01-05'],
    ['Roth IRA', 'roth-ira', 500, '2026-03-02'],
  ];
  for (const [name, type, amount, date] of buys) {
    await addInvestmentAccount(app, name, type);
    await app.sheet().getByRole('button', { name: 'Add a Stock, ETF or Fund' }).click();
    await app.field('Ticker').locator('input').fill('VTI');
    await app.sheet().locator('.row', { hasText: 'Vanguard Total Stock Market' }).click();
    await app.field('Amount').locator('input').fill(String(amount));
    await app.field('Date').locator('input').fill(date);
    await expect(app.sheet()).toContainText('shares today');
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText('VTI added');
    await app.closeSheets();
  }

  // Each bought at its day's close, and the Mar 25 dividend bought more shares in both.
  const last = closeOn(VTI, '2026-09-28');
  const worth = (amount: number, date: string) => {
    const bought = amount / closeOn(VTI, date);
    const shares = bought + Math.round(0.9 * bought * 100) / 100 / closeOn(VTI, '2026-03-25');
    return { shares, value: Math.round(shares * last * 100) };
  };
  const [a, b] = buys.map(([, , amount, date]) => worth(amount, date));
  const total = a.value + b.value;
  await app.tab('Browse');
  await expect(app.browseCard('Portfolio')).toContainText(wholeMoney(total));
  await app.browseCard('Portfolio').click();
  const hero = app.sheet().locator('.portfolio-hero');
  await expect(hero.locator('.detail-big')).toHaveText(money(total));
  await expect(hero).toContainText('this month');

  // Since the first purchase: the gain leaves out what went in, and the percent is VTI's own return.
  await hero.getByRole('tab', { name: 'All' }).click();
  const yours = ((closeOn(VTI, '2026-03-25') + 0.9) / closeOn(VTI, '2026-01-05')) * (last / closeOn(VTI, '2026-03-25')) - 1;
  const pct = (x: number) => `+${(x * 100).toFixed(1)}%`;
  await expect(hero.locator('.change-line')).toHaveText(`▲ ${wholeMoney(total - 150_000)} (${pct(yours)}) since you started`);
  const vs = app.sheet().locator('.section', { hasText: 'Vs the S&P 500' });
  const row = (title: string) => vs.locator('.row').filter({ has: page.locator('.row-title', { hasText: new RegExp(`^${title}$`) }) });
  await expect(row('Yours')).toContainText(pct(yours));
  const spy = (d: string) => closeOn(SPY, d);
  await expect(row('S&P 500')).toContainText(pct(spy('2026-09-28') / spy('2026-01-05') - 1));
  const sameMoney = Math.round((100_000 / spy('2026-01-05') + 50_000 / spy('2026-03-02')) * spy('2026-09-28'));
  await expect(row('Same money in the S&P 500')).toContainText(wholeMoney(sameMoney));

  const holding = app.sheet().locator('.section', { hasText: 'Holdings' }).locator('.holding-row', { hasText: 'VTI' });
  await expect(holding).toContainText('100% of it · 2 accounts');
  const started = app
    .sheet()
    .locator('.section')
    .filter({ has: page.locator('.section-title', { hasText: 'Since you started' }) });
  await expect(started).toContainText('Put in');
  await expect(started).toContainText('$1,500');
  await expect(app.sheet()).toContainText('Prices from Twelve Data, as of the close Sep 28.');

  // Today: since the close before Sep 28's (no chart for a day).
  await hero.getByRole('tab', { name: '1D' }).click();
  const day =
    Math.round(a.shares * last * 100) +
    Math.round(b.shares * last * 100) -
    Math.round(a.shares * closeOn(VTI, '2026-09-25') * 100) -
    Math.round(b.shares * closeOn(VTI, '2026-09-25') * 100);
  await expect(hero.locator('.change-line')).toHaveText(`▲ ${wholeMoney(day)} (${pct(last / closeOn(VTI, '2026-09-25') - 1)}) today`);
  await expect(hero.locator('.chart')).toHaveCount(0);
});

test('portfolio: the mix, a company that’s a lot of it, a target mix, and dividends', async ({ app, page }) => {
  const AAPL: MockTicker = { ticker: 'AAPL', name: 'Apple Inc.', type: 'Common Stock', exchange: 'NASDAQ', price: (i) => 190 + 0.12 * i };
  const BND: MockTicker = { ticker: 'BND', name: 'Vanguard Total Bond Market Index Fund ETF', type: 'ETF', exchange: 'NASDAQ', price: (i) => 72 + 0.01 * i };
  await mockTwelveData(page, [VTI, AAPL, BND, SPY]);
  await page.reload();
  await app.tab('Settings');
  await app.sheet().locator('.row', { hasText: 'Twelve Data' }).click();
  await app.field('API key').locator('input').fill(MOCK_KEY);
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Stock prices on');
  await app.closeSheets();

  // $6,000 of VTI, $3,000 of Apple and $1,000 of BND, all on Jan 5.
  await addInvestmentAccount(app, 'Brokerage', 'brokerage');
  const buys: [MockTicker, string, number][] = [
    [VTI, 'Vanguard Total Stock Market', 6000],
    [AAPL, 'Apple Inc.', 3000],
    [BND, 'Vanguard Total Bond Market', 1000],
  ];
  for (const [m, pick, amount] of buys) {
    await app
      .sheet()
      .getByRole('button', { name: /^(Add a Stock, ETF or Fund|Add)$/ })
      .first()
      .click();
    await app.field('Ticker').locator('input').fill(m.ticker);
    await app.sheet().locator('.row', { hasText: pick }).click();
    await app.field('Amount').locator('input').fill(String(amount));
    await app.field('Date').locator('input').fill('2026-01-05');
    await expect(app.sheet()).toContainText('the close on Jan 5');
    await app.sheet().getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toHaveText(`${m.ticker} added`);
  }
  await app.closeSheets();

  const at = (m: MockTicker, dollars: number) => Math.round((dollars / closeOn(m, '2026-01-05')) * closeOn(m, '2026-09-28') * 100);
  const bought = 6000 / closeOn(VTI, '2026-01-05');
  const dividend = Math.round(0.9 * bought * 100);
  const vti = Math.round((bought + dividend / 100 / closeOn(VTI, '2026-03-25')) * closeOn(VTI, '2026-09-28') * 100);
  const [aapl, bnd] = [at(AAPL, 3000), at(BND, 1000)];
  const total = vti + aapl + bnd;
  const share = (v: number) => `${Math.round((v / total) * 100)}%`;

  await app.tab('Browse');
  await app.browseCard('Portfolio').click();
  const mix = app
    .sheet()
    .locator('.section')
    .filter({ has: page.locator('.section-title', { hasText: /^Mix/ }) });
  await expect(mix.locator('.ranked-row', { hasText: 'US stocks' })).toContainText(share(vti + aapl));
  await expect(mix.locator('.ranked-row', { hasText: 'Bonds' })).toContainText(share(bnd));
  const section = (title: string) =>
    app
      .sheet()
      .locator('.section')
      .filter({ has: page.locator('.section-title', { hasText: new RegExp(`^${title}`) }) });
  await expect(section('Concentration')).toContainText(`AAPL is ${share(aapl)} of your investments: a bad year for one company would hit hard.`);
  await expect(section('Companies by sector').locator('.ranked-row', { hasText: 'Technology' })).toContainText(share(aapl));

  // Aiming for 60% US, 20% international, 20% bonds.
  await mix.getByRole('button', { name: 'Set Target' }).click();
  await app.field('US stocks').locator('input').fill('60');
  await app.field('International stocks').locator('input').fill('20');
  await app.field('Bonds').locator('input').fill('10');
  await expect(app.sheet()).toContainText('They add up to 90%: make it 100%.');
  await app.field('Bonds').locator('input').fill('20');
  await app.sheet().getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toHaveText('Target mix saved');
  await expect(mix.locator('.ranked-row', { hasText: 'US stocks' })).toContainText('target 60%');
  const intl = section('Vs your target').locator('.row', { hasText: 'International stocks: 0%, target 20%' });
  await expect(intl).toContainText(`${wholeMoney(Math.round(0.2 * total))} more would put it on target`);

  // Dividends: VTI's in March, reinvested.
  const dividends = app
    .sheet()
    .locator('.section')
    .filter({ has: page.locator('.section-title', { hasText: /^Dividends$/ }) });
  await expect(dividends.locator('.row', { hasText: 'Last 12 months' })).toContainText(wholeMoney(dividend));
  await expect(dividends.locator('.row', { hasText: 'Last 12 months' })).toContainText(`${wholeMoney(dividend)} reinvested`);
  await dividends.locator('.row', { hasText: 'Last 12 months' }).click();
  await expect(app.sheet().locator('.row', { hasText: 'VTI' })).toContainText(`${((0.9 / closeOn(VTI, '2026-09-28')) * 100).toFixed(1)}% yield`);
});
