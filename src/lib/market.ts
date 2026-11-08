/**
 * Where prices stand: how far a holding (or the S&P 500) is from its high of the last year, and whether
 * it's above its average of the last 200 trading days. This is where prices have been, not where they're
 * going: no one knows that.
 */
import type { ISODate } from '../types';
import { addDays, dayInMonth, dayOfMonth } from './dates';
import { indexOn, type PriceHistory } from './prices';

export interface Trend {
  /** The latest close, and its day. */
  date: ISODate;
  price: number;
  high: number;
  highDate: ISODate;
  low: number;
  lowDate: ISODate;
  /** The first day those are from: a year before the latest close, or later when its prices start later. */
  since: ISODate;
  /** Its prices go back a year. */
  fullYear: boolean;
  /** How far below the high it is: 0.12 is 12% below, 0 at the high. */
  fromHigh: number;
  /** The average close of the last 200 trading days (with that many). */
  avg200?: number;
}

/** Trading days in the average. */
export const AVERAGE_DAYS = 200;

export function trendOf(h: PriceHistory | undefined): Trend | undefined {
  if (!h?.dates.length) return undefined;
  const n = h.dates.length;
  const date = h.dates[n - 1];
  const yearBack = dayInMonth(date, -12, dayOfMonth(date));
  const start = indexOn(h.dates, addDays(yearBack, -1)) + 1;
  let hi = start;
  let lo = start;
  for (let i = start; i < n; i++) {
    if (h.close[i] >= h.close[hi]) hi = i;
    if (h.close[i] <= h.close[lo]) lo = i;
  }
  const price = h.close[n - 1];
  let avg200: number | undefined;
  if (n >= AVERAGE_DAYS) {
    let sum = 0;
    for (let i = n - AVERAGE_DAYS; i < n; i++) sum += h.close[i];
    avg200 = sum / AVERAGE_DAYS;
  }
  return {
    date,
    price,
    high: h.close[hi],
    highDate: h.dates[hi],
    low: h.close[lo],
    lowDate: h.dates[lo],
    since: h.dates[start],
    fullYear: start > 0 || h.dates[0] <= addDays(yearBack, 7),
    fromHigh: h.close[hi] > 0 ? Math.max(0, 1 - price / h.close[hi]) : 0,
    ...(avg200 != null ? { avg200 } : {}),
  };
}

/** What a drop from a high is called. */
export type Mood = 'high' | 'near' | 'pullback' | 'correction' | 'bear';

/** Down 10% or more from a high is a correction, 20% or more a bear market (exactly 10% counts). */
export function moodOf(t: Pick<Trend, 'fromHigh'>): Mood {
  const x = Math.round(t.fromHigh * 1e6) / 1e6;
  if (x === 0) return 'high';
  if (x < 0.05) return 'near';
  if (x < 0.1) return 'pullback';
  if (x < 0.2) return 'correction';
  return 'bear';
}

export const MOOD_LABEL: Record<Mood, string> = {
  high: 'At its high',
  near: 'Near its high',
  pullback: 'A pullback',
  correction: 'A correction',
  bear: 'A bear market',
};

/** "3% below its high", "at its high": from the closes of the last year. */
export function fromHighText(t: Pick<Trend, 'fromHigh'>): string {
  const n = Math.round(t.fromHigh * 100);
  return moodOf(t) === 'high' ? 'at its high' : n === 0 ? 'just below its high' : `${n}% below its high`;
}
