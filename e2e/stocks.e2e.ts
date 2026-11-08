import { expect, test, type App } from './helpers';
import { closeOn, mockTwelveData, MOCK_KEY, type MockTicker } from './prices';

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
  const requests = await mockTwelveData(page, [VTI]);
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

  // Only what's needed was asked for: the key twice, the search, and VTI's closes three ways (once).
  expect(requests.filter((r) => r.startsWith('/time_series'))).toHaveLength(3);
  expect(requests.filter((r) => r.startsWith('/api_usage'))).toHaveLength(2);
  expect(requests.every((r) => !r.startsWith('/symbol_search') || !r.includes('apikey'))).toBe(true);
  await app.tab('Settings');
  await expect(app.sheet().locator('.row', { hasText: 'Twelve Data' })).toContainText('8 of 800 requests used today');
});

test('stocks without a key: shares and a price you type in, and nothing is sent anywhere', async ({ app, page }) => {
  const requests = await mockTwelveData(page, [VTI]);
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
