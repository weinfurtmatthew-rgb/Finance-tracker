/**
 * The morning summary (screens/Morning.tsx): how you stand, what changed in the last 7 days and what's
 * coming in the next 7, from the same data and the same rules as the rest of the app (spending as
 * lib/spend.ts counts it, balances as lib/networth.ts does). Pure functions, so they're easy to test.
 */
import type { Category, Cents, ISODate, Recurring, Transaction } from '../types';
import { addDays, diffDays } from './dates';
import { lines } from './lines';
import { balanceOn, changeSince, historyStart, netWorthOn, type AccountChange, type BalanceBook } from './networth';
import { isOutflow, type UpcomingItem } from './recurring';
import { lineKinds } from './spend';

// ---------------------------------------------------------------------------------------------
// When it opens, and how it greets you
// ---------------------------------------------------------------------------------------------

/** It opens by itself on the first open of a day between these hours (local time). */
export const MORNING_FROM = 4;
export const MORNING_UNTIL = 12;

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Before 4 a.m. still counts as the evening before. */
export const dayPart = (hour: number): DayPart =>
  hour >= MORNING_FROM && hour < MORNING_UNTIL ? 'morning' : hour >= MORNING_UNTIL && hour < 17 ? 'afternoon' : 'evening';

/** Once a day, in the morning, when there's something to sum up. */
export function opensNow(args: { hour: number; today: ISODate; seen?: ISODate; hasData: boolean }): boolean {
  return args.hasData && dayPart(args.hour) === 'morning' && args.seen !== args.today;
}

/** "Good morning, Sam" (or without a name). */
export function greeting(hour: number, name?: string): string {
  const hello = `Good ${dayPart(hour)}`;
  const n = name?.trim();
  return n ? `${hello}, ${n}` : hello;
}

// ---------------------------------------------------------------------------------------------
// How up to date the numbers are: everything comes from bank files you import
// ---------------------------------------------------------------------------------------------

/** Older than this, the summary says an import would bring it up to date. */
export const BEHIND_DAYS = 3;

export interface Freshness {
  /** The newest transaction dated up to today. */
  newest?: ISODate;
  /** Days from it to today. */
  age?: number;
  behind: boolean;
}

export function freshness(txns: Transaction[], today: ISODate): Freshness {
  let newest: ISODate | undefined;
  for (const t of txns) if (t.date <= today && (!newest || t.date > newest)) newest = t.date;
  if (!newest) return { behind: false };
  const age = diffDays(newest, today);
  return { newest, age, behind: age > BEHIND_DAYS };
}

// ---------------------------------------------------------------------------------------------
// Where you stand
// ---------------------------------------------------------------------------------------------

const CASH_TYPES = new Set(['checking', 'savings', 'cash', 'wallet']);

export interface Standing {
  netWorth: Cents;
  /** Over the last 7 days (null when the history doesn't go back that far). */
  week: { total: Cents; pct: number | null; accounts: AccountChange[] } | null;
  /** Checking, savings and cash (null without any of those accounts). */
  cash: Cents | null;
  /** Owed on credit cards, as a positive number (null without a card). */
  cards: Cents | null;
}

export function standing(book: BalanceBook, today: ISODate): Standing {
  const open = book.accounts.filter((a) => !a.archived);
  const sum = (match: (type: string) => boolean) => {
    const list = open.filter((a) => match(a.type));
    return list.length ? list.reduce((s, a) => s + balanceOn(book, a), 0) : null;
  };
  const cardBalance = sum((t) => t === 'credit');
  const weekAgo = addDays(today, -7);
  const start = historyStart(book);
  return {
    netWorth: netWorthOn(book).net,
    week: start && start <= weekAgo ? changeSince(book, weekAgo) : null,
    cash: sum((t) => CASH_TYPES.has(t)),
    cards: cardBalance == null ? null : -cardBalance,
  };
}

// ---------------------------------------------------------------------------------------------
// The last 7 days
// ---------------------------------------------------------------------------------------------

/** A purchase this big makes the list of the week's biggest. */
export const BIG_PURCHASE = 100_00;
/** Weeks before the last 7 days that make a "usual" week (fewer when the history is shorter). */
const USUAL_WEEKS = 8;

export interface LastSevenDays {
  /** The first of the 7 days (the last is today). */
  from: ISODate;
  /** Money that came in (paychecks, interest…), biggest first. */
  income: { total: Cents; items: Transaction[] };
  /** Spent in the 7 days (Spending's rule: purchases minus refunds), and in a usual 7 days before them. */
  spent: { total: Cents; usual: Cents | null };
  /** The biggest purchases, up to 3. */
  biggest: Transaction[];
}

export function lastSevenDays(txns: Transaction[], categories: Map<string, Category>, recurring: Recurring[], today: ISODate): LastSevenDays {
  const from = addDays(today, -6);
  const usualFrom = addDays(from, -7 * USUAL_WEEKS);
  const { kind } = lineKinds(categories, recurring);
  let first: ISODate | undefined;
  let spent = 0;
  let before = 0;
  let income = 0;
  const incomeItems = new Map<string, Transaction>();
  const purchases = new Map<string, Transaction>();
  for (const t of txns) if (t.date <= today && (!first || t.date < first)) first = t.date;
  for (const line of lines(txns)) {
    if (line.date > today || line.date < usualFrom) continue;
    const k = kind(line);
    const inWeek = line.date >= from;
    if (k === 'income') {
      if (inWeek && line.amount > 0) {
        income += line.amount;
        incomeItems.set(line.id, txns.find((t) => t.id === line.id) ?? line);
      }
      continue;
    }
    if (k !== 'everyday' && k !== 'bills') continue;
    if (inWeek) {
      spent -= line.amount;
      if (line.amount < 0) purchases.set(line.id, txns.find((t) => t.id === line.id) ?? line);
    } else before -= line.amount;
  }
  // A usual week: the weeks before these 7 days that the history covers in full.
  const weeks = first ? Math.min(USUAL_WEEKS, Math.floor(diffDays(first, from) / 7)) : 0;
  const usualStart = addDays(from, -7 * weeks);
  if (weeks > 0 && weeks < USUAL_WEEKS) {
    // Only the covered weeks count: take out what fell before them.
    before = 0;
    for (const line of lines(txns)) {
      if (line.date < usualStart || line.date >= from) continue;
      const k = kind(line);
      if (k === 'everyday' || k === 'bills') before -= line.amount;
    }
  }
  return {
    from,
    income: { total: income, items: [...incomeItems.values()].sort((a, b) => b.amount - a.amount) },
    spent: { total: spent, usual: weeks >= 2 ? Math.round(before / weeks) : null },
    biggest: [...purchases.values()]
      .filter((t) => -t.amount >= BIG_PURCHASE)
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 3),
  };
}

// ---------------------------------------------------------------------------------------------
// The next 7 days
// ---------------------------------------------------------------------------------------------

export interface AheadDay {
  date: ISODate;
  /** Bills, subscriptions, card payments… due that day. */
  due: UpcomingItem[];
  /** Paychecks and other money expected that day. */
  pay: UpcomingItem[];
}

export interface WeekAhead {
  days: AheadDay[];
  /** Due dates that passed with no matching charge imported yet. */
  late: UpcomingItem[];
  /** Due in the 7 days. */
  dueTotal: Cents;
  /** Expected in. */
  payTotal: Cents;
}

/** Upcoming items (lib/recurring.ts upcoming) laid out over today and the 6 days after it. */
export function weekAhead(items: UpcomingItem[], today: ISODate, length = 7): WeekAhead {
  const days: AheadDay[] = Array.from({ length }, (_, i) => ({ date: addDays(today, i), due: [], pay: [] }));
  const late: UpcomingItem[] = [];
  let dueTotal = 0;
  let payTotal = 0;
  for (const i of items) {
    if (i.late) {
      if (isOutflow(i.status.rec)) late.push(i);
      continue;
    }
    const n = diffDays(today, i.date);
    if (n < 0 || n >= length) continue;
    if (isOutflow(i.status.rec)) {
      days[n].due.push(i);
      dueTotal += Math.abs(i.amount);
    } else {
      days[n].pay.push(i);
      payTotal += Math.abs(i.amount);
    }
  }
  return { days, late, dueTotal, payTotal };
}
