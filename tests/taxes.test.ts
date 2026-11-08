import { describe, expect, it } from 'vitest';
import { historyFromSeries, type PriceHistory } from '../src/lib/prices';
import { buildAllHoldings } from '../src/lib/holdings';
import { buildPortfolio } from '../src/lib/portfolio';
import { harvestable, longTermOn, openLots, realizedBetween, termOn, turningLongTerm, unrealized } from '../src/lib/taxes';
import { fromHighText, moodOf, trendOf } from '../src/lib/market';
import { portfolioInsights } from '../src/lib/insights';
import { buildRecap, yearPeriod } from '../src/lib/recap';
import { recapCards } from '../src/lib/recapCards';
import { makeBook } from '../src/lib/networth';
import type { Account, Security, Trade } from '../src/types';

/** Weekday closes from `from` to `to`, at `price(date)`. */
function series(ticker: string, from: string, to: string, price: (date: string) => number): PriceHistory {
  const bars: { date: string; close: number }[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const date = d.toISOString().slice(0, 10);
    bars.push({ date, close: price(date) });
  }
  return historyFromSeries(ticker, { raw: bars, splitAdjusted: bars, all: bars }, { from, fetchedAt: Date.parse('2030-01-01') });
}

const acct = (id: string, type: Account['type'], name = id): Account => ({ id, name, type, institution: '', openingBalance: 0, archived: false, createdAt: 0 });
let n = 0;
const trade = (accountId: string, ticker: string, date: string, kind: Trade['kind'], dollars: number, shares: number, extra: Partial<Trade> = {}): Trade => ({
  id: `t${++n}`,
  accountId,
  ticker,
  date,
  kind,
  amount: dollars * 100,
  shares,
  source: 'manual',
  createdAt: n,
  ...extra,
});

const TODAY = '2026-09-29';
// VTI: $100, then $110 from December, then $120 from September.
const vti = series('VTI', '2025-06-02', '2026-09-28', (d) => (d < '2025-12-01' ? 100 : d < '2026-09-01' ? 110 : 120));
// ABC: $50, then $30 from June.
const abc = series('ABC', '2025-06-02', '2026-09-28', (d) => (d < '2026-06-01' ? 50 : 30));
const accounts = [acct('b', 'brokerage', 'Brokerage'), acct('r', 'roth-ira', 'Roth IRA')];
const trades = [
  trade('b', 'VTI', '2025-06-10', 'buy', 1_000, 10),
  trade('b', 'VTI', '2025-10-13', 'buy', 500, 5),
  trade('b', 'VTI', '2026-03-02', 'buy', 550, 5),
  // 2 of the first 10 before they were long-term, then 3 more after.
  trade('b', 'VTI', '2026-02-02', 'sell', 220, 2),
  trade('b', 'VTI', '2026-09-15', 'sell', 360, 3),
  trade('r', 'VTI', '2026-09-10', 'buy', 240, 2),
  trade('b', 'ABC', '2026-03-02', 'buy', 1_000, 20),
  // Bought here again (sold too, selling it all), and in the IRA: only the IRA's makes it a wash sale.
  trade('b', 'ABC', '2026-09-20', 'buy', 30, 1),
  trade('r', 'ABC', '2026-09-10', 'buy', 30, 1),
];
const securities: Security[] = [{ ticker: 'ABC', name: 'ABC Corp', type: 'Common Stock' }];
const build = (list = trades, today = TODAY) => buildPortfolio([...buildAllHoldings(accounts, list, [vti, abc], securities).values()], today)!;

describe('short- and long-term', () => {
  it('is long-term from the day after a year has passed', () => {
    expect(longTermOn('2025-10-13')).toBe('2026-10-14');
    expect(longTermOn('2024-02-29')).toBe('2025-03-01');
    expect([termOn('2025-10-13', '2026-10-13'), termOn('2025-10-13', '2026-10-14')]).toEqual(['short', 'long']);
    // An import's start was bought on or before its day: not known until a year after it.
    expect([termOn('2026-11-06', '2027-01-01', true), termOn('2026-11-06', '2027-11-07', true)]).toEqual(['unknown', 'long']);
  });

  it('splits what’s held and what was sold by term, in taxable accounts only', () => {
    const p = build();
    const lots = openLots(p, accounts, TODAY);
    // The IRA's aren't here; the first purchase has 5 shares left.
    expect(lots.filter((l) => l.ticker === 'VTI').map((l) => [l.acquired, l.shares, l.cost, l.gain, l.term])).toEqual([
      ['2025-06-10', 5, 50_000, 10_000, 'long'],
      ['2025-10-13', 5, 50_000, 10_000, 'short'],
      ['2026-03-02', 5, 55_000, 5_000, 'short'],
    ]);
    expect(realizedBetween(p, accounts, '2026-01-01', TODAY)).toEqual({ shortGain: 2_000, longGain: 6_000, unknownGain: 0, proceeds: 58_000, sales: 2 });
    expect(unrealized(lots.filter((l) => l.ticker === 'VTI'))).toEqual({ shortGain: 15_000, longGain: 10_000, unknownGain: 0 });
    expect(turningLongTerm(lots, 30)).toEqual([
      { account: accounts[0], ticker: 'VTI', acquired: '2025-10-13', on: '2026-10-14', days: 15, shares: 5, gain: 10_000 },
    ]);
  });

  it('counts an import’s starting shares as bought on or before its day', () => {
    const imported = [
      trade('b', 'VTI', '2026-03-02', 'buy', 550, 5, { basis: 40_000, opening: true, source: 'import' }),
      trade('b', 'VTI', '2026-09-15', 'sell', 120, 1),
    ];
    const p = build(imported);
    expect(openLots(p, accounts, TODAY).map((l) => [l.shares, l.cost, l.term])).toEqual([[4, 32_000, 'unknown']]);
    expect(realizedBetween(p, accounts, '2026-01-01', TODAY)).toMatchObject({ shortGain: 0, longGain: 0, unknownGain: 12_000 - 8_000 });
  });

  it('finds losses, and a purchase in another account that would make one a wash sale', () => {
    const p = build();
    const lots = openLots(p, accounts, TODAY);
    const [h] = harvestable(p, accounts, lots, TODAY);
    expect(h).toMatchObject({ ticker: 'ABC', cost: 103_000, value: 63_000, loss: 40_000, shortLoss: 40_000 });
    expect(h.washBuy).toEqual({ date: '2026-09-10', account: accounts[1], reinvested: false, clearOn: '2026-10-11' });
    // A month on, that purchase is too long ago.
    expect(
      harvestable(build(trades, '2026-10-11'), accounts, openLots(build(trades, '2026-10-11'), accounts, '2026-10-11'), '2026-10-11')[0].washBuy,
    ).toBeUndefined();
  });
});

describe('where prices stand', () => {
  it('knows the high and low of the last year, and the 200-day average', () => {
    const spy = series('SPY', '2025-06-02', '2026-09-28', (d) => (d < '2026-07-15' ? 600 : d === '2026-07-15' ? 700 : d < '2026-09-28' ? 650 : 630));
    const t = trendOf(spy)!;
    expect(t).toMatchObject({ date: '2026-09-28', price: 630, high: 700, highDate: '2026-07-15', low: 600, lowDate: '2026-07-14', fullYear: true });
    expect(t.fromHigh).toBeCloseTo(0.1, 9);
    expect([moodOf(t), fromHighText(t)]).toEqual(['correction', '10% below its high']);
    const last200 = spy.close.slice(-200);
    expect(t.avg200).toBeCloseTo(last200.reduce((s, x) => s + x, 0) / 200, 9);
    expect([0, 0.03, 0.07, 0.25].map((fromHigh) => moodOf({ fromHigh }))).toEqual(['high', 'near', 'pullback', 'bear']);
    // Prices since June only: no 200-day average, and the high is since then.
    const recent = trendOf(series('NEW', '2026-06-01', '2026-09-28', () => 10))!;
    expect([recent.fullYear, recent.since, recent.avg200]).toEqual([false, '2026-06-01', undefined]);
  });
});

describe('worth a look', () => {
  it('says what turns long-term soon, what’s below what you paid, where a lot rides on one company, and how far it’s fallen', () => {
    const p = build();
    const found = portfolioInsights({ p, accounts, securities: new Map(securities.map((s) => [s.ticker, s])), hasTarget: false, today: TODAY });
    expect(found.map((i) => [i.kind, i.title, i.soon ?? false])).toEqual([
      ['long-term', 'VTI turns long-term Oct 14', false],
      ['loss', 'ABC is $400 below what you paid', false],
      ['concentration', 'ABC is 24% of your investments', false],
      ['below-high', 'ABC is 40% below its high', false],
    ]);
    expect(found[0].detail).toBe('The shares bought Oct 13, 2025 in Brokerage: sold from Oct 14 on, their $100 gain is taxed at the lower long-term rate.');
    expect(found[1].detail).toBe(
      'In Brokerage, all short-term. A realized loss offsets gains, then up to $3,000 a year of other income. Bought in Roth IRA Sep 10: sold at a loss before Oct 11, it’s a wash sale and the loss can’t be claimed.',
    );
    expect(found[3].detail).toBe('$50.00 on May 29, $30.00 at the close Sep 28. Where it’s been, not where it’s going.');
    // Two weeks out, it can go on Today; in December, so can a loss.
    const soon = portfolioInsights({ p: build(trades, '2026-10-01'), accounts, securities: new Map(), hasTarget: false, today: '2026-10-01' });
    expect(soon.find((i) => i.kind === 'long-term')?.soon).toBe(true);
    const dec = portfolioInsights({ p: build(trades, '2026-12-01'), accounts, securities: new Map(), hasTarget: false, today: '2026-12-01' });
    expect(dec.find((i) => i.kind === 'loss')).toMatchObject({ soon: true });
    expect(dec.find((i) => i.kind === 'loss')!.detail).toContain('Sold by Dec 31, it counts for 2026.');
  });

  it('notes a lot of cash, unless a target mix plans for it', () => {
    const cashy = [acct('b', 'brokerage', 'Brokerage'), acct('r', 'roth-ira')];
    cashy[0].cash = { amount: 500_000, date: TODAY };
    const p = buildPortfolio([...buildAllHoldings(cashy, [trade('b', 'VTI', '2026-03-02', 'buy', 550, 5)], [vti], []).values()], TODAY)!;
    const args = { p, accounts: cashy, securities: new Map<string, Security>(), today: TODAY };
    expect(portfolioInsights({ ...args, hasTarget: false }).map((i) => [i.title, i.detail])).toEqual([
      ['89% of your investments is cash', '$5,000 of $5,600, as cash or money market funds. If that’s on purpose, a target mix with cash in it says so.'],
    ]);
    expect(portfolioInsights({ ...args, hasTarget: true })).toEqual([]);
  });
});

describe('the year in review', () => {
  it('has a card for investments: the gain beyond money put in, and the S&P 500’s', () => {
    const holdings = buildAllHoldings(accounts, trades, [vti, abc], securities);
    const spy = series('SPY', '2025-06-02', '2026-09-28', (d) => (d < '2026-01-01' ? 500 : 550));
    const recap = (withSpy: boolean) =>
      buildRecap({
        period: yearPeriod(2026, TODAY),
        txns: [],
        accounts,
        book: makeBook(accounts, [], [], holdings),
        categories: [],
        recurring: [],
        budgets: [],
        goals: [],
        ...(withSpy ? { spy } : {}),
      });
    const r = recap(true);
    // $1,650 at the start, $1,270 more put in, $2,700 at the end: ABC's $400 drop outweighs VTI's $180 rise.
    expect(r.investments).toMatchObject({ value: 270_000, gain: -22_000, dividends: 0 });
    expect(r.investments!.pct).toBeLessThan(0);
    expect(r.investments!.sp).toBeCloseTo(0.1, 9);
    const card = recapCards(r, new Map()).find((c) => c.key === 'investments')!;
    expect([card.big, card.sub]).toEqual(['−$220', `−${Math.abs(r.investments!.pct! * 100).toFixed(1)}% this year · the S&P 500: +10.0%`]);
    expect(card.lines![0]).toContain('Worth $2,700 on');
    // Without the S&P 500's prices, no comparison.
    expect(recap(false).investments!.sp).toBeUndefined();
  });
});
