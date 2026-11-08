/**
 * Twelve Data (twelvedata.com): the price service. It's called straight from this phone with your own
 * free key; only ticker symbols are sent, never amounts or accounts. The free plan allows 8 requests a
 * minute and 800 a day (priceSync.ts keeps under them).
 */
import type { ISODate } from '../types';
import type { Bar } from './prices';

export const TWELVE_DATA_KEY = 'twelveDataKey';
const BASE = 'https://api.twelvedata.com';

export type PriceErrorKind = 'key' | 'limit' | 'plan' | 'symbol' | 'network' | 'other';

export class PriceError extends Error {
  constructor(
    readonly kind: PriceErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** What each problem means for you, in a line. */
export const PRICE_PROBLEMS: Record<PriceErrorKind, string> = {
  key: 'Twelve Data didn’t accept the key. Check it in Settings → Stock Prices.',
  limit: 'The free plan’s request limit was reached. Prices update again shortly.',
  plan: 'Twelve Data’s free plan doesn’t include this one. You can type its price yourself.',
  symbol: 'Twelve Data doesn’t know this ticker. You can type its price yourself.',
  network: 'Couldn’t reach Twelve Data. Prices update when you’re back online.',
  other: 'Twelve Data couldn’t send prices for this one.',
};

/** What an error means for you, in a line. */
export function explainPriceError(e: unknown): string {
  if (!(e instanceof PriceError)) return 'Something went wrong getting prices.';
  return e.kind === 'other' && e.message ? e.message.replace(/\*\*/g, '') : PRICE_PROBLEMS[e.kind];
}

async function call(path: string, params: Record<string, string | number>, key?: string): Promise<any> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (key) q.set('apikey', key);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${q}`);
  } catch {
    throw new PriceError('network', 'offline');
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new PriceError(res.ok ? 'other' : 'network', `Unexpected reply (${res.status})`);
  }
  const code = body?.status === 'error' ? Number(body.code) || res.status : res.ok ? 0 : res.status;
  if (!code) return body;
  const message = String(body?.message ?? '');
  if (code === 401) throw new PriceError('key', message);
  if (code === 429) throw new PriceError('limit', message);
  if (code === 403) throw new PriceError('plan', message);
  if (code === 400 || code === 404) throw new PriceError(/symbol|not found|invalid/i.test(message) ? 'symbol' : 'other', message);
  throw new PriceError('other', message);
}

export interface SeriesMeta {
  type?: string;
  exchange?: string;
  currency?: string;
}

/** The most days one request brings (about 20 years). */
export const MAX_DAYS = 5000;

/**
 * Daily closes from `from` on, oldest first (1 request). `adjust`: 'none' as traded, 'splits' (the
 * default) for later splits, 'all' for splits and dividends. `more`: there are later days than these.
 */
export async function fetchDaily(
  ticker: string,
  from: ISODate,
  key: string,
  adjust: 'none' | 'splits' | 'all',
): Promise<{ bars: Bar[]; meta: SeriesMeta; more: boolean }> {
  const body = await call('/time_series', { symbol: ticker, interval: '1day', start_date: from, outputsize: MAX_DAYS, order: 'ASC', adjust }, key);
  const values = body.values ?? [];
  const bars: Bar[] = values
    .map((v: { datetime: string; close: string }) => ({ date: String(v.datetime).slice(0, 10), close: Number(v.close) }))
    .filter((b: Bar) => Number.isFinite(b.close) && b.close > 0);
  return { bars, meta: { type: body.meta?.type, exchange: body.meta?.exchange, currency: body.meta?.currency }, more: values.length >= MAX_DAYS };
}

/** Checks a key, and how much of today's allowance is used (1 request). */
export async function fetchUsage(key: string): Promise<{ used?: number; limit?: number }> {
  const body = await call('/api_usage', {}, key);
  const n = (x: unknown) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : undefined);
  return { used: n(body.daily_usage), limit: n(body.plan_daily_limit) };
}

export interface TickerMatch {
  ticker: string;
  name: string;
  type: string;
  exchange: string;
}

/** Tickers matching what you typed: US listings the free plan covers, best match first (needs no key). */
export async function searchTickers(text: string): Promise<TickerMatch[]> {
  const body = await call('/symbol_search', { symbol: text.trim(), outputsize: 30, show_plan: 'true' });
  const seen = new Set<string>();
  const out: TickerMatch[] = [];
  for (const d of body.data ?? []) {
    if (d.country !== 'United States' || d.access?.plan !== 'Basic' || seen.has(d.symbol)) continue;
    seen.add(d.symbol);
    out.push({ ticker: d.symbol, name: d.instrument_name, type: d.instrument_type, exchange: d.exchange });
  }
  return out.slice(0, 8);
}
