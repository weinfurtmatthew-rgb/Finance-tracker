/**
 * Dividends from what you hold: what came in, what the next year brings at the same rate, when the next
 * ones are due, and the yield. Each payment is worked out on the shares held then (lib/holdings.ts).
 */
import type { Cents, ISODate } from '../types';
import { addDays, addMonths, diffDays, monthKey } from './dates';
import type { Position } from './holdings';
import type { Portfolio } from './portfolio';

export interface Payout {
  ticker: string;
  accountId: string;
  /** The ex-dividend date. */
  date: ISODate;
  amount: Cents;
  reinvested: boolean;
}

/** Every dividend received, oldest first. */
export function payouts(p: Portfolio): Payout[] {
  return p.accounts
    .flatMap((hs) =>
      hs.positions.flatMap((pos) =>
        pos.paid.map((d) => ({ ticker: pos.ticker, accountId: hs.accountId, date: d.date, amount: d.amount, reinvested: d.bought != null })),
      ),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type Every = 'monthly' | 'quarterly' | 'twice a year' | 'yearly';

export interface Outlook {
  ticker: string;
  shares: number;
  /** Per share over the last 12 months. */
  perShare: number;
  /** At that rate, on the shares held now. */
  yearly: Cents;
  /** Per share over the last 12 months, against today's price. */
  yield: number;
  every?: Every;
  /** When the next one likely goes ex, and about how much it is. */
  next?: { date: ISODate; amount: Cents };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** For each ticker held now that paid dividends in the last year: its rate, how often, and the next one. */
export function dividendOutlook(p: Portfolio, today: ISODate): Outlook[] {
  const byTicker = new Map<string, Position[]>();
  for (const hs of p.accounts)
    for (const pos of hs.positions) {
      if (!pos.history || !(pos.shares! > 0)) continue;
      const list = byTicker.get(pos.ticker);
      if (list) list.push(pos);
      else byTicker.set(pos.ticker, [pos]);
    }
  const yearAgo = addDays(today, -365);
  const out: Outlook[] = [];
  for (const [ticker, positions] of byTicker) {
    const h = positions[0].history!;
    const recent = h.dividends.filter((d) => d.date > yearAgo && d.date <= today);
    if (!recent.length) continue;
    const shares = positions.reduce((s, x) => s + x.shares!, 0);
    const perShare = recent.reduce((s, d) => s + d.amount, 0);
    const price = h.close[h.close.length - 1];
    const o: Outlook = { ticker, shares, perShare, yearly: Math.round(perShare * shares * 100), yield: perShare / price };
    const dates = h.dividends.slice(-5).map((d) => d.date);
    if (dates.length >= 2) {
      const gap = median(dates.slice(1).map((d, i) => diffDays(dates[i], d)));
      o.every = gap < 45 ? 'monthly' : gap < 120 ? 'quarterly' : gap < 240 ? 'twice a year' : 'yearly';
      let next = addDays(dates[dates.length - 1], Math.round(gap));
      while (next <= today) next = addDays(next, Math.round(gap));
      o.next = { date: next, amount: Math.round(recent[recent.length - 1].amount * shares * 100) };
    }
    out.push(o);
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

export interface DividendSummary {
  /** Received in the last 12 months, and how much of that was reinvested. */
  last12: Cents;
  reinvested12: Cents;
  /** The next 12 months at the same rate, on what's held now. */
  next12: Cents;
  /** That, against everything's value now. */
  yield: number | null;
  /** Received each of the last 12 months (this one last). */
  months: { key: string; amount: Cents }[];
  /** Likely in the next 3 months, soonest first. */
  upcoming: { ticker: string; date: ISODate; amount: Cents }[];
  outlook: Outlook[];
}

/** Dividends at a glance (null when nothing paid any). */
export function dividendSummary(p: Portfolio, today: ISODate, value: Cents): DividendSummary | null {
  const all = payouts(p);
  const outlook = dividendOutlook(p, today);
  if (!all.length && !outlook.length) return null;
  const yearAgo = addDays(today, -365);
  const recent = all.filter((d) => d.date > yearAgo && d.date <= today);
  const last12 = recent.reduce((s, d) => s + d.amount, 0);
  const next12 = outlook.reduce((s, o) => s + o.yearly, 0);
  const thisMonth = monthKey(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 11)).map((key) => ({
    key,
    amount: all.filter((d) => monthKey(d.date) === key).reduce((s, d) => s + d.amount, 0),
  }));
  const until = addDays(today, 92);
  const upcoming = outlook
    .filter((o) => o.next && o.next.date <= until)
    .map((o) => ({ ticker: o.ticker, ...o.next! }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    last12,
    reinvested12: recent.filter((d) => d.reinvested).reduce((s, d) => s + d.amount, 0),
    next12,
    yield: value > 0 && next12 > 0 ? next12 / value : null,
    months,
    upcoming,
    outlook,
  };
}
