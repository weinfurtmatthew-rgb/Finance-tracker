import type { Budget, Category, Cents, ISODate, Recurring, Transaction } from '../types';
import { lines } from './lines';
import { addMonths, daysInMonth, dayOfMonth, monthKey } from './dates';
import { isBillCategory, lineKinds } from './spend';

export interface MonthSpending {
  month: string;
  /** What budgets measure, per expense category: everything except charges for a tracked bill (positive = spent; refunds reduce it). */
  byCategory: Map<string, Cents>;
  /** All spending per expense category, bills included ("where it went"). */
  allByCategory: Map<string, Cents>;
  /** Spent = everyday + bills, as defined in spend.ts. */
  everyday: Cents;
  bills: Cents;
  income: Cents;
}

/** Spending for every month present in the data, keyed by 'YYYY-MM' (see spend.ts for what counts). */
export function spendingByMonth(txns: Transaction[], categories: Map<string, Category>, recurring: Recurring[]): Map<string, MonthSpending> {
  const months = new Map<string, MonthSpending>();
  const { kind, tracked } = lineKinds(categories, recurring);
  // Split transactions count once per part, each in its own category.
  for (const t of lines(txns)) {
    const k = kind(t);
    if (k === 'transfer') continue;
    const key = monthKey(t.date);
    let m = months.get(key);
    if (!m) months.set(key, (m = { month: key, byCategory: new Map(), allByCategory: new Map(), everyday: 0, bills: 0, income: 0 }));
    if (k === 'income') {
      m.income += t.amount;
      continue;
    }
    if (k === 'bills') m.bills -= t.amount;
    else m.everyday -= t.amount;
    m.allByCategory.set(t.categoryId, (m.allByCategory.get(t.categoryId) ?? 0) - t.amount);
    if (!tracked(t)) m.byCategory.set(t.categoryId, (m.byCategory.get(t.categoryId) ?? 0) - t.amount);
  }
  return months;
}

/** Everything spent in a month: everyday + bills. */
export const monthSpent = (m: MonthSpending | undefined): Cents => (m ? m.everyday + m.bills : 0);

/** Round a suggested limit up to a friendly number ($10 steps under $200, then $25, then $50). */
export function roundLimit(cents: Cents): Cents {
  const dollars = cents / 100;
  const step = dollars < 200 ? 10 : dollars < 1000 ? 25 : 50;
  return Math.max(step, Math.ceil(dollars / step) * step) * 100;
}

/** Average everyday spending per category over the `n` full months before `month`. */
export function suggestLimits(months: Map<string, MonthSpending>, month: string, n = 3): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  let counted = 0;
  for (let i = 1; i <= n; i++) {
    const m = months.get(addMonths(month, -i));
    if (!m) continue;
    counted++;
    // Bills like rent aren't budgeted: the suggestions cover everyday categories.
    for (const [id, v] of m.byCategory) if (!isBillCategory(id)) totals.set(id, (totals.get(id) ?? 0) + v);
  }
  const out = new Map<string, Cents>();
  if (!counted) return out;
  for (const [id, total] of totals) {
    const avg = total / counted;
    if (avg >= 500) out.set(id, roundLimit(avg)); // skip categories under $5/month
  }
  return out;
}

export type BudgetState = 'ok' | 'warning' | 'over';

export interface BudgetProgress {
  categoryId: string;
  limit: Cents;
  spent: Cents;
  remaining: Cents;
  /** 0..n (1 = the whole limit used). */
  ratio: number;
  state: BudgetState;
  /** Projected month-end spending, when it's meaningful (current month, a week in). */
  projected?: Cents;
  /** Projected to go over although not over yet. */
  offPace: boolean;
}

export const WARN_AT = 0.8;

/**
 * Progress of each budget for a month. `today` decides how far through the month we are; for past
 * months there's no projection.
 */
export function budgetProgress(budgets: Budget[], spending: MonthSpending | undefined, month: string, today: ISODate): BudgetProgress[] {
  const [y, m] = month.split('-').map(Number);
  const days = daysInMonth(y, m);
  const current = monthKey(today) === month;
  const elapsed = current ? dayOfMonth(today) : days;
  return budgets.map((b) => {
    const spent = Math.max(0, spending?.byCategory.get(b.categoryId) ?? 0);
    const ratio = b.limit > 0 ? spent / b.limit : 0;
    const state: BudgetState = ratio > 1 ? 'over' : ratio >= WARN_AT ? 'warning' : 'ok';
    // Projecting from the first few days is mostly noise.
    const projected = current && elapsed >= 7 && elapsed < days ? Math.round((spent / elapsed) * days) : undefined;
    return {
      categoryId: b.categoryId,
      limit: b.limit,
      spent,
      remaining: b.limit - spent,
      ratio,
      state,
      projected,
      offPace: state === 'ok' && projected != null && projected > b.limit,
    };
  });
}

/** Fraction of the month that has passed (for the "where you should be" marker on meters). */
export function monthElapsed(month: string, today: ISODate): number {
  const [y, m] = month.split('-').map(Number);
  const current = monthKey(today) === month;
  if (!current) return today > `${month}-31` ? 1 : 0;
  return dayOfMonth(today) / daysInMonth(y, m);
}

/**
 * Whether a finished month is worth a small celebration: there were budgets, they were set before the
 * month began (so a limit made afterwards doesn't count), and every category stayed within its limit.
 */
export function heldEveryBudget(budgets: Budget[], progress: BudgetProgress[], monthStart: number): boolean {
  if (!budgets.length || budgets.some((b) => b.createdAt >= monthStart)) return false;
  return progress.length > 0 && progress.every((p) => p.spent <= p.limit);
}
