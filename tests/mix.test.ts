import { describe, expect, it } from 'vitest';
import { historyFromSeries, type PriceHistory } from '../src/lib/prices';
import { buildAllHoldings } from '../src/lib/holdings';
import { buildPortfolio } from '../src/lib/portfolio';
import { concentration, drift, isStock, kindOf, mixByKind, sectorOf, stocksBySector } from '../src/lib/mix';
import { dividendOutlook, dividendSummary, payouts } from '../src/lib/dividends';
import type { Account, Security, Trade } from '../src/types';

const acct = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type: 'brokerage',
  institution: '',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
  ...extra,
});
let n = 0;
/** One share bought at `dollars`: worth that at the price paid. */
const hold = (ticker: string, dollars: number, accountId = 'a'): Trade => ({
  id: `t${++n}`,
  accountId,
  ticker,
  date: '2026-06-01',
  kind: 'buy',
  amount: dollars * 100,
  shares: 1,
  source: 'manual',
  createdAt: n,
});
const sec = (ticker: string, type: string, extra: Partial<Security> = {}): Security => ({ ticker, name: ticker, type, ...extra });

function portfolio(trades: Trade[], securities: Security[], accounts = [acct('a')], prices: PriceHistory[] = [], today = '2026-09-29') {
  return buildPortfolio([...buildAllHoldings(accounts, trades, prices, securities).values()], today)!;
}

describe('what it’s made of', () => {
  it('knows popular funds, companies from their listing, and what you set', () => {
    expect([kindOf('VTI'), kindOf('VXUS'), kindOf('BND'), kindOf('VNQ'), kindOf('SPAXX')]).toEqual(['us', 'intl', 'bonds', 'realestate', 'cash']);
    expect(kindOf('XYZ', sec('XYZ', 'Common Stock'))).toBe('us');
    expect(kindOf('TSM', sec('TSM', 'Depositary Receipt'))).toBe('intl');
    expect(kindOf('ABCD', sec('ABCD', 'ETF'))).toBeUndefined();
    expect(kindOf('ABCD', sec('ABCD', 'ETF', { kind: 'bonds' }))).toBe('bonds');
    expect([isStock(undefined, 'AAPL'), isStock(sec('VTI', 'ETF'), 'VTI'), isStock(sec('XYZ', 'Common Stock'), 'XYZ')]).toEqual([true, false, true]);
    expect([sectorOf('AAPL'), sectorOf('JPM'), sectorOf('XYZ'), sectorOf('XYZ', sec('XYZ', 'Common Stock', { sector: 'Energy' }))]).toEqual([
      'Technology',
      'Financials',
      undefined,
      'Energy',
    ]);
  });

  it('adds up holdings and cash by kind, with what isn’t known set apart', () => {
    const p = portfolio(
      [hold('VTI', 10_000), hold('AAPL', 3_000), hold('BND', 2_000), hold('ABCD', 1_000)],
      [sec('VTI', 'ETF'), sec('AAPL', 'Common Stock'), sec('BND', 'ETF'), sec('ABCD', 'ETF')],
      [acct('a', { cash: { amount: 50_000, date: '2026-09-29' } })],
    );
    const mix = mixByKind(p, new Map([['ABCD', sec('ABCD', 'ETF')]]));
    expect(mix.total).toBe(1_650_000);
    expect(mix.slices.map((s) => [s.key, s.value])).toEqual([
      ['us', 1_300_000],
      ['bonds', 200_000],
      ['cash', 50_000],
      ['unset', 100_000],
    ]);
    expect(mix.unknown).toEqual(['ABCD']);
    expect(mix.slices[0].share).toBeCloseTo(13 / 16.5, 9);
  });

  it('notices when a lot rides on one company, three of them, or one industry', () => {
    // AAPL is 30%, and the three biggest companies 55%; technology is 40%, not over it (funds don't count toward any of it).
    const p = portfolio([hold('AAPL', 6_000), hold('MSFT', 2_000), hold('JPM', 3_000), hold('VTI', 9_000)], []);
    const found = concentration(p, new Map());
    expect(found.map((c) => [c.kind, Math.round(c.share * 100), c.tickers])).toEqual([
      ['stock', 30, ['AAPL']],
      ['top3', 55, ['AAPL', 'JPM', 'MSFT']],
    ]);
    expect(found[0].text).toBe('AAPL is 30% of your investments: a bad year for one company would hit hard.');
    expect(stocksBySector(p, new Map()).map((s) => [s.key, s.value])).toEqual([
      ['Technology', 800_000],
      ['Financials', 300_000],
    ]);
    // Over 40% in one industry's companies.
    const tech = portfolio([hold('AAPL', 3_000), hold('MSFT', 3_000), hold('NVDA', 3_000), hold('VTI', 11_000)], []);
    expect(concentration(tech, new Map()).map((c) => c.kind)).toEqual(['sector']);
    expect(concentration(tech, new Map())[0].text).toBe('Technology companies are 45% of your investments: one industry’s slump would hit most of it.');
    // All in funds: nothing to flag.
    expect(concentration(portfolio([hold('VTI', 9_000), hold('VXUS', 3_000)], []), new Map())).toEqual([]);
  });

  it('shows how far each kind is from a target, and what would put it back', () => {
    const p = portfolio([hold('VTI', 8_000), hold('BND', 1_000), hold('VXUS', 1_000)], []);
    const d = drift(mixByKind(p, new Map()), { us: 0.6, intl: 0.2, bonds: 0.2 });
    expect(d.map((x) => [x.kind, Math.round(x.share * 100), x.target * 100, x.change])).toEqual([
      ['us', 80, 60, -200_000],
      ['intl', 10, 20, 100_000],
      ['bonds', 10, 20, 100_000],
    ]);
  });
});

/** Weekdays at $100 from Sep 1, 2025, with dividends worked into the total-return closes. */
function flat(ticker: string, dividends: [string, number][]): PriceHistory {
  const raw: { date: string; close: number }[] = [];
  for (let t = Date.parse('2025-09-01T12:00:00Z'); t <= Date.parse('2026-09-28T12:00:00Z'); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) raw.push({ date: d.toISOString().slice(0, 10), close: 100 });
  }
  const all = raw.map((b) => ({ date: b.date, close: dividends.reduce((f, [d, a]) => (d > b.date ? (f * 100) / (100 + a) : f), 100) }));
  return historyFromSeries(ticker, { raw, splitAdjusted: raw, all }, { from: raw[0].date, fetchedAt: Date.parse('2030-01-01') });
}

describe('dividends', () => {
  const quarterly: [string, number][] = [
    ['2025-12-22', 0.9],
    ['2026-03-25', 0.9],
    ['2026-06-26', 0.95],
    ['2026-09-25', 0.95],
  ];
  const vti = flat('VTI', quarterly);
  const buy = (accountId: string, date: string, dollars: number): Trade => ({ ...hold('VTI', dollars, accountId), date, shares: undefined });

  it('knows each one’s rate, how often it pays, and when the next one is due', () => {
    const p = portfolio([buy('a', '2025-10-01', 10_000)], [], [acct('a')], [vti]);
    const [o] = dividendOutlook(p, '2026-09-29');
    expect(vti.dividends.map((d) => d.amount)).toEqual([0.9, 0.9, 0.95, 0.95]);
    expect(o).toMatchObject({ ticker: 'VTI', every: 'quarterly', next: { date: '2026-12-27' } });
    expect(o.perShare).toBeCloseTo(3.7, 9);
    expect(o.yield).toBeCloseTo(0.037, 9);
    // Reinvested at $100, so there are more than the 100 shares bought.
    expect(o.shares).toBeGreaterThan(100);
    expect(o.yearly).toBe(Math.round(3.7 * o.shares * 100));
    expect(o.next!.amount).toBe(Math.round(0.95 * o.shares * 100));
  });

  it('sums up the last year and the next, month by month', () => {
    const p = portfolio([buy('a', '2025-10-01', 10_000), buy('b', '2026-04-01', 5_000)], [], [acct('a'), acct('b', { cashDividends: ['VTI'] })], [vti]);
    const all = payouts(p);
    // Account b bought after March's, so it got June's and September's, paid to its cash.
    expect(all.map((d) => [d.accountId, d.date, d.reinvested])).toEqual([
      ['a', '2025-12-22', true],
      ['a', '2026-03-25', true],
      ['a', '2026-06-26', true],
      ['b', '2026-06-26', false],
      ['a', '2026-09-25', true],
      ['b', '2026-09-25', false],
    ]);
    const s = dividendSummary(p, '2026-09-29', 2_000_000)!;
    expect(s.last12).toBe(all.reduce((x, d) => x + d.amount, 0));
    expect(s.reinvested12).toBe(all.filter((d) => d.reinvested).reduce((x, d) => x + d.amount, 0));
    expect(s.months.map((m) => m.key)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(s.months.filter((m) => m.amount > 0).map((m) => m.key)).toEqual(['2025-12', '2026-03', '2026-06', '2026-09']);
    expect(s.upcoming).toEqual([{ ticker: 'VTI', date: '2026-12-27', amount: s.outlook[0].next!.amount }]);
    expect(s.yield).toBeCloseTo(s.next12 / 2_000_000, 9);
    // Nothing that pays dividends: nothing to show.
    expect(dividendSummary(portfolio([hold('ABCD', 1_000)], []), '2026-09-29', 100_000)).toBeNull();
  });
});
