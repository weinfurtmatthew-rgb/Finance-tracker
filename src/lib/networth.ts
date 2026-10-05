import type { Account, Cents, Goal, ISODate, Transaction, Valuation } from '../types';
import { addDays, addMonths, dayInMonth, diffDays, monthKey } from './dates';
import { isLiability } from './balances';

/** Accounts whose balance is a value you enter (market or resale value), not the sum of transactions. */
export const isValued = (a: Pick<Account, 'type'>) => a.type === 'brokerage' || a.type === 'vehicle';

export const VALUE_STALE_DAYS = 30;

/** Everything needed to answer "what was this account worth on day X?" quickly. */
export interface BalanceBook {
  accounts: Account[];
  /** Per account: transactions sorted by date, with running totals. */
  running: Map<string, { dates: ISODate[]; totals: Cents[] }>;
  /** Per account: valuations sorted by date. */
  values: Map<string, Valuation[]>;
}

export function makeBook(accounts: Account[], txns: Transaction[], valuations: Valuation[]): BalanceBook {
  const byAcct = new Map<string, Transaction[]>();
  // Appending (not copying the list for every transaction) keeps this linear: years of history are thousands of rows.
  for (const t of txns) {
    const list = byAcct.get(t.accountId);
    if (list) list.push(t);
    else byAcct.set(t.accountId, [t]);
  }
  const running = new Map<string, { dates: ISODate[]; totals: Cents[] }>();
  for (const [id, list] of byAcct) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let sum = 0;
    running.set(id, { dates: list.map((t) => t.date), totals: list.map((t) => (sum += t.amount)) });
  }
  const values = new Map<string, Valuation[]>();
  for (const v of valuations) {
    const list = values.get(v.accountId);
    if (list) list.push(v);
    else values.set(v.accountId, [v]);
  }
  for (const list of values.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { accounts, running, values };
}

/** Index of the last element <= date (binary search), or -1. */
function lastOnOrBefore(dates: ISODate[], date: ISODate): number {
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

/**
 * Balance of an account at the end of `date` (or now). Investments and vehicles use the latest value
 * you entered on or before that day; before the first value, that first value is used (so history
 * doesn't show a fake jump the day you start tracking).
 */
export function balanceOn(book: BalanceBook, a: Account, date?: ISODate): Cents {
  const vals = book.values.get(a.id);
  if (isValued(a) && vals?.length) {
    if (!date) return vals[vals.length - 1].value;
    const i = lastOnOrBefore(
      vals.map((v) => v.date),
      date,
    );
    return (i >= 0 ? vals[i] : vals[0]).value;
  }
  const r = book.running.get(a.id);
  if (!r) return a.openingBalance;
  if (!date) return a.openingBalance + r.totals[r.totals.length - 1];
  const i = lastOnOrBefore(r.dates, date);
  return a.openingBalance + (i >= 0 ? r.totals[i] : 0);
}

export interface NetWorthPoint {
  date: ISODate;
  assets: Cents;
  /** What you owe, as a positive number. */
  debts: Cents;
  net: Cents;
}

export function netWorthOn(book: BalanceBook, date?: ISODate): NetWorthPoint {
  let assets = 0;
  let debts = 0;
  for (const a of book.accounts) {
    if (a.archived) continue;
    const b = balanceOn(book, a, date);
    if (b < 0 || (isLiability(a) && b < 0)) debts -= b;
    else assets += b;
  }
  return { date: date ?? '', assets, debts, net: assets - debts };
}

/** The first day we have any data for (earliest transaction or value). */
export function historyStart(book: BalanceBook): ISODate | undefined {
  let first: ISODate | undefined;
  for (const r of book.running.values()) if (r.dates.length && (!first || r.dates[0] < first)) first = r.dates[0];
  for (const v of book.values.values()) if (v.length && (!first || v[0].date < first)) first = v[0].date;
  return first;
}

export type Range = '6m' | '1y' | 'all';

/** Month-end points from the start of the range through `today` (the last point is today). */
export function historyDates(book: BalanceBook, today: ISODate, range: Range): ISODate[] {
  const start = historyStart(book);
  if (!start) return [today];
  const months = range === '6m' ? 6 : range === '1y' ? 12 : 1200;
  let from = addMonths(monthKey(today), -months);
  if (monthKey(start) > from) from = addMonths(monthKey(start), -1); // begin just before the data does
  const dates: ISODate[] = [];
  for (let m = from; m < monthKey(today); m = addMonths(m, 1)) dates.push(dayInMonth(`${m}-01`, 0, 31));
  dates.push(today);
  return dates;
}

export function netWorthHistory(book: BalanceBook, dates: ISODate[]): NetWorthPoint[] {
  return dates.map((d) => netWorthOn(book, d));
}

export interface AccountChange {
  account: Account;
  from: Cents;
  to: Cents;
  change: Cents;
}

/** Change since the end of last month, per account (biggest movers first). */
export function changeSince(book: BalanceBook, since: ISODate): { total: Cents; pct: number | null; accounts: AccountChange[] } {
  const accounts = book.accounts
    .filter((a) => !a.archived)
    .map((a) => {
      const from = balanceOn(book, a, since);
      const to = balanceOn(book, a);
      return { account: a, from, to, change: to - from };
    })
    .filter((c) => c.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const before = netWorthOn(book, since).net;
  const total = netWorthOn(book).net - before;
  return { total, pct: before > 0 ? (total / before) * 100 : null, accounts };
}

export function staleValued(book: BalanceBook, today: ISODate): Account[] {
  return book.accounts.filter((a) => {
    if (a.archived || !isValued(a)) return false;
    const vals = book.values.get(a.id);
    return !vals?.length || diffDays(vals[vals.length - 1].date, today) > VALUE_STALE_DAYS;
  });
}

// ---------------------------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------------------------

export interface GoalProgress {
  goal: Goal;
  saved: Cents;
  remaining: Cents;
  ratio: number;
  done: boolean;
  /** Average monthly growth of the linked account over the last 3 months. */
  pace: Cents;
  /** When you'd reach it at that pace (undefined if not growing). */
  projectedDate?: ISODate;
  /** To hit the target date: per month and per paycheck. */
  neededMonthly?: Cents;
  neededPerPaycheck?: Cents;
  paychecksLeft?: number;
  onTrack?: boolean;
}

export function goalProgress(book: BalanceBook, goal: Goal, today: ISODate, paydays: ISODate[] = []): GoalProgress {
  const account = book.accounts.find((a) => a.id === goal.accountId);
  const saved = account ? Math.max(0, balanceOn(book, account)) : 0;
  const remaining = Math.max(0, goal.target - saved);
  const ratio = goal.target > 0 ? Math.min(1, saved / goal.target) : 0;
  const done = remaining === 0;
  const past = account ? Math.max(0, balanceOn(book, account, addDays(today, -91))) : 0;
  const pace = Math.round((saved - past) / 3);
  const p: GoalProgress = { goal, saved, remaining, ratio, done, pace };
  if (done) return p;
  if (pace > 0) p.projectedDate = addDays(today, Math.ceil((remaining / pace) * 30.44));
  if (goal.targetDate && goal.targetDate > today) {
    const months = Math.max(1, diffDays(today, goal.targetDate) / 30.44);
    p.neededMonthly = Math.ceil(remaining / months);
    const left = paydays.filter((d) => d > today && d <= goal.targetDate!).length;
    if (left > 0) {
      p.paychecksLeft = left;
      p.neededPerPaycheck = Math.ceil(remaining / left);
    }
    p.onTrack = !!p.projectedDate && p.projectedDate <= goal.targetDate;
  } else if (goal.targetDate) {
    p.onTrack = false;
  }
  return p;
}
