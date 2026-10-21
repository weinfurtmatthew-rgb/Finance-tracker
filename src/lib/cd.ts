/**
 * Certificates of deposit (CDs): money left at a fixed yearly yield (APY) until a maturity date.
 *
 * A CD's value isn't the sum of its transactions, and it doesn't need updating by hand: the app grows
 * it at the APY from the deposit. Where the CD stood on a given day is kept as dated values (stored as
 * valuations): the deposit when a term started, and the value it renewed at. Between two of them the
 * value moves smoothly from one to the next; after the last one it grows at the APY until the CD
 * matures, then holds there until you say whether it renewed or you moved the money.
 */
import type { Account, Cents, ISODate, Valuation } from '../types';
import { dayInMonth, dayOfMonth, diffDays } from './dates';

/** The usual CD terms, in months. */
export const CD_TERMS = [3, 6, 9, 12, 18, 24, 36, 48, 60];

/** "6 months", "1 year", "18 months", "5 years". */
export const termLabel = (months: number) => (months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`);

/** How many days before maturity Today starts mentioning it. */
export const CD_NOTICE_DAYS = 14;

type CdTerms = Pick<Account, 'apy' | 'maturesOn' | 'interestPaidOut'>;

/** The day a term of `months` started on `start` ends: the same day of the month (or that month's last day). */
export function maturityDate(start: ISODate, months: number): ISODate {
  return dayInMonth(start, months, dayOfMonth(start));
}

/** The term in whole months when `end` is a standard term after `start`; null for any other date. */
export function termMonths(start: ISODate, end: ISODate): number | null {
  for (let m = 1; m <= 120; m++) if (maturityDate(start, m) === end) return m;
  return null;
}

/**
 * What the CD is worth at the end of `date`. `anchors` are its dated values, oldest first. Before the
 * first one (the deposit) it didn't exist yet, so it's worth nothing.
 */
export function cdValueOn(a: CdTerms, anchors: Valuation[], date: ISODate): Cents {
  if (!anchors.length || date < anchors[0].date) return 0;
  let i = anchors.length - 1;
  while (i > 0 && anchors[i].date > date) i--;
  const from = anchors[i];
  if (from.date === date) return from.value;
  const next = anchors[i + 1];
  if (next) {
    // Between two known values: the same steady growth that links them.
    if (from.value <= 0 || next.value <= 0) return from.value;
    const share = diffDays(from.date, date) / diffDays(from.date, next.date);
    return Math.round(from.value * Math.pow(next.value / from.value, share));
  }
  // After the last one: interest at the APY until the CD matures (none when it's paid out elsewhere).
  const rate = a.interestPaidOut ? 0 : (a.apy ?? 0);
  const until = a.maturesOn && a.maturesOn < date ? a.maturesOn : date;
  const days = diffDays(from.date, until);
  return days > 0 ? Math.round(from.value * Math.pow(1 + rate, days / 365)) : from.value;
}

/** What it will be worth the day it matures. */
export const cdMaturityValue = (a: CdTerms, anchors: Valuation[]): Cents | undefined => (a.maturesOn ? cdValueOn(a, anchors, a.maturesOn) : undefined);

export type CdStage = 'growing' | 'maturing' | 'matured';

/** Growing; maturing within the next two weeks; or matured (time to say whether it renewed). */
export function cdStage(a: Pick<Account, 'maturesOn'>, today: ISODate): CdStage | null {
  if (!a.maturesOn) return null;
  if (a.maturesOn <= today) return 'matured';
  return diffDays(today, a.maturesOn) <= CD_NOTICE_DAYS ? 'maturing' : 'growing';
}

/** "4.5% APY", "4.25% APY". */
export const apyLabel = (apy: number | undefined) => (apy == null ? '' : `${Math.round(apy * 10000) / 100}% APY`);
