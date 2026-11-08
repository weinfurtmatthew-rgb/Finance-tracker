import { describe, expect, it } from 'vitest';
import { historyFromSeries, type PriceHistory } from '../src/lib/prices';
import { buildAllHoldings } from '../src/lib/holdings';
import { benchmarkResult, buildPortfolio, holdingsByTicker, periodResult, periodStart, valueOn, yearlyReturn } from '../src/lib/portfolio';
import type { Account, Trade } from '../src/types';

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
const trade = (t: Partial<Trade> & Pick<Trade, 'date' | 'kind' | 'amount'>): Trade => ({
  id: `t${++n}`,
  accountId: 'a',
  ticker: 'VTI',
  source: 'manual',
  createdAt: n,
  ...t,
});

/** Closes on the given days (no splits; dividends worked into the total-return closes). */
function history(ticker: string, closes: [string, number][], dividends: [string, number][] = []): PriceHistory {
  const raw = closes.map(([date, close]) => ({ date, close }));
  const all = raw.map((b) => {
    let f = 1;
    for (const [d, amount] of dividends) {
      if (d <= b.date) continue;
      const prev = raw[raw.findIndex((x) => x.date === d) - 1].close;
      f *= prev / (prev + amount);
    }
    return { date: b.date, close: b.close * f };
  });
  return historyFromSeries(ticker, { raw, splitAdjusted: raw, all }, { from: closes[0][0], fetchedAt: Date.parse('2030-01-01') });
}

const vti = history('VTI', [
  ['2026-06-01', 100],
  ['2026-06-02', 105],
  ['2026-06-03', 105],
  ['2026-06-04', 110],
]);

describe('the portfolio over time', () => {
  it('leaves money you add out of the return', () => {
    // $1,000 at $100, then $1,050 more at $105; it ends at $110: up 10% however much went in when.
    const trades = [trade({ date: '2026-06-01', kind: 'buy', amount: 100_000 }), trade({ date: '2026-06-03', kind: 'buy', amount: 105_000 })];
    const p = buildPortfolio([...buildAllHoldings([acct('a')], trades, [vti], []).values()], '2026-06-04')!;
    expect(p.days).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
    expect(p.values).toEqual([100_000, 105_000, 210_000, 220_000]);
    expect(p.flows).toEqual([100_000, 0, 105_000, 0]);
    const all = periodResult(p, periodStart(p, 'all', '2026-06-04'));
    expect(all).toMatchObject({ from: '2026-05-31', startValue: 0, endValue: 220_000, added: 205_000, gain: 15_000 });
    expect(all.pct).toBeCloseTo(0.1, 9);
    // From Jun 2's close: 105 → 110.
    const r = periodResult(p, '2026-06-02');
    expect(r).toMatchObject({ startValue: 105_000, added: 105_000, gain: 10_000 });
    expect(r.pct).toBeCloseTo(110 / 105 - 1, 9);
    expect(r.dates).toEqual(['2026-06-02', '2026-06-03', '2026-06-04']);
    expect(valueOn(p, '2026-05-01')).toBe(0);
  });

  it('counts money taken out, and money its cash says came in, as neither gain nor loss', () => {
    // A buy "from cash" with no cash there is new money; a sale whose money left takes it out.
    const trades = [
      trade({ date: '2026-06-01', kind: 'buy', amount: 100_000, cash: true }),
      trade({ date: '2026-06-02', kind: 'sell', amount: 52_500, shares: 5 }),
    ];
    const hs = buildAllHoldings([acct('a')], trades, [vti], []).get('a')!;
    expect(hs.external).toEqual([
      { date: '2026-06-01', amount: 100_000 },
      { date: '2026-06-02', amount: -52_500 },
    ]);
    const p = buildPortfolio([hs], '2026-06-04')!;
    const all = periodResult(p, periodStart(p, 'all', '2026-06-04'));
    expect(all).toMatchObject({ endValue: 55_000, added: 47_500, gain: 7_500 });
    expect(all.pct).toBeCloseTo(0.1, 9);
    // Cash entered later was there all along: $200 left after a $1,000 buy paid with it means $1,200 was
    // there at the start, counted as put in on the first day.
    const withCash = buildAllHoldings([acct('a', { cash: { amount: 20_000, date: '2026-06-04' } })], trades.slice(0, 1), [vti], []).get('a')!;
    expect(withCash.external).toEqual([{ date: '2026-06-01', amount: 120_000 }]);
  });

  it('measures periods from the right day', () => {
    const p = buildPortfolio(
      [...buildAllHoldings([acct('a')], [trade({ date: '2026-06-01', kind: 'buy', amount: 100_000 })], [vti], []).values()],
      '2026-06-05',
    )!;
    expect(p.priceDate).toBe('2026-06-04');
    expect(periodStart(p, '1d', '2026-06-05')).toBe('2026-06-03');
    expect(periodStart(p, '1w', '2026-06-05')).toBe('2026-05-31'); // not before the first trade
    expect(periodStart(p, 'ytd', '2027-03-01')).toBe('2026-12-31');
    expect(periodStart(p, '1m', '2026-07-31')).toBe('2026-06-30');
    expect(periodStart(p, 'all', '2026-06-05')).toBe('2026-05-31');
  });

  it('puts the same money in the S&P 500, on the same days', () => {
    const spy = history(
      'SPY',
      [
        ['2026-06-01', 400],
        ['2026-06-02', 410],
        ['2026-06-03', 420],
        ['2026-06-04', 440],
      ],
      [['2026-06-03', 2]],
    );
    const trades = [trade({ date: '2026-06-01', kind: 'buy', amount: 100_000 }), trade({ date: '2026-06-03', kind: 'buy', amount: 105_000 })];
    const p = buildPortfolio([...buildAllHoldings([acct('a')], trades, [vti], []).values()], '2026-06-04')!;
    const r = periodResult(p, periodStart(p, 'all', '2026-06-04'));
    const b = benchmarkResult(r, p, spy)!;
    const total = (d: string) => spy.total[spy.dates.indexOf(d)];
    // From the first purchase's close, with the dividend reinvested: more than the price's 10%.
    expect(b.pct).toBeCloseTo(total('2026-06-04') / total('2026-06-01') - 1, 9);
    expect(b.pct).toBeGreaterThan(440 / 400 - 1);
    // Each dollar went in at that day's total-return close and grew with it.
    expect(b.values[0]).toBe(0);
    expect(b.endValue).toBe(Math.round((100_000 / total('2026-06-01') + 105_000 / total('2026-06-03')) * total('2026-06-04')));
    expect(benchmarkResult(r, p, undefined)).toBeNull();
  });

  it('gives a yearly return once there’s a year to go on', () => {
    const long = history('VTI', [
      ['2024-06-03', 100],
      ['2025-06-03', 110],
      ['2026-06-03', 121],
    ]);
    const p = buildPortfolio(
      [...buildAllHoldings([acct('a')], [trade({ date: '2024-06-03', kind: 'buy', amount: 100_000 })], [long], []).values()],
      '2026-06-03',
    )!;
    expect(yearlyReturn(p, '2026-06-03')).toBeCloseTo(0.1, 3);
    const short = buildPortfolio(
      [...buildAllHoldings([acct('a')], [trade({ date: '2026-06-01', kind: 'buy', amount: 100_000 })], [vti], []).values()],
      '2026-06-04',
    )!;
    expect(yearlyReturn(short, '2026-06-04')).toBeNull();
  });

  it('puts a ticker held in two accounts together, with its own return', () => {
    const trades = [
      trade({ accountId: 'a', date: '2026-06-01', kind: 'buy', amount: 100_000 }),
      trade({ accountId: 'b', date: '2026-06-02', kind: 'buy', amount: 105_000 }),
      trade({ accountId: 'b', ticker: 'FXAIX', date: '2026-06-02', kind: 'buy', amount: 50_000, shares: 2 }),
    ];
    const p = buildPortfolio(
      [
        ...buildAllHoldings(
          [acct('a'), acct('b')],
          trades,
          [vti],
          [{ ticker: 'FXAIX', name: 'Fidelity 500', manualPrices: [{ date: '2026-06-04', price: 260 }] }],
        ).values(),
      ],
      '2026-06-04',
    )!;
    const list = holdingsByTicker(p, '2026-06-03');
    expect(list.map((h) => [h.ticker, h.value, h.positions.length])).toEqual([
      ['VTI', 220_000, 2],
      ['FXAIX', 52_000, 1],
    ]);
    expect(list[0].shares).toBeCloseTo(20, 9);
    expect(list[0].pct).toBeCloseTo(110 / 105 - 1, 9);
    expect(list[1].pct).toBeCloseTo(260 / 250 - 1, 9);
  });
});
