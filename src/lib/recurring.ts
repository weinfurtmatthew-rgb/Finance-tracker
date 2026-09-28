import type { AmountMode, Category, Cents, Frequency, ISODate, Recurring, RecurringKind, Transaction } from '../types';
import { addDays, dayInMonth, dayOfMonth, diffDays } from './dates';
import { formatMoney } from './money';

export const FREQUENCIES: Record<Frequency, { label: string; days: number; perMonth: number; window: number; months?: number }> = {
  weekly: { label: 'Weekly', days: 7, perMonth: 52 / 12, window: 2 },
  biweekly: { label: 'Every 2 weeks', days: 14, perMonth: 26 / 12, window: 3 },
  semimonthly: { label: 'Twice a month', days: 15, perMonth: 2, window: 4 },
  monthly: { label: 'Monthly', days: 30, perMonth: 1, window: 6, months: 1 },
  quarterly: { label: 'Every 3 months', days: 91, perMonth: 1 / 3, window: 12, months: 3 },
  yearly: { label: 'Yearly', days: 365, perMonth: 1 / 12, window: 20, months: 12 },
};

export const KINDS: Record<RecurringKind, { label: string; plural: string; emoji: string }> = {
  subscription: { label: 'Subscription', plural: 'Subscriptions', emoji: '🔁' },
  bill: { label: 'Bill', plural: 'Bills & utilities', emoji: '💡' },
  loan: { label: 'Rent / loan', plural: 'Rent & loans', emoji: '🏠' },
  'card-payment': { label: 'Card payment', plural: 'Credit card payments', emoji: '💳' },
  income: { label: 'Paycheck / income', plural: 'Income', emoji: '💵' },
  trial: { label: 'Free trial', plural: 'Free trials', emoji: '⏳' },
};

export const isOutflow = (r: Pick<Recurring, 'kind'>) => r.kind !== 'income';
/** Kinds that count toward "what your subscriptions & bills cost" (card payments would double count purchases). */
export const countsAsCost = (r: Pick<Recurring, 'kind'>) => r.kind === 'subscription' || r.kind === 'bill' || r.kind === 'loan';

// ---------------------------------------------------------------------------------------------
// Matching transactions to a recurring item
// ---------------------------------------------------------------------------------------------

export function matchesRecurring(r: Recurring, t: Transaction): boolean {
  if (isOutflow(r) ? t.amount >= 0 : t.amount <= 0) return false;
  const needle = r.match.trim().toLowerCase();
  if (!needle || !`${t.description}\n${t.payee}`.toLowerCase().includes(needle)) return false;
  if (r.matchAmount != null && r.matchAmount !== 0) {
    const ratio = Math.abs(t.amount) / Math.abs(r.matchAmount);
    if (ratio < 0.8 || ratio > 1.25) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------------------------

type Schedule = Pick<Recurring, 'frequency' | 'dayOfMonth' | 'days'>;

function nearest(date: ISODate, candidates: ISODate[]): ISODate {
  return candidates.reduce((best, c) => (Math.abs(diffDays(date, c)) < Math.abs(diffDays(date, best)) ? c : best));
}

/** Snap a payment date onto the schedule's grid (a bill due the 1st but paid on Oct 30 belongs to Nov 1). */
export function snapToSchedule(date: ISODate, s: Schedule): ISODate {
  const f = FREQUENCIES[s.frequency];
  if (s.frequency === 'semimonthly') {
    const [a, b] = s.days ?? [1, 15];
    return nearest(date, [-1, 0, 1].flatMap((o) => [dayInMonth(date, o, a), dayInMonth(date, o, b)]));
  }
  if (f.months) {
    const dom = s.dayOfMonth ?? dayOfMonth(date);
    return nearest(date, [-1, 0, 1].map((o) => dayInMonth(date, o, dom)));
  }
  return date;
}

/** The scheduled date after a date that's already on the schedule's grid. */
export function nextOnSchedule(gridDate: ISODate, s: Schedule): ISODate {
  const f = FREQUENCIES[s.frequency];
  if (s.frequency === 'semimonthly') {
    const [a, b] = s.days ?? [1, 15];
    const candidates = [0, 1].flatMap((o) => [dayInMonth(gridDate, o, a), dayInMonth(gridDate, o, b)]).sort();
    return candidates.find((c) => c > gridDate)!;
  }
  if (f.months) return dayInMonth(gridDate, f.months, s.dayOfMonth ?? dayOfMonth(gridDate));
  return addDays(gridDate, f.days);
}

export function previousOnSchedule(gridDate: ISODate, s: Schedule): ISODate {
  const f = FREQUENCIES[s.frequency];
  if (s.frequency === 'semimonthly') {
    const [a, b] = s.days ?? [1, 15];
    const candidates = [-1, 0].flatMap((o) => [dayInMonth(gridDate, o, a), dayInMonth(gridDate, o, b)]).sort();
    return candidates.reverse().find((c) => c < gridDate)!;
  }
  if (f.months) return dayInMonth(gridDate, -f.months, s.dayOfMonth ?? dayOfMonth(gridDate));
  return addDays(gridDate, -f.days);
}

/** Due dates from `first` through `to` (inclusive). */
export function occurrences(first: ISODate, to: ISODate, s: Schedule, limit = 200): ISODate[] {
  const out: ISODate[] = [];
  for (let d = first; d <= to && out.length < limit; d = nextOnSchedule(d, s)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Status of a recurring item: history, next due date, expected amount, alerts
// ---------------------------------------------------------------------------------------------

export type PriceAlertRule = { mode: 'off' | 'any' | 'percent' | 'dollars'; value: number };

export interface RecurringSettings {
  amountMode: AmountMode;
  priceAlert: PriceAlertRule;
  reminderDays: number;
}

export const DEFAULT_SETTINGS: RecurringSettings = {
  amountMode: 'average',
  priceAlert: { mode: 'percent', value: 5 },
  reminderDays: 3,
};

export interface RecurringStatus {
  rec: Recurring;
  /** Matched transactions, newest first. */
  history: Transaction[];
  lastPaid?: ISODate;
  nextDue: ISODate;
  /** The due date has passed with no matching charge imported (yet). */
  late: boolean;
  expected: Cents;
  priceChange?: { from: Cents; to: Cents; date: ISODate; txnId: string };
  chargedAfterCancel?: Transaction;
  saved?: Cents;
  trialEnded?: boolean;
}

export function priceIncreased(from: Cents, to: Cents, rule: PriceAlertRule): boolean {
  const a = Math.abs(from);
  const b = Math.abs(to);
  if (rule.mode === 'off' || b <= a) return false;
  if (rule.mode === 'any') return true;
  if (rule.mode === 'dollars') return b - a > rule.value * 100;
  return a > 0 && ((b - a) / a) * 100 > rule.value;
}

const near = (a: Cents, b: Cents) => Math.abs(a - b) <= Math.abs(b) * 0.02;

/** A fixed price that just changed (Netflix $15.49, $15.49 → $17.99), as opposed to a bill that varies. */
function steadyPriceChanged(history: Transaction[]): boolean {
  const [latest, prev, before] = history;
  return !!prev && (!before || near(before.amount, prev.amount)) && !near(latest.amount, prev.amount);
}

export function expectedAmount(r: Recurring, history: Transaction[], mode: AmountMode): Cents {
  const m = r.amountMode ?? mode;
  if (m === 'manual' || history.length === 0) return r.amount;
  if (m === 'last') return history[0].amount;
  // After a price change the new price is the best guess; averaging would mix old and new.
  if (steadyPriceChanged(history) && history.length >= 3) return history[0].amount;
  const recent = history.slice(0, 3);
  return Math.round(recent.reduce((s, t) => s + t.amount, 0) / recent.length);
}

export function recurringStatus(r: Recurring, txns: Transaction[], today: ISODate, settings: RecurringSettings): RecurringStatus {
  const history = txns.filter((t) => matchesRecurring(r, t)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const lastCharge = history[0]?.date;
  const lastPaid = [r.lastPaidOn, lastCharge].filter((d): d is ISODate => !!d).sort().pop();
  const expected = expectedAmount(r, history, settings.amountMode);

  let nextDue: ISODate;
  if (r.kind === 'trial' && r.trialEndsOn) nextDue = r.trialEndsOn;
  else if (lastPaid) nextDue = nextOnSchedule(snapToSchedule(lastPaid, r), r);
  else nextDue = today;

  const status: RecurringStatus = { rec: r, history, lastPaid, nextDue, late: nextDue < today, expected };

  if (r.kind === 'trial') status.trialEnded = !!r.trialEndsOn && r.trialEndsOn < today;

  if (history.length >= 2 && isOutflow(r) && r.kind !== 'card-payment' && r.status === 'active') {
    const [latest, prev] = history;
    // Only a price that used to be steady counts as a "price increase"; bills that vary every month
    // (electric, water) would otherwise alert constantly.
    if (steadyPriceChanged(history) && diffDays(latest.date, today) <= 60 && priceIncreased(prev.amount, latest.amount, settings.priceAlert)) {
      status.priceChange = { from: prev.amount, to: latest.amount, date: latest.date, txnId: latest.id };
    }
  }

  if (r.status === 'cancelled' && r.cancelledOn) {
    // A couple of days' grace for charges that were already pending when you cancelled.
    status.chargedAfterCancel = history.find((t) => t.date > addDays(r.cancelledOn!, 2));
    const from = nextOnSchedule(snapToSchedule(lastPaid && lastPaid > r.cancelledOn ? lastPaid : r.cancelledOn, r), r);
    status.saved = occurrences(from, today, r).length * Math.abs(expected);
  }
  return status;
}

export function monthlyCost(s: RecurringStatus): Cents {
  return Math.round(Math.abs(s.expected) * FREQUENCIES[s.rec.frequency].perMonth);
}

export interface UpcomingItem {
  status: RecurringStatus;
  date: ISODate;
  amount: Cents;
  late: boolean;
}

/** Unpaid due dates from today through `to`, plus any overdue ones. Cancelled items are skipped. */
export function upcoming(statuses: RecurringStatus[], today: ISODate, to: ISODate): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const s of statuses) {
    if (s.rec.status !== 'active') continue;
    if (s.rec.kind === 'trial') {
      if (s.nextDue <= to) items.push({ status: s, date: s.nextDue, amount: s.expected, late: s.nextDue < today });
      continue;
    }
    let first = s.nextDue;
    if (s.late) {
      items.push({ status: s, date: s.nextDue, amount: s.expected, late: true });
      while (first < today) first = nextOnSchedule(first, s.rec);
      if (first === s.nextDue) continue;
    }
    for (const d of occurrences(first, to, s.rec)) items.push({ status: s, date: d, amount: s.expected, late: false });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

export interface Suggestion {
  key: string;
  name: string;
  kind: RecurringKind;
  frequency: Frequency;
  amount: Cents;
  match: string;
  matchAmount?: Cents;
  dayOfMonth?: number;
  days?: [number, number];
  lastDate: ISODate;
  accountId: string;
  categoryId: string;
  count: number;
  transactionIds: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const LOAN = /\b(loan|mortgage|rent|navient|nelnet|mohela|sallie mae|aidvantage|auto ?finance|auto ?pay(ment)? .*(toyota|honda|ford|ally)|ally auto|car payment|property|apartments?|leasing)\b/i;

interface Pattern {
  frequency: Frequency;
  dayOfMonth?: number;
  days?: [number, number];
}

/** Decide whether a set of charge dates follows a regular schedule, and which one. */
export function detectPattern(datesIn: ISODate[]): Pattern | null {
  const dates = [...datesIn].sort();
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => diffDays(dates[i], d));
  if (gaps.some((g) => g <= 0)) return null; // two charges on one day: not a single schedule
  const med = median(gaps);
  const doms = dates.map(dayOfMonth);

  const fits = (period: number, window: number) => {
    // Allow the odd skipped/unimported cycle (a gap of two periods).
    const ok = gaps.filter((g) => Math.abs(g - period) <= window || Math.abs(g - 2 * period) <= window * 1.5).length;
    const exact = gaps.filter((g) => Math.abs(g - period) <= window).length;
    return ok / gaps.length >= 0.75 && exact >= Math.min(2, gaps.length);
  };
  const domOf = () => {
    const spread = Math.max(...doms) - Math.min(...doms);
    return spread <= 6 ? Math.round(median(doms)) : doms[doms.length - 1];
  };

  if (dates.length >= 3) {
    if (med >= 6 && med <= 8 && fits(7, 1)) return { frequency: 'weekly' };
    if (med >= 12 && med <= 18) {
      if (gaps.every((g) => g >= 13 && g <= 15) || (fits(14, 1) && !twoDayClusters(doms))) return { frequency: 'biweekly' };
      const clusters = twoDayClusters(doms);
      if (clusters) return { frequency: 'semimonthly', days: clusters };
      if (fits(14, 2)) return { frequency: 'biweekly' };
    }
    if (med >= 26 && med <= 35 && fits(30.4, 5)) return { frequency: 'monthly', dayOfMonth: domOf() };
  }
  if (med >= 84 && med <= 98 && fits(91, 8)) return { frequency: 'quarterly', dayOfMonth: domOf() };
  if (med >= 355 && med <= 376 && fits(365, 12)) return { frequency: 'yearly', dayOfMonth: domOf() };
  return null;
}

/**
 * For twice-a-month pay: do the days of month form two tight groups (e.g. 1st & 15th, allowing weekend shifts)?
 * Tries the days as-is first ("15th & 30th"), then treating month-end days as early next month
 * (a Jul 31 payday that's really the Aug 1 one moved up for the weekend).
 */
function twoDayClusters(doms: number[]): [number, number] | null {
  return clusterPair(doms) ?? clusterPair(doms.map((d) => (d >= 28 ? d - 30 : d)));
}

function clusterPair(values: number[]): [number, number] | null {
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted.slice(0, i);
    const hi = sorted.slice(i);
    if (Math.max(...lo) - Math.min(...lo) <= 4 && Math.max(...hi) - Math.min(...hi) <= 4) {
      const a = Math.max(1, Math.round(median(lo)));
      const b = Math.round(median(hi));
      if (b - a >= 10 && b - a <= 20) return [a, b];
    }
  }
  return null;
}

function guessKind(t: Transaction, categories: Map<string, Category>, frequency: Frequency): RecurringKind {
  const cat = categories.get(t.categoryId);
  if (t.amount > 0) return 'income';
  if (cat?.group === 'transfer') return 'card-payment';
  const text = `${t.description} ${t.payee}`;
  if (t.categoryId === 'housing' || LOAN.test(text)) return 'loan';
  if (t.categoryId === 'subscriptions' || t.categoryId === 'entertainment') return 'subscription';
  if (t.categoryId === 'bills' || t.categoryId === 'insurance' || t.categoryId === 'fees') return 'bill';
  const monthly = Math.abs(t.amount) * FREQUENCIES[frequency].perMonth;
  return monthly < 100_00 ? 'subscription' : 'bill';
}

/** Should this transaction be considered when looking for recurring charges? */
function eligible(t: Transaction, categories: Map<string, Category>): boolean {
  const cat = categories.get(t.categoryId);
  if (t.categoryId === 'investments' || t.categoryId === 'interest') return false;
  if (t.amount > 0) return cat?.group === 'income';
  if (cat?.group === 'transfer') return /pay|pymt|pmt/i.test(t.description);
  return true;
}

export function detectRecurring(
  txns: Transaction[],
  categories: Map<string, Category>,
  existing: Recurring[],
  dismissed: Set<string>,
): Suggestion[] {
  if (!txns.length) return [];
  const latest = txns.reduce((m, t) => (t.date > m ? t.date : m), txns[0].date);
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (!eligible(t, categories) || existing.some((r) => matchesRecurring(r, t))) continue;
    const name = (t.payee || t.description).trim().toLowerCase();
    if (!name) continue;
    const key = `${name}|${t.amount > 0 ? 'in' : 'out'}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: Suggestion[] = [];
  const consider = (key: string, list: Transaction[], split: boolean) => {
    const pattern = detectPattern(list.map((t) => t.date));
    if (!pattern) return false;
    const byDate = [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
    const last = byDate[0];
    const f = FREQUENCIES[pattern.frequency];
    // Stopped? If it hasn't shown up for well over a cycle (relative to your newest import), don't suggest it.
    if (diffDays(last.date, latest) > f.days * 1.5 + f.window) return true;
    const amount = Math.round(median(byDate.slice(0, 3).map((t) => t.amount)));
    const fullKey = split ? `${key}|${Math.abs(amount)}` : key;
    if (dismissed.has(fullKey)) return true;
    const payee = last.payee || last.description;
    out.push({
      key: fullKey,
      name: split ? `${payee} (${formatMoney(Math.abs(amount))})` : payee,
      kind: guessKind(last, categories, pattern.frequency),
      frequency: pattern.frequency,
      amount,
      match: payee.toLowerCase(),
      matchAmount: split ? amount : undefined,
      dayOfMonth: pattern.dayOfMonth,
      days: pattern.days,
      lastDate: last.date,
      accountId: last.accountId,
      categoryId: last.categoryId,
      count: list.length,
      transactionIds: list.map((t) => t.id),
    });
    return true;
  };

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    // Apple bills many different subscriptions under one name: always split those by amount.
    const forceSplit = /^apple\b/.test(key);
    if (!forceSplit && consider(key, list, false)) continue;
    // Otherwise try splitting a merchant's charges into clusters of similar amounts.
    const sorted = [...list].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    const clusters: Transaction[][] = [];
    for (const t of sorted) {
      const c = clusters[clusters.length - 1];
      const ref = c ? Math.abs(median(c.map((x) => x.amount))) : 0;
      if (c && Math.abs(t.amount) <= ref * 1.2 + 50) c.push(t);
      else clusters.push([t]);
    }
    if (clusters.length > 1 || forceSplit) for (const c of clusters) if (c.length >= 2) consider(key, c, true);
  }
  // Most confident (most occurrences) first.
  return out.sort((a, b) => b.count - a.count);
}

export function suggestionToRecurring(s: Suggestion, kind: RecurringKind, id: string): Recurring {
  return {
    id,
    name: s.name,
    kind,
    frequency: s.frequency,
    match: s.match,
    matchAmount: s.matchAmount,
    amount: s.amount,
    dayOfMonth: s.dayOfMonth,
    days: s.days,
    lastPaidOn: s.lastDate,
    accountId: s.accountId,
    categoryId: s.categoryId,
    status: 'active',
    createdAt: Date.now(),
  };
}
