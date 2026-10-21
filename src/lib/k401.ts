/**
 * 401(k)s and 403(b)s (and Roth 401(k)s): the yearly limit on what you put in, your employer's match,
 * and what a year adds up to.
 *
 * The value is entered by hand, like an investment's. What goes in isn't tracked line by line: it
 * leaves your paycheck before it reaches the bank. Instead you say once what share of your pay you
 * put in and how your employer matches it, and the year is worked out from your yearly pay.
 */
import type { Account, AccountType, Cents } from '../types';

export const K401_TYPES: AccountType[] = ['401k', 'roth-401k'];
export const is401k = (a: Pick<Account, 'type'>) => K401_TYPES.includes(a.type);

/**
 * What one person can put in across all their 401(k)s and 403(b)s in a year (the employer's match
 * doesn't count toward it). 50 and older can add the catch-up; from 2025, 60 to 63 a bigger one.
 */
const LIMITS: Record<number, { base: Cents; catchUp: Cents; catchUp60?: Cents }> = {
  2023: { base: 2_250_000, catchUp: 750_000 },
  2024: { base: 2_300_000, catchUp: 750_000 },
  2025: { base: 2_350_000, catchUp: 750_000, catchUp60: 1_125_000 },
  2026: { base: 2_450_000, catchUp: 800_000, catchUp60: 1_125_000 },
};
const LATEST = Math.max(...Object.keys(LIMITS).map(Number));

export interface K401Limit {
  limit: Cents;
  /** A catch-up is included. */
  catchUp: boolean;
  /** The IRS hasn't announced this year's limit yet; the latest known one is used. */
  estimated: boolean;
}

export function k401Limit(year: number, birthYear?: number): K401Limit {
  const l = LIMITS[Math.min(Math.max(year, 2023), LATEST)];
  // Your age by the end of the year.
  const age = birthYear != null ? year - birthYear : null;
  const extra = age == null || age < 50 ? 0 : age >= 60 && age <= 63 && l.catchUp60 ? l.catchUp60 : l.catchUp;
  return { limit: l.base + extra, catchUp: extra > 0, estimated: year > LATEST };
}

export type K401Settings = Pick<Account, 'contributionRate' | 'employerMatch' | 'employerMatchUpTo'>;

export interface K401Year {
  /** What you put in over the year at your contribution rate (it stops at the limit). */
  yours: Cents;
  /** What your employer adds. */
  match: Cents;
  /** The most your employer would add if you put in enough. */
  fullMatch: Cents;
  /** The share of your pay to put in for the full match (none when the match has no cap). */
  fullMatchAt: number | null;
  /** Your contribution rate would go past the yearly limit. */
  overLimit: boolean;
}

/** A year of one 401(k), from its settings and your yearly pay before taxes. */
export function k401Year(s: K401Settings, pay: Cents, limit: Cents): K401Year {
  const wanted = Math.round(pay * (s.contributionRate ?? 0));
  const yours = Math.min(wanted, limit);
  const rate = s.employerMatch ?? 0;
  // The match applies to what you put in, up to a share of your pay; without a cap, to all of it
  // (so there's no "full match" to miss).
  const capped = s.employerMatchUpTo != null;
  const cap = capped ? Math.min(limit, Math.round(pay * s.employerMatchUpTo!)) : yours;
  const match = Math.round(Math.min(yours, cap) * rate);
  return {
    yours,
    match,
    fullMatch: capped ? Math.round(cap * rate) : match,
    fullMatchAt: rate > 0 && capped ? s.employerMatchUpTo! : null,
    overLimit: wanted > limit,
  };
}

/** Free money left on the table: a match you'd get by putting in more. */
export const missedMatch = (y: K401Year) => Math.max(0, y.fullMatch - y.match);

export interface K401Totals {
  limit: K401Limit;
  /** Each 401(k) you've said you put money into. */
  plans: (K401Year & { account: Account })[];
  /** What you put in across them (the limit is for all of them together). */
  yours: Cents;
  match: Cents;
  /** Yours and your employers', a month. */
  monthly: Cents;
}

/** Your 401(k)s for a year; null without your pay or a 401(k) with a contribution rate. */
export function k401Totals(accounts: Account[], pay: Cents | undefined, year: number, birthYear?: number): K401Totals | null {
  const limit = k401Limit(year, birthYear);
  const plans = accounts.filter((a) => is401k(a) && !a.archived && a.contributionRate != null);
  if (!pay || pay <= 0 || !plans.length) return null;
  const years = plans.map((a) => ({ account: a, ...k401Year(a, pay, limit.limit) }));
  const yours = Math.min(
    limit.limit,
    years.reduce((s, y) => s + y.yours, 0),
  );
  const match = years.reduce((s, y) => s + y.match, 0);
  return { limit, plans: years, yours, match, monthly: Math.round((yours + match) / 12) };
}
