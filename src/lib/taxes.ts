/**
 * Taxes on selling, for taxable (brokerage) accounts: IRAs and 401(k)s aren't taxed on sales. Shares
 * sold more than a year after they were bought are long-term, taxed at the lower long-term rates;
 * sooner, they're short-term, taxed like income. Sales use the oldest shares first (lib/holdings.ts).
 * Shares an import started with were bought on or before its day, so whether they're long-term isn't
 * known until a year after it.
 *
 * These are facts about your holdings, not advice: what's long-term, what isn't yet, and what selling
 * would realize.
 */
import type { Account, Cents, ISODate } from '../types';
import { addDays, dayInMonth, dayOfMonth, diffDays } from './dates';
import { formatMoney } from './money';
import type { Position } from './holdings';
import type { Portfolio } from './portfolio';

/** Sales here are taxed (IRAs and 401(k)s aren't). */
export const isTaxable = (a: Pick<Account, 'type'> | undefined) => a?.type === 'brokerage';

/** The first day shares bought on `acquired` are long-term: more than a year later. */
export const longTermOn = (acquired: ISODate): ISODate => addDays(dayInMonth(acquired, 12, dayOfMonth(acquired)), 1);

export type Term = 'short' | 'long' | 'unknown';

/** Shares bought on `acquired` (on or before it, for an import's start), sold or held on `on`. */
export const termOn = (acquired: ISODate, on: ISODate, opening = false): Term => (on >= longTermOn(acquired) ? 'long' : opening ? 'unknown' : 'short');

/** Positions in taxable accounts, with their account. */
function taxable(p: Portfolio, accounts: Account[]): { account: Account; pos: Position }[] {
  return p.accounts.flatMap((hs) => {
    const account = accounts.find((a) => a.id === hs.accountId);
    return isTaxable(account) ? hs.positions.map((pos) => ({ account: account!, pos })) : [];
  });
}

export interface OpenLot {
  account: Account;
  ticker: string;
  /** When it was bought (on or before, for an import's start). */
  acquired: ISODate;
  opening: boolean;
  /** Bought with a reinvested dividend. */
  dividend: boolean;
  shares: number;
  cost: Cents;
  value: Cents;
  gain: Cents;
  term: Term;
  /** The day it's long-term (at the latest, for an import's start), and how many days off that is (0 once it is). */
  longTermOn: ISODate;
  days: number;
}

/** A holding's purchases still held, at its latest price (oldest first; none when valued at what went in). */
export function lotsOf(account: Account, pos: Position, today: ISODate): OpenLot[] {
  if (pos.source === 'cost' || pos.price == null) return [];
  return pos.lots
    .filter((lot) => lot.shares > 0)
    .map((lot) => {
      const value = Math.round(lot.shares * pos.price! * 100);
      const on = longTermOn(lot.date);
      return {
        account,
        ticker: pos.ticker,
        acquired: lot.date,
        opening: !!lot.opening,
        dividend: !!lot.dividend,
        shares: lot.shares,
        cost: lot.cost,
        value,
        gain: value - lot.cost,
        term: termOn(lot.date, today, lot.opening),
        longTermOn: on,
        days: Math.max(0, diffDays(today, on)),
      };
    });
}

/** Every purchase still held in a taxable account, at the latest price (oldest first). */
export function openLots(p: Portfolio, accounts: Account[], today: ISODate): OpenLot[] {
  return taxable(p, accounts)
    .flatMap(({ account, pos }) => lotsOf(account, pos, today))
    .sort((a, b) => (a.acquired < b.acquired ? -1 : a.acquired > b.acquired ? 1 : 0));
}

/** Gains (losses negative) by term. */
export interface ByTerm {
  shortGain: Cents;
  longGain: Cents;
  /** From shares an import started with, before it's known. */
  unknownGain: Cents;
}

const signed = (c: Cents) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatMoney(Math.abs(c), { whole: true })}`;

/** "+$20 short-term · +$60 long-term" (what isn't zero). */
export const termText = (t: ByTerm): string =>
  [
    t.shortGain !== 0 && `${signed(t.shortGain)} short-term`,
    t.longGain !== 0 && `${signed(t.longGain)} long-term`,
    t.unknownGain !== 0 && `${signed(t.unknownGain)} term not known yet`,
  ]
    .filter(Boolean)
    .join(' · ');

export const netGain = (t: ByTerm): Cents => t.shortGain + t.longGain + t.unknownGain;

const add = (t: ByTerm, term: Term, gain: Cents) => {
  if (term === 'long') t.longGain += gain;
  else if (term === 'short') t.shortGain += gain;
  else t.unknownGain += gain;
};

export interface Realized extends ByTerm {
  proceeds: Cents;
  sales: number;
}

/** Gains (losses negative) realized by a holding's sales between `from` and `to` (added to `r`). */
export function realizedIn(
  pos: Position,
  from: ISODate,
  to: ISODate,
  r: Realized = { shortGain: 0, longGain: 0, unknownGain: 0, proceeds: 0, sales: 0 },
): Realized {
  for (const sale of pos.sales) {
    if (sale.date < from || sale.date > to) continue;
    r.proceeds += sale.proceeds;
    r.sales++;
    for (const part of sale.parts) add(r, termOn(part.acquired, sale.date, part.opening), part.proceeds - part.cost);
  }
  return r;
}

/** Gains (losses negative) realized by sales in taxable accounts between `from` and `to`. */
export function realizedBetween(p: Portfolio, accounts: Account[], from: ISODate, to: ISODate): Realized {
  const r: Realized = { shortGain: 0, longGain: 0, unknownGain: 0, proceeds: 0, sales: 0 };
  for (const { pos } of taxable(p, accounts)) realizedIn(pos, from, to, r);
  return r;
}

/** Dividends paid in taxable accounts between `from` and `to`: they're taxed that year, reinvested or not. */
export function taxableDividends(p: Portfolio, accounts: Account[], from: ISODate, to: ISODate): Cents {
  let sum = 0;
  for (const { pos } of taxable(p, accounts)) for (const d of pos.paid) if (d.date >= from && d.date <= to) sum += d.amount;
  return sum;
}

/** What selling everything (in `lots`) today would realize, by term. */
export function unrealized(lots: OpenLot[]): ByTerm {
  const u: ByTerm = { shortGain: 0, longGain: 0, unknownGain: 0 };
  for (const l of lots) add(u, l.term, l.gain);
  return u;
}

export interface TurningLong {
  account: Account;
  ticker: string;
  acquired: ISODate;
  on: ISODate;
  days: number;
  shares: number;
  gain: Cents;
}

/** Gains turning long-term within `within` days, soonest first (purchases that turn on the same day together). */
export function turningLongTerm(lots: OpenLot[], within = 60, min = 0): TurningLong[] {
  const out = new Map<string, TurningLong>();
  for (const l of lots) {
    if (l.term !== 'short' || l.days > within) continue;
    const key = `${l.account.id}:${l.ticker}:${l.longTermOn}`;
    const t = out.get(key);
    if (t) {
      t.gain += l.gain;
      t.shares += l.shares;
    } else out.set(key, { account: l.account, ticker: l.ticker, acquired: l.acquired, on: l.longTermOn, days: l.days, shares: l.shares, gain: l.gain });
  }
  return [...out.values()].filter((t) => t.gain > 0 && t.gain >= min).sort((a, b) => a.days - b.days || b.gain - a.gain);
}

/** A loss on a sale with a purchase of the same within 30 days before or after it is a wash sale. */
export const WASH_DAYS = 30;

export interface Harvest {
  account: Account;
  ticker: string;
  cost: Cents;
  value: Cents;
  /** What selling all of it would realize: a loss, as a positive number, and how much of that is short-term. */
  loss: Cents;
  shortLoss: Cents;
  /**
   * The latest purchase of it in the last 30 days in another account that still holds it (an IRA's counts
   * too): selling this at a loss before `clearOn` would be a wash sale.
   */
  washBuy?: { date: ISODate; account: Account; reinvested: boolean; clearOn: ISODate };
}

/**
 * Holdings in taxable accounts worth less than they cost: selling all of one would realize a loss. Selling
 * all of it leaves none of this account's shares to count against it, so a wash sale is about other
 * accounts' purchases (and buying it again within 30 days after).
 */
export function harvestable(p: Portfolio, accounts: Account[], lots: OpenLot[], today: ISODate, min = 5_000): Harvest[] {
  const byPos = new Map<string, Harvest & { shortNet: Cents }>();
  for (const l of lots) {
    const key = `${l.account.id}:${l.ticker}`;
    const h = byPos.get(key) ?? { account: l.account, ticker: l.ticker, cost: 0, value: 0, loss: 0, shortLoss: 0, shortNet: 0 };
    h.cost += l.cost;
    h.value += l.value;
    if (l.term === 'short') h.shortNet += l.gain;
    byPos.set(key, h);
  }
  const since = addDays(today, -WASH_DAYS);
  const out: Harvest[] = [];
  for (const { shortNet, ...h } of byPos.values()) {
    h.loss = h.cost - h.value;
    if (h.loss < min) continue;
    h.shortLoss = Math.min(h.loss, Math.max(0, -shortNet));
    for (const hs of p.accounts) {
      if (hs.accountId === h.account.id) continue;
      const pos = hs.positions.find((x) => x.ticker === h.ticker);
      const account = accounts.find((a) => a.id === hs.accountId);
      if (!pos || !account || !(pos.source === 'cost' ? pos.value > 0 : (pos.shares ?? 0) > 0)) continue;
      const consider = (date: ISODate, reinvested: boolean) => {
        if (date >= since && date <= today && (!h.washBuy || date > h.washBuy.date))
          h.washBuy = { date, account, reinvested, clearOn: addDays(date, WASH_DAYS + 1) };
      };
      for (const t of pos.trades) if (t.kind === 'buy' && !t.opening) consider(t.date, false);
      for (const d of pos.paid) if (d.bought) consider(d.date, true);
    }
    out.push(h);
  }
  return out.sort((a, b) => b.loss - a.loss);
}
