/**
 * Numbers for the detail pages: a category's months, the places you spend there, a one-line highlight,
 * and a store's history.
 */
import type { Cents, ISODate, Transaction } from '../types';
import { lines } from './lines';
import { addMonths, monthKey } from './dates';

const money = (c: Cents) => `$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;

/** What you spent in one category in each of the given months (split parts count in their own category). */
export function categoryMonths(txns: Transaction[], categoryId: string, keys: string[]): Cents[] {
  const at = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const l of lines(txns)) {
    if (l.categoryId !== categoryId) continue;
    const i = at.get(monthKey(l.date));
    if (i != null) out[i] -= l.amount;
  }
  return out.map((v) => Math.max(0, v));
}

/** Twelve month keys ending with `month`. */
export const lastMonths = (month: string, n = 12) => Array.from({ length: n }, (_, i) => addMonths(month, i - (n - 1)));

/**
 * One sentence about the month in progress (the last value) against the months before it: the most or
 * least in a while, or how far it is from the average. `day`/`days` say how far into the month we are.
 */
export function categoryHighlight(name: string, values: Cents[], labels: string[], day: number, days: number): string | null {
  const before = values.slice(0, -1);
  const now = values[values.length - 1];
  const used = before.filter((v) => v > 0);
  if (used.length < 2) return null;
  const avg = used.reduce((s, v) => s + v, 0) / used.length;
  const early = day < days;
  let firstHigher = -1;
  for (let i = before.length - 1; i >= 0; i--) if (before[i] >= now) { firstHigher = i; break; }
  if (now > 0 && firstHigher === -1 && before.length >= 3) {
    return `${labels[labels.length - 1]} is already your priciest ${name.toLowerCase()} month in a year${early ? `, and it’s only day ${day}` : ''}.`;
  }
  if (now > 0 && firstHigher < before.length - 3) {
    return `${labels[labels.length - 1]} is your priciest ${name.toLowerCase()} month since ${labels[firstHigher]}${early ? `, and it’s only day ${day}` : ''}.`;
  }
  const pace = early ? (now / day) * days : now;
  const diff = pace - avg;
  if (Math.abs(diff) < Math.max(1000, avg * 0.1)) return `${name} is right around your usual ${money(avg)} a month.`;
  return early
    ? `At this pace ${name.toLowerCase()} lands near ${money(pace)} this month, ${diff > 0 ? `${money(diff)} over` : `${money(diff)} under`} your usual ${money(avg)}.`
    : `${name} came to ${money(now)}, ${diff > 0 ? `${money(diff)} more` : `${money(diff)} less`} than your usual ${money(avg)}.`;
}

export interface Place {
  /** The store as shown (the most recent spelling). */
  name: string;
  key: string;
  count: number;
  total: Cents;
}

/** A store's name for grouping: "Chipotle", "CHIPOTLE " and "chipotle" are one place. */
export const placeKey = (t: Pick<Transaction, 'payee' | 'description'>) => (t.payee || t.description).trim().toLowerCase();

/** Where the money in a category went over some dates, biggest first. */
export function topPlaces(txns: Transaction[], categoryId: string, from: ISODate, to: ISODate): Place[] {
  const m = new Map<string, Place>();
  for (const l of lines(txns)) {
    if (l.categoryId !== categoryId || l.date < from || l.date > to || l.amount >= 0) continue;
    const key = placeKey(l);
    const p = m.get(key) ?? { name: l.payee || l.description, key, count: 0, total: 0 };
    p.count++;
    p.total -= l.amount;
    m.set(key, p);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export interface PlaceStats {
  name: string;
  /** Every transaction at the place, newest first. */
  txns: Transaction[];
  /** Purchases (money out) this calendar year and in total. */
  yearTotal: Cents;
  yearCount: number;
  total: Cents;
  count: number;
  average: Cents;
  first: ISODate;
  last: ISODate;
  /** The category most of its purchases are in. */
  categoryId: string;
}

export function placeStats(txns: Transaction[], key: string, today: ISODate): PlaceStats | null {
  const mine = txns.filter((t) => placeKey(t) === key).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!mine.length) return null;
  const year = today.slice(0, 4);
  const buys = mine.filter((t) => t.amount < 0);
  const thisYear = buys.filter((t) => t.date.startsWith(year));
  const cats = new Map<string, number>();
  for (const t of mine) cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + 1);
  const total = buys.reduce((s, t) => s - t.amount, 0);
  return {
    name: mine[0].payee || mine[0].description,
    txns: mine,
    yearTotal: thisYear.reduce((s, t) => s - t.amount, 0),
    yearCount: thisYear.length,
    total,
    count: buys.length,
    average: buys.length ? Math.round(total / buys.length) : 0,
    first: mine[mine.length - 1].date,
    last: mine[0].date,
    categoryId: [...cats].sort((a, b) => b[1] - a[1])[0][0],
  };
}

/** A place's purchases in each of the given months. */
export function placeMonths(stats: PlaceStats, keys: string[]): Cents[] {
  const at = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const t of stats.txns) {
    const i = at.get(monthKey(t.date));
    if (i != null && t.amount < 0) out[i] -= t.amount;
  }
  return out;
}
