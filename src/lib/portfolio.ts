/**
 * Your holdings across investment accounts, together: what they were worth each day, the money you put
 * in or took out, and how they did over a period, next to the S&P 500 (lib/holdings.ts for one account).
 *
 * A period's gain leaves out money you added or took out. Its percent is time-weighted: each day's change
 * on what was there the day before, chained, so adding money doesn't count as a return. The S&P 500 is
 * the same money on the same days in SPY, with its dividends reinvested.
 */
import type { Cents, ISODate } from '../types';
import { addDays, dayInMonth, dayOfMonth } from './dates';
import { holdingsValueOn, positionValueOn, type Holdings, type Position } from './holdings';
import { indexOn, type PriceHistory } from './prices';

/** The S&P 500, as the fund that follows it. */
export const BENCHMARK = 'SPY';

export type Period = '1d' | '1w' | '1m' | '6m' | 'ytd' | '1y' | 'all';

export const PERIODS: { value: Period; label: string; long: string }[] = [
  { value: '1d', label: '1D', long: 'today' },
  { value: '1w', label: '1W', long: 'this week' },
  { value: '1m', label: '1M', long: 'this month' },
  { value: '6m', label: '6M', long: 'in 6 months' },
  { value: 'ytd', label: 'YTD', long: 'this year' },
  { value: '1y', label: '1Y', long: 'in a year' },
  { value: 'all', label: 'All', long: 'since you started' },
];

export interface Portfolio {
  accounts: Holdings[];
  /** Every day something could change (trading days, trades, prices you typed), through today. */
  days: ISODate[];
  /** What it was all worth at the end of each day: holdings and the cash in those accounts. */
  values: Cents[];
  /** Money put in (+) or taken out (−) on each day. */
  flows: Cents[];
  /** The first trade. */
  first: ISODate;
  /** The latest close among the price service's prices, and the close before it. */
  priceDate?: ISODate;
  prevClose?: ISODate;
}

/** All accounts with holdings, together (null without any). */
export function buildPortfolio(accounts: Holdings[], today: ISODate): Portfolio | null {
  if (!accounts.length) return null;
  const first = accounts.reduce((m, hs) => (hs.first < m ? hs.first : m), accounts[0].first);
  const set = new Set<ISODate>([today]);
  const add = (d: ISODate) => d >= first && d <= today && set.add(d);
  let priceDate: ISODate | undefined;
  for (const hs of accounts) {
    for (const p of hs.positions) {
      p.steps.dates.forEach(add);
      p.points?.dates.forEach(add);
      if (p.history) {
        p.history.dates.forEach(add);
        const last = p.history.dates[p.history.dates.length - 1];
        if (!priceDate || last > priceDate) priceDate = last;
      }
    }
    hs.cash.dates.forEach(add);
    hs.external.forEach((f) => add(f.date));
  }
  const days = [...set].sort();
  // The close before the latest one, for today's change.
  let prevClose: ISODate | undefined;
  for (const hs of accounts)
    for (const pos of hs.positions) {
      const h = pos.history;
      const i = h && priceDate ? indexOn(h.dates, addDays(priceDate, -1)) : -1;
      if (i >= 0 && (!prevClose || h!.dates[i] > prevClose)) prevClose = h!.dates[i];
    }
  // An account counts from its first trade.
  const values = days.map((d) => accounts.reduce((s, hs) => (d < hs.first ? s : s + holdingsValueOn(hs, d)), 0));
  const byDay = new Map<ISODate, Cents>();
  for (const hs of accounts) for (const f of hs.external) if (f.date <= today) byDay.set(f.date, (byDay.get(f.date) ?? 0) + f.amount);
  return { accounts, days, values, flows: days.map((d) => byDay.get(d) ?? 0), first, ...(priceDate ? { priceDate } : {}), ...(prevClose ? { prevClose } : {}) };
}

/** What it was worth at the end of `date` (nothing before the first trade). */
export function valueOn(p: Portfolio, date: ISODate): Cents {
  const i = indexOn(p.days, date);
  return i >= 0 ? p.values[i] : 0;
}

/** The day a period's change is measured from (its end-of-day value is the starting point). */
export function periodStart(p: Portfolio, period: Period, today: ISODate): ISODate {
  const before = addDays(p.first, -1);
  let start: ISODate;
  // Today's change: since the close before the latest one.
  if (period === '1d') start = p.prevClose ?? addDays(today, -1);
  else if (period === '1w') start = addDays(today, -7);
  else if (period === '1m') start = dayInMonth(today, -1, dayOfMonth(today));
  else if (period === '6m') start = dayInMonth(today, -6, dayOfMonth(today));
  else if (period === 'ytd') start = `${Number(today.slice(0, 4)) - 1}-12-31`;
  else if (period === '1y') start = dayInMonth(today, -12, dayOfMonth(today));
  else start = before;
  return start < before ? before : start;
}

export interface PeriodResult {
  from: ISODate;
  startValue: Cents;
  endValue: Cents;
  /** Money put in during the period (taken out is negative). */
  added: Cents;
  /** The change that isn't money put in or taken out. */
  gain: Cents;
  /** Time-weighted, as a fraction (null when nothing was held). */
  pct: number | null;
  /** For a chart: the start, then each day after it. */
  dates: ISODate[];
  values: Cents[];
}

export function periodResult(p: Portfolio, from: ISODate): PeriodResult {
  const startValue = valueOn(p, from);
  const dates: ISODate[] = [from];
  const values: Cents[] = [startValue];
  let added = 0;
  let growth = 1;
  let held = false;
  let prev = startValue;
  for (let i = 0; i < p.days.length; i++) {
    if (p.days[i] <= from) continue;
    const v = p.values[i];
    const f = p.flows[i];
    added += f;
    // Each day's change on what was there the day before (money added that day isn't a return).
    if (prev > 0) {
      growth *= (v - f) / prev;
      held = true;
    }
    prev = v;
    dates.push(p.days[i]);
    values.push(v);
  }
  const endValue = values[values.length - 1];
  return { from, startValue, endValue, added, gain: endValue - startValue - added, pct: held ? growth - 1 : null, dates, values };
}

/** A day's total-return close (with dividends reinvested): the first one before the history starts. */
function totalOn(h: PriceHistory, date: ISODate): number {
  return h.total[Math.max(0, indexOn(h.dates, date))];
}

export interface BenchmarkResult {
  /** What the same money would be worth on each of the period's days. */
  values: Cents[];
  endValue: Cents;
  /** The S&P 500's return over the period, dividends included. */
  pct: number;
}

/** The same money, put in and taken out on the same days, in the S&P 500 (`spy`'s total-return closes). */
export function benchmarkResult(r: PeriodResult, p: Portfolio, spy: PriceHistory | undefined): BenchmarkResult | null {
  // From before the first trade, it starts when your money did: at that day's close.
  const base = r.from < p.first ? p.first : r.from;
  if (!spy?.dates.length || spy.dates[0] > base) return null;
  let units = r.startValue / totalOn(spy, r.from);
  const values = [r.startValue];
  const flowOn = new Map(p.days.map((d, i) => [d, p.flows[i]]));
  for (const d of r.dates.slice(1)) {
    const tr = totalOn(spy, d);
    units = Math.max(0, units + (flowOn.get(d) ?? 0) / tr);
    values.push(Math.round(units * tr));
  }
  const end = r.dates[r.dates.length - 1];
  return { values, endValue: values[values.length - 1], pct: totalOn(spy, end) / totalOn(spy, base) - 1 };
}

/**
 * The yearly return on your money since the first trade, counting when it went in and out (money-weighted).
 * Only from a year on: over less, a yearly rate says more than the numbers do.
 */
export function yearlyReturn(p: Portfolio, today: ISODate): number | null {
  const years = (d: ISODate) => (Date.parse(d) - Date.parse(p.first)) / (365.25 * 86_400_000);
  if (years(today) < 1) return null;
  const cash = p.days.map((d, i) => ({ t: years(d), amount: -p.flows[i] })).filter((c) => c.amount !== 0);
  cash.push({ t: years(today), amount: valueOn(p, today) });
  const npv = (r: number) => cash.reduce((s, c) => s + c.amount / Math.pow(1 + r, c.t), 0);
  // Bisection: the value falls as the rate rises when money goes in before it comes out.
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200 && hi - lo > 1e-7; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** One ticker across your accounts. */
export interface Holding {
  ticker: string;
  positions: Position[];
  value: Cents;
  cost: Cents;
  shares?: number;
  /** Its own return over the period (dividends included), from its first buy when that's later. */
  pct: number | null;
}

/** How a ticker did from `from` (or its first buy) to its latest price; null when it has no prices. */
function tickerReturn(positions: Position[], from: ISODate): number | null {
  const p = positions[0];
  const firstBuy = positions.reduce((m, x) => (x.first < m ? x.first : m), p.first);
  const start = from < firstBuy ? firstBuy : from;
  if (p.history) {
    const h = p.history;
    return h.total[h.total.length - 1] / totalOn(h, start) - 1;
  }
  if (p.points?.dates.length) {
    const i = indexOn(p.points.dates, start);
    const then = p.points.values[Math.max(0, i)];
    return p.points.values[p.points.values.length - 1] / then - 1;
  }
  return null;
}

/** Each ticker you hold now, biggest first. */
export function holdingsByTicker(p: Portfolio, from: ISODate): Holding[] {
  const map = new Map<string, Position[]>();
  for (const hs of p.accounts)
    for (const pos of hs.positions) {
      if (positionValueOn(pos) <= 0) continue;
      const list = map.get(pos.ticker);
      if (list) list.push(pos);
      else map.set(pos.ticker, [pos]);
    }
  return [...map]
    .map(([ticker, positions]) => {
      const known = positions.every((x) => x.shares != null);
      return {
        ticker,
        positions,
        value: positions.reduce((s, x) => s + x.value, 0),
        cost: positions.reduce((s, x) => s + x.cost, 0),
        ...(known ? { shares: positions.reduce((s, x) => s + x.shares!, 0) } : {}),
        pct: tickerReturn(positions, from),
      };
    })
    .sort((a, b) => b.value - a.value);
}
