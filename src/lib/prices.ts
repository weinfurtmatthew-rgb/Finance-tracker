/**
 * Daily closing prices for stocks, ETFs and mutual funds, kept on this phone (fetched from Twelve Data
 * with your own free key; see lib/twelveData.ts and priceSync.ts).
 *
 * Twelve Data's free plan has no splits or dividends, so they're worked out from the prices themselves:
 * each day's close comes three ways (as it traded; adjusted for later splits; adjusted for later splits
 * and dividends), and a split or a dividend shows up as a step between two of them on its day.
 *
 * Prices here are in today's shares: a close from before a 4-for-1 split is a quarter of what it traded
 * at, so shares held then count four times. Dividends are per share in today's shares too.
 */
import type { ISODate } from '../types';
import { addDays } from './dates';

export interface Bar {
  date: ISODate;
  close: number;
}

export interface Split {
  date: ISODate;
  /** Shares after per share before: 4 for a 4-for-1 split, 0.1 for a 1-for-10 reverse split. */
  factor: number;
}

export interface Dividend {
  /** The ex-dividend date: you get it for shares held at the close the day before. */
  date: ISODate;
  /** Per share, in today's shares. */
  amount: number;
}

export interface PriceHistory {
  ticker: string;
  /** Trading days, oldest first. */
  dates: ISODate[];
  /** Each day's close, adjusted for later splits (in today's shares). */
  close: number[];
  /** Each day's close adjusted for later splits and dividends: its change is the total return. */
  total: number[];
  splits: Split[];
  dividends: Dividend[];
  /** The first day asked for, and when it was last downloaded (ms). */
  from: ISODate;
  fetchedAt: number;
  /** When a download was last tried (ms), whether or not it worked. */
  checkedAt?: number;
  /** "Common Stock", "ETF", "Mutual Fund"… as the price service names it. */
  type?: string;
  exchange?: string;
  currency?: string;
  /** Why the last download failed, if it did (the history stays usable). */
  error?: string;
}

/** Index of the last date <= `date`, or -1. */
export function indexOn(dates: ISODate[], date: ISODate): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** The close on `date` or the last trading day before it (in today's shares). */
export function closeOn(h: PriceHistory | undefined, date: ISODate): number | undefined {
  if (!h) return undefined;
  const i = indexOn(h.dates, date);
  return i >= 0 ? h.close[i] : undefined;
}

/** How many of today's shares one share bought on `date` is: the splits since. */
export function splitFactorAfter(h: Pick<PriceHistory, 'splits'> | undefined, date: ISODate): number {
  return (h?.splits ?? []).reduce((f, s) => (s.date > date ? f * s.factor : f), 1);
}

/** What it actually traded at on `date` (before later splits). */
export function tradedPriceOn(h: PriceHistory | undefined, date: ISODate): number | undefined {
  const c = closeOn(h, date);
  return c == null ? undefined : c * splitFactorAfter(h, date);
}

/** A split's factor as a tidy ratio: 4, 1.5, 0.1… (prices carry rounding). */
function tidyFactor(f: number): number {
  for (const q of [1, 2, 3, 4, 5, 8, 10, 20]) {
    const p = Math.round(f * q);
    if (p > 0 && Math.abs(p / q - f) / f < 0.004) return p / q;
    const r = Math.round(q / f);
    if (r > 0 && Math.abs(q / r - f) / f < 0.004) return q / r;
  }
  return Math.round(f * 10000) / 10000;
}

/**
 * A dividend per share as declared: almost always to 4 decimal places ($0.1925), which the adjusted
 * prices carry with a little rounding (0.192502). Others keep 6 ($0.032145).
 */
function tidyAmount(a: number): number {
  const four = Math.round(a * 1e4) / 1e4;
  return four > 0 && Math.abs(four - a) / a < 1e-4 ? four : Math.round(a * 1e6) / 1e6;
}

/** Steps smaller than this between two adjusted series are rounding, not a split or dividend. */
const SPLIT_STEP = 0.02;
const DIVIDEND_STEP = 0.00001;

/**
 * A history from the three ways a day's close comes: as traded (`raw`), adjusted for splits
 * (`splitAdjusted`) and adjusted for splits and dividends (`all`). Days missing from any of them are left
 * out.
 */
export function historyFromSeries(
  ticker: string,
  series: { raw: Bar[]; splitAdjusted: Bar[]; all: Bar[] },
  info: { from: ISODate; fetchedAt: number; type?: string; exchange?: string; currency?: string },
): PriceHistory {
  const raw = new Map(series.raw.map((b) => [b.date, b.close]));
  const all = new Map(series.all.map((b) => [b.date, b.close]));
  const days = series.splitAdjusted.filter((b) => raw.has(b.date) && all.has(b.date) && b.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const splits: Split[] = [];
  const dividends: Dividend[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];
    // A split changes how many of today's shares one traded share is.
    const before = raw.get(prev.date)! / prev.close;
    const after = raw.get(cur.date)! / cur.close;
    const split = before / after;
    if (Math.abs(split - 1) > SPLIT_STEP) splits.push({ date: cur.date, factor: tidyFactor(split) });
    // A dividend scales every earlier close by close / (close + dividend), the day before it goes ex.
    const was = all.get(prev.date)! / prev.close;
    const now = all.get(cur.date)! / cur.close;
    if (now / was - 1 > DIVIDEND_STEP) {
      const amount = tidyAmount(prev.close * (now / was - 1));
      if (amount > 0) dividends.push({ date: cur.date, amount });
    }
  }
  return {
    ticker,
    dates: days.map((b) => b.date),
    close: days.map((b) => b.close),
    total: days.map((b) => all.get(b.date)!),
    splits,
    dividends,
    from: info.from,
    fetchedAt: info.fetchedAt,
    ...(info.type ? { type: info.type } : {}),
    ...(info.exchange ? { exchange: info.exchange } : {}),
    ...(info.currency ? { currency: info.currency } : {}),
  };
}

/**
 * A day's bar is final once the market has closed and settled (about 6pm New York time): before that,
 * today's "close" is the latest price, and it changes.
 */
export const isFinalBar = (date: ISODate, fetchedAt: number) => fetchedAt >= Date.parse(`${date}T22:00:00Z`);

/**
 * Adds the latest days (closes adjusted for splits and dividends, as `all`) to a history. Returns null
 * when the history has to be downloaded again: a split or dividend since rescales every earlier close,
 * so the days both have no longer agree (or they don't overlap at all).
 */
export function mergeRecent(h: PriceHistory, recent: Bar[], fetchedAt: number): PriceHistory | null {
  let keep = h.dates.length;
  // A last day downloaded before the market closed is replaced, not compared.
  if (keep && !isFinalBar(h.dates[keep - 1], h.fetchedAt)) keep--;
  if (!keep) return null;
  const lastKept = h.dates[keep - 1];
  const sorted = [...recent].sort((a, b) => (a.date < b.date ? -1 : 1));
  let overlap = 0;
  for (const b of sorted) {
    if (b.date > lastKept) continue;
    const i = indexOn(h.dates, b.date);
    if (i < 0 || h.dates[i] !== b.date) continue;
    overlap++;
    if (Math.abs(b.close / h.total[i] - 1) > 1e-4) return null;
  }
  if (!overlap) return null;
  // Days after the last one kept: no split or dividend since (or the overlap would differ), so the
  // three ways of adjusting them agree.
  const added = sorted.filter((b) => b.date > lastKept && b.close > 0);
  return {
    ...h,
    dates: [...h.dates.slice(0, keep), ...added.map((b) => b.date)],
    close: [...h.close.slice(0, keep), ...added.map((b) => b.close)],
    total: [...h.total.slice(0, keep), ...added.map((b) => b.close)],
    fetchedAt,
    error: undefined,
  };
}

/** The first day a history needs: a year before today at least (for 52-week and trend figures), and a week before the first purchase. */
export function historyFrom(firstTrade: ISODate | undefined, today: ISODate): ISODate {
  const yearBack = addDays(today, -400);
  const start = firstTrade && firstTrade < yearBack ? firstTrade : yearBack;
  return addDays(start, -7);
}
