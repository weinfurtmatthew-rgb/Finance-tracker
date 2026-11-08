import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeOn,
  historyFrom,
  historyFromSeries,
  isFinalBar,
  mergeRecent,
  splitFactorAfter,
  tradedPriceOn,
  type Bar,
  type PriceHistory,
} from '../src/lib/prices';
import { explainPriceError, fetchDaily, PriceError, searchTickers } from '../src/lib/twelveData';
import {
  buildAllHoldings,
  buildPosition,
  cashOn,
  cashSteps,
  formatShares,
  holdingsValueOn,
  normalizeTicker,
  positionValueOn,
  sharesOn,
} from '../src/lib/holdings';
import { balanceOn, historyStart, makeBook, staleValued } from '../src/lib/networth';
import { isDue, lastCloseDay } from '../src/priceSync';
import { FinanceDB } from '../src/db';
import { exportBackup, restoreBackup } from '../src/lib/backup';
import type { Account, Security, Trade } from '../src/types';

const fixture = (adjust: string) => JSON.parse(readFileSync(new URL(`./fixtures/twelvedata/aapl-2020-${adjust}.json`, import.meta.url), 'utf8'));
const bars = (adjust: string): Bar[] => fixture(adjust).values.map((v: { datetime: string; close: string }) => ({ date: v.datetime, close: Number(v.close) }));
const aapl = historyFromSeries(
  'AAPL',
  { raw: bars('none'), splitAdjusted: bars('splits'), all: bars('all') },
  { from: '2020-02-01', fetchedAt: Date.parse('2020-09-05'), type: fixture('splits').meta.type },
);

const acct = (id: string, type: Account['type'], extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type,
  institution: '',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
  ...extra,
});
let n = 0;
const trade = (t: Partial<Trade> & Pick<Trade, 'date' | 'kind' | 'amount'>): Trade => ({
  id: `t${++n}`,
  accountId: 'brk',
  ticker: 'AAPL',
  source: 'manual',
  createdAt: n,
  ...t,
});

/** A made-up history: a close each weekday, with optional splits and dividends worked into the three series. */
function synthetic(
  ticker: string,
  closes: [string, number][],
  opts: { splits?: [string, number][]; dividends?: [string, number][]; fetchedAt?: number } = {},
): PriceHistory {
  // `closes` are as traded. Later splits divide earlier prices; later dividends scale them by P/(P+D).
  const raw = closes.map(([date, close]) => ({ date, close }));
  const splitAdjusted = raw.map((b) => ({ date: b.date, close: b.close / (opts.splits ?? []).reduce((f, [d, x]) => (d > b.date ? f * x : f), 1) }));
  const all = splitAdjusted.map((b, i) => {
    let f = 1;
    for (const [d, amount] of opts.dividends ?? []) {
      if (d <= b.date) continue;
      const j = splitAdjusted.findIndex((x) => x.date === d);
      const prev = splitAdjusted[j - 1].close;
      f *= prev / (prev + amount);
    }
    return { date: b.date, close: splitAdjusted[i].close * f };
  });
  return historyFromSeries(ticker, { raw, splitAdjusted, all }, { from: closes[0][0], fetchedAt: opts.fetchedAt ?? Date.parse('2030-01-01') });
}

describe('prices from Twelve Data', () => {
  it('finds splits and dividends in three ways of adjusting the same closes', () => {
    // Apple's 4-for-1 split on Aug 31, 2020, and its dividends that year, in today's shares ($0.77 before the split = $0.1925).
    expect(aapl.splits).toEqual([{ date: '2020-08-31', factor: 4 }]);
    expect(aapl.dividends).toEqual([
      { date: '2020-02-07', amount: 0.1925 },
      { date: '2020-05-08', amount: 0.205 },
      { date: '2020-08-07', amount: 0.205 },
    ]);
    expect(aapl.type).toBe('Common Stock');
    // In today's shares a pre-split close is a quarter of what it traded at.
    const raw = new Map(bars('none').map((b) => [b.date, b.close]));
    expect(closeOn(aapl, '2020-03-02')! * 4).toBeCloseTo(raw.get('2020-03-02')!, 6);
    expect(tradedPriceOn(aapl, '2020-03-02')).toBeCloseTo(raw.get('2020-03-02')!, 6);
    expect(tradedPriceOn(aapl, '2020-09-01')).toBeCloseTo(raw.get('2020-09-01')!, 6);
    expect(splitFactorAfter(aapl, '2020-08-28')).toBe(4);
    expect(splitFactorAfter(aapl, '2020-08-31')).toBe(1);
    // A weekend uses Friday's close.
    expect(closeOn(aapl, '2020-03-01')).toBe(closeOn(aapl, '2020-02-28'));
  });

  it('reads the price service’s replies, and what its errors mean', async () => {
    const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', reply(fixture('splits')));
    const { bars: got, meta } = await fetchDaily('AAPL', '2020-02-01', 'k', 'splits');
    expect(got[0]).toEqual({ date: '2020-02-03', close: bars('splits')[0].close });
    expect(meta).toEqual({ type: 'Common Stock', exchange: 'NASDAQ', currency: 'USD' });
    const url = new URL(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ symbol: 'AAPL', start_date: '2020-02-01', adjust: 'splits', apikey: 'k', order: 'ASC' });

    const fails = async (body: unknown, status = 200) => {
      vi.stubGlobal('fetch', reply(body, status));
      return fetchDaily('X', '2020-01-01', 'k', 'all').catch((e: PriceError) => e.kind);
    };
    expect(await fails({ code: 401, message: '**apikey** parameter is incorrect', status: 'error' })).toBe('key');
    expect(await fails({ code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' })).toBe('limit');
    expect(await fails({ code: 403, message: 'available exclusively with grow plan', status: 'error' })).toBe('plan');
    expect(await fails({ code: 404, message: '**symbol** not found: XYZ', status: 'error' })).toBe('symbol');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Load failed');
      }),
    );
    expect(await fetchDaily('X', '2020-01-01', 'k', 'all').catch((e: PriceError) => e.kind)).toBe('network');
    expect(explainPriceError(new PriceError('plan', ''))).toContain('free plan');
    expect(explainPriceError(new PriceError('other', '**symbol** is weird'))).toBe('symbol is weird');
  });

  it('searches US tickers the free plan has', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  symbol: 'VTI',
                  instrument_name: 'Vanguard Total Stock Market Index Fund ETF',
                  exchange: 'NYSE',
                  instrument_type: 'ETF',
                  country: 'United States',
                  access: { plan: 'Basic' },
                },
                {
                  symbol: 'VTI',
                  instrument_name: 'Vanguard Total Stock Market',
                  exchange: 'BMV',
                  instrument_type: 'ETF',
                  country: 'Mexico',
                  access: { plan: 'Pro' },
                },
                {
                  symbol: 'VTIP',
                  instrument_name: 'Vanguard Short-Term Inflation-Protected',
                  exchange: 'NASDAQ',
                  instrument_type: 'ETF',
                  country: 'United States',
                  access: { plan: 'Grow' },
                },
              ],
            }),
          ),
      ),
    );
    expect(await searchTickers(' vti ')).toEqual([{ ticker: 'VTI', name: 'Vanguard Total Stock Market Index Fund ETF', type: 'ETF', exchange: 'NYSE' }]);
    // No key: searching doesn't use up your requests.
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('apikey');
  });

  it('adds the latest days, and asks for everything again after a split or dividend', () => {
    const h = synthetic('VTI', [
      ['2026-09-21', 100],
      ['2026-09-22', 101],
      ['2026-09-23', 102],
    ]);
    const merged = mergeRecent(
      { ...h, fetchedAt: Date.parse('2026-09-24T01:00:00Z') },
      [
        { date: '2026-09-22', close: 101 },
        { date: '2026-09-23', close: 102 },
        { date: '2026-09-24', close: 103 },
      ],
      Date.parse('2026-09-25T01:00:00Z'),
    )!;
    expect(merged.dates.slice(-2)).toEqual(['2026-09-23', '2026-09-24']);
    expect(merged.close.at(-1)).toBe(103);
    // A dividend since: the days both have no longer agree.
    expect(mergeRecent(h, [{ date: '2026-09-22', close: 100.5 }], Date.now())).toBeNull();
    // A last day downloaded before the close is replaced, not compared.
    const early = { ...h, fetchedAt: Date.parse('2026-09-23T15:00:00Z') };
    expect(isFinalBar('2026-09-23', early.fetchedAt)).toBe(false);
    expect(
      mergeRecent(
        early,
        [
          { date: '2026-09-22', close: 101 },
          { date: '2026-09-23', close: 104 },
        ],
        Date.parse('2026-09-24T01:00:00Z'),
      )!.close.at(-1),
    ).toBe(104);
    expect(historyFrom('2018-05-01', '2026-09-29')).toBe('2018-04-24');
    expect(historyFrom('2026-06-01', '2026-09-29')).toBe('2025-08-18');
  });

  it('checks for new prices only when there can be some', () => {
    const at = (iso: string) => Date.parse(iso);
    // Friday's close is in: nothing new all weekend.
    const h = { ...synthetic('VTI', [['2026-09-25', 100]]), from: '2025-08-01', fetchedAt: at('2026-09-25T23:00:00Z') };
    expect(lastCloseDay(at('2026-09-27T15:00:00Z'))).toBe('2026-09-25');
    expect(isDue(h, '2025-08-18', at('2026-09-27T15:00:00Z'))).toBe(false);
    // Monday: during the day (every 4 hours) and after the close.
    expect(isDue(h, '2025-08-18', at('2026-09-28T16:00:00Z'))).toBe(true);
    expect(isDue({ ...h, checkedAt: at('2026-09-28T15:00:00Z') }, '2025-08-18', at('2026-09-28T16:00:00Z'))).toBe(false);
    expect(isDue(h, '2025-08-18', at('2026-09-28T23:00:00Z'))).toBe(true);
    // A purchase from before the prices start.
    expect(isDue({ ...h, checkedAt: Date.now() }, '2020-01-01', at('2026-09-27T15:00:00Z'))).toBe(true);
    expect(isDue(undefined, '2025-08-18', 0)).toBe(true);
    // One the price service doesn't have: asked about again a day later.
    const missing = { ...h, dates: [], close: [], total: [], checkedAt: at('2026-09-27T15:00:00Z') };
    expect(isDue(missing, '2025-08-18', at('2026-09-28T14:00:00Z'))).toBe(false);
    expect(isDue(missing, '2025-08-18', at('2026-09-28T16:00:00Z'))).toBe(true);
  });
});

describe('holdings', () => {
  it('works out shares from an amount and a day, through a split and reinvested dividends', () => {
    const buy = trade({ date: '2020-03-02', kind: 'buy', amount: 100_000 });
    const p = buildPosition({ accountId: 'brk', ticker: 'AAPL', trades: [buy], history: aapl, reinvest: true });
    const bought = 1000 / closeOn(aapl, '2020-03-02')!; // today's shares
    // May's and August's dividends (to the cent) bought more shares at the close on their ex-dates; February's came before the purchase.
    const mayCash = Math.round(0.205 * bought * 100);
    const may = mayCash / 100 / closeOn(aapl, '2020-05-08')!;
    const augCash = Math.round(0.205 * (bought + may) * 100);
    const aug = augCash / 100 / closeOn(aapl, '2020-08-07')!;
    expect(p.source).toBe('market');
    expect(p.shares).toBeCloseTo(bought + may + aug, 9);
    expect(p.paid.map((d) => d.date)).toEqual(['2020-05-08', '2020-08-07']);
    expect(p.dividends).toBe(mayCash + augCash);
    expect(p.cost).toBe(100_000 + p.dividends);
    expect(p.value).toBe(Math.round(p.shares! * aapl.close.at(-1)! * 100));
    expect(p.gain).toBe(p.value - p.cost);
    // Shares before the split count four times in today's shares, so nothing jumps on Aug 31.
    expect(sharesOn(p, '2020-08-28')).toBeCloseTo(sharesOn(p, '2020-08-31')!, 9);
    expect(positionValueOn(p, '2020-02-28')).toBe(0);
    expect(positionValueOn(p, '2020-03-02')).toBe(100_000);
  });

  it('takes shares as given, before a split, and dividends as cash when they’re paid out', () => {
    // 10 shares bought at $300 before the split are 40 of today's.
    const buy = trade({ date: '2020-03-02', kind: 'buy', amount: 300_000, shares: 10 });
    const p = buildPosition({ accountId: 'brk', ticker: 'AAPL', trades: [buy], history: aapl, reinvest: false });
    expect(p.shares).toBe(40);
    expect(p.flows).toEqual([
      { date: '2020-05-08', amount: 820 },
      { date: '2020-08-07', amount: 820 },
    ]);
    expect(p.cost).toBe(300_000);
  });

  it('sells the oldest shares first', () => {
    const h = synthetic('VTI', [
      ['2026-01-05', 100],
      ['2026-02-02', 150],
      ['2026-03-02', 200],
      ['2026-04-01', 180],
    ]);
    const trades = [
      trade({ ticker: 'VTI', date: '2026-01-05', kind: 'buy', amount: 100_000 }), // 10 at $100
      trade({ ticker: 'VTI', date: '2026-02-02', kind: 'buy', amount: 150_000 }), // 10 at $150
      trade({ ticker: 'VTI', date: '2026-03-02', kind: 'sell', amount: 300_000, shares: 15, cash: true }), // 15 at $200
    ];
    const p = buildPosition({ accountId: 'brk', ticker: 'VTI', trades, history: h, reinvest: true });
    expect(p.shares).toBeCloseTo(5, 9);
    // Cost of the 15 sold: 10 × $100 + 5 × $150.
    expect(p.realized).toBe(300_000 - 175_000);
    expect(p.cost).toBe(75_000);
    expect(p.value).toBe(90_000);
    expect(p.flows).toEqual([{ date: '2026-03-02', amount: 300_000 }]);
    // Selling it all, by amount: what's left is gone even if the amount is a little under (it sold during the day).
    const all = buildPosition({
      accountId: 'brk',
      ticker: 'VTI',
      trades: [...trades, trade({ ticker: 'VTI', date: '2026-04-01', kind: 'sell', amount: 89_000 })],
      history: h,
      reinvest: true,
    });
    expect([all.shares, all.value, all.cost]).toEqual([0, 0, 0]);
    // More than you have is noted, and only what you had counts.
    const over = buildPosition({
      accountId: 'brk',
      ticker: 'VTI',
      trades: [trades[0], trade({ ticker: 'VTI', date: '2026-02-02', kind: 'sell', amount: 300_000, shares: 20 })],
      history: h,
      reinvest: true,
    });
    expect(over).toMatchObject({ oversold: true, shares: 0, realized: 200_000 });
  });

  it('without prices: at prices you typed in or paid, or at what you put in', () => {
    const fund = 'FXAIX';
    const typed: Security = { ticker: fund, name: 'Fidelity 500 Index', manualPrices: [{ date: '2026-09-01', price: 220 }] };
    const withShares = [trade({ ticker: fund, date: '2026-06-01', kind: 'buy', amount: 200_000, shares: 10 })];
    const manual = buildPosition({ accountId: 'brk', ticker: fund, trades: withShares, security: typed, reinvest: true });
    expect(manual).toMatchObject({ source: 'manual', shares: 10, price: 220, priceDate: '2026-09-01', value: 220_000, cost: 200_000, gain: 20_000 });
    expect(positionValueOn(manual, '2026-07-01')).toBe(200_000); // at the price paid until the one you typed
    const unknown = buildPosition({
      accountId: 'brk',
      ticker: fund,
      trades: [
        trade({ ticker: fund, date: '2026-06-01', kind: 'buy', amount: 200_000 }),
        trade({ ticker: fund, date: '2026-07-01', kind: 'sell', amount: 50_000 }),
      ],
      reinvest: true,
    });
    expect(unknown).toMatchObject({ source: 'cost', value: 150_000, gain: 0 });
    expect(unknown.shares).toBeUndefined();
    expect(positionValueOn(unknown, '2026-06-15')).toBe(200_000);
  });

  it('keeps the account’s cash: what you entered, moved by trades and dividends', () => {
    const flows = [
      { date: '2026-02-01', amount: 50_000 }, // a sale kept as cash
      { date: '2026-03-01', amount: -20_000 }, // a buy from cash
      { date: '2026-05-01', amount: 1_000 }, // a dividend
    ];
    // $40,000 on Apr 1: earlier flows are undone going back, later ones added.
    const { steps, start } = cashSteps(flows, { amount: 40_000, date: '2026-04-01' });
    expect(start).toBe(10_000);
    expect(steps).toEqual({ dates: ['2026-02-01', '2026-03-01', '2026-05-01'], values: [60_000, 40_000, 41_000] });
    // Without one it starts at nothing, and a buy from more cash than there was is new money for the rest.
    expect(cashSteps([{ date: '2026-01-01', amount: -5_000 }, ...flows]).steps.values).toEqual([0, 50_000, 30_000, 31_000]);
  });

  it('gives an investment account its value from its holdings and cash, from its first trade on', () => {
    const h = synthetic('VTI', [
      ['2026-06-01', 200],
      ['2026-07-01', 210],
      ['2026-09-28', 250],
    ]);
    const brk = acct('brk', 'brokerage', { cash: { amount: 5_000, date: '2026-09-28' } });
    const roth = acct('roth', 'roth-ira');
    const trades = [
      trade({ accountId: 'brk', ticker: 'VTI', date: '2026-06-01', kind: 'buy', amount: 100_000 }),
      trade({ accountId: 'roth', ticker: 'VTI', date: '2026-07-01', kind: 'buy', amount: 21_000 }),
    ];
    const holdings = buildAllHoldings([brk, roth, acct('chk', 'checking')], trades, [h], []);
    expect([...holdings.keys()]).toEqual(['brk', 'roth']);
    const hs = holdings.get('brk')!;
    expect(holdingsValueOn(hs)).toBe(125_000 + 5_000);
    expect(cashOn(hs, '2026-01-01')).toBe(5_000);
    // A value you'd typed in before the first trade still counts then.
    const valuations = [
      { id: 'v1', accountId: 'brk', date: '2026-01-31', value: 80_000 },
      { id: 'v2', accountId: 'brk', date: '2026-08-01', value: 1 }, // from after the first trade: holdings win
    ];
    const book = makeBook([brk, roth], [], valuations, holdings);
    expect(balanceOn(book, brk)).toBe(130_000);
    expect(balanceOn(book, brk, '2026-03-01')).toBe(80_000);
    expect(balanceOn(book, brk, '2026-01-01')).toBe(0);
    expect(balanceOn(book, brk, '2026-07-15')).toBe(105_000 + 5_000);
    expect(balanceOn(book, roth)).toBe(25_000);
    expect(historyStart(book)).toBe('2026-01-31');
    // Prices keep it current: no "update its value" reminder.
    expect(staleValued(book, '2026-09-29')).toEqual([]);
    expect(staleValued(makeBook([brk], [], valuations), '2026-09-29').map((a) => a.id)).toEqual(['brk']);
  });

  it('writes shares and tickers the way people expect', () => {
    expect([formatShares(12.345678), formatShares(120), formatShares(0.00612345)]).toEqual(['12.3457', '120', '0.006123']);
    expect(normalizeTicker(' brk.b ')).toBe('BRK.B');
  });
});

describe('backups', () => {
  it('include trades and securities, but not downloaded prices or the price key', async () => {
    const db = new FinanceDB('stocks-backup');
    await db.open();
    await db.accounts.add(acct('brk', 'brokerage'));
    await db.trades.add(trade({ date: '2026-06-01', kind: 'buy', amount: 100_000 }));
    await db.securities.add({ ticker: 'AAPL', name: 'Apple Inc.' });
    await db.priceCache.put(aapl);
    await db.meta.put({ key: 'twelveDataKey', value: 'secret-key' });
    const text = await exportBackup(db);
    expect(text).not.toContain('secret-key');
    const json = JSON.parse(text);
    expect(json.version).toBe(5);
    expect(json.data.trades).toHaveLength(1);
    expect(json.data.securities).toEqual([{ ticker: 'AAPL', name: 'Apple Inc.' }]);
    expect(json.data.priceCache).toBeUndefined();
    // Restoring keeps this phone's key, and an older backup (no stocks) restores with none.
    const target = new FinanceDB('stocks-restore');
    await target.open();
    await target.meta.put({ key: 'twelveDataKey', value: 'mine' });
    await target.trades.add(trade({ date: '2026-01-01', kind: 'buy', amount: 1 }));
    await restoreBackup(target, text);
    expect(await target.trades.count()).toBe(1);
    expect((await target.meta.get('twelveDataKey'))?.value).toBe('mine');
    delete json.data.trades;
    delete json.data.securities;
    json.version = 4;
    await restoreBackup(target, JSON.stringify(json));
    expect(await target.trades.count()).toBe(0);
  });
});

afterEach(() => vi.unstubAllGlobals());
