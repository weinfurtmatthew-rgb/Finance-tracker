import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { syncPrices } from '../src/priceSync';
import { TWELVE_DATA_KEY } from '../src/lib/twelveData';
import type { Trade } from '../src/types';

// No minute passes in a test: lift the per-minute limit (as the browser tests do).
(globalThis as { __financePriceLimits?: unknown }).__financePriceLimits = { perMinute: 1000 };

/** Weekdays from `from` through `to`. */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The price service, with the same closes for each of `tickers` (no splits or dividends: the three ways agree). */
function serve(tickers: string[], days: string[]) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      const url = new URL(u);
      calls.push(url);
      const reply = (body: unknown) => new Response(JSON.stringify(body));
      if (url.searchParams.get('apikey') !== 'k') return reply({ code: 401, message: '**apikey** parameter is incorrect', status: 'error' });
      if (!tickers.includes(url.searchParams.get('symbol')!)) return reply({ code: 404, message: '**symbol** not found', status: 'error' });
      const from = url.searchParams.get('start_date')!;
      const values = days
        .map((d, i) => ({ datetime: d, close: (100 + i / 100).toFixed(5) }))
        .filter((v) => v.datetime >= from)
        .slice(0, Number(url.searchParams.get('outputsize')));
      return reply({ meta: { symbol: url.searchParams.get('symbol'), type: 'ETF' }, values, status: 'ok' });
    }),
  );
  return calls;
}

const trade = (ticker: string, date: string): Trade => ({
  id: `${ticker}-${date}`,
  accountId: 'a',
  ticker,
  date,
  kind: 'buy',
  amount: 100_000,
  source: 'manual',
  createdAt: 0,
});

beforeEach(async () => {
  await Promise.all([db.trades.clear(), db.priceCache.clear(), db.meta.clear()]);
  await db.meta.put({ key: TWELVE_DATA_KEY, value: 'k' });
});
afterEach(() => vi.unstubAllGlobals());

describe('updating prices', () => {
  it('downloads a ticker’s closes once, three ways, in pages for a purchase over 20 years ago, then the S&P 500’s', async () => {
    const days = weekdays('1999-01-04', '2026-09-28');
    const calls = serve(['VFINX', 'SPY'], days);
    await db.trades.add(trade('VFINX', '2000-01-03'));
    await syncPrices();
    // About 7,000 days from Dec 27, 1999: two pages for each of the three, for each.
    const pages = ['none', 'none', 'splits', 'splits', 'all', 'all'];
    expect(calls.map((c) => [c.searchParams.get('symbol'), c.searchParams.get('adjust')])).toEqual([
      ...pages.map((a) => ['VFINX', a]),
      ...pages.map((a) => ['SPY', a]),
    ]);
    expect((await db.priceCache.get('SPY'))!.dates[0]).toBe('1999-12-27');
    const h = (await db.priceCache.get('VFINX'))!;
    expect(h.dates[0]).toBe('1999-12-27');
    expect(h.dates.at(-1)).toBe('2026-09-28');
    expect(new Set(h.dates).size).toBe(h.dates.length);
    expect(h.dates.length).toBe(days.filter((d) => d >= '1999-12-27').length);
    expect([h.splits, h.dividends, h.type]).toEqual([[], [], 'ETF']);
    // Just checked: nothing more to ask for.
    await syncPrices();
    expect(calls).toHaveLength(12);
  });

  it('remembers a ticker the price service doesn’t have, and stops at a key it doesn’t accept', async () => {
    const calls = serve(['VTI', 'SPY'], weekdays('2025-06-02', '2026-09-28'));
    await db.trades.bulkAdd([trade('NOPE', '2026-01-05'), trade('VTI', '2026-01-05')]);
    await syncPrices();
    expect(await db.priceCache.get('NOPE')).toMatchObject({ dates: [], error: 'symbol' });
    expect((await db.priceCache.get('VTI'))!.dates.length).toBeGreaterThan(200);
    const before = calls.length;
    await syncPrices();
    expect(calls).toHaveLength(before);

    // A key it turns down: the update stops, and isn't tried again on its own.
    await db.priceCache.clear();
    await db.meta.put({ key: TWELVE_DATA_KEY, value: 'wrong' });
    await syncPrices();
    expect(calls).toHaveLength(before + 1);
    await syncPrices();
    expect(calls).toHaveLength(before + 1);
    expect(await db.priceCache.count()).toBe(0);
  });
});
