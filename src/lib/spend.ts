/**
 * The app's one definition of spending, used by Today, Spending, Activity, the plan and Money Health so
 * they never disagree about the same month:
 *
 * - Spent = every purchase in an expense category, minus refunds. Transfers (moving money between your
 *   own accounts, card payments, money you're owed) and income never count.
 * - Spent splits into Bills (rent, utilities, insurance… anything in a bill category, plus charges for a
 *   bill or subscription you track) and Everyday (the rest). Bill categories count as bills right away,
 *   before you confirm anything in Recurring.
 */
import type { Category, Cents, Recurring, Transaction } from '../types';
import { lines } from './lines';
import { countsAsCost, matchesRecurring } from './recurring';

/** Categories that are bills by nature: their charges are never "everyday" spending. */
export const BILL_CATEGORIES: ReadonlySet<string> = new Set(['housing', 'bills', 'subscriptions', 'insurance', 'car-payment', 'taxes']);
export const isBillCategory = (id: string) => BILL_CATEGORIES.has(id);

export type LineKind = 'income' | 'transfer' | 'everyday' | 'bills';

/** Sorts one transaction line (a split part, or the whole transaction) into the kinds above. */
export function lineKinds(categories: Map<string, Category>, recurring: Recurring[]) {
  const costs = recurring.filter(countsAsCost);
  return {
    kind(t: Transaction): LineKind {
      const group = categories.get(t.categoryId)?.group;
      if (group === 'income') return 'income';
      if (group !== 'expense') return 'transfer';
      return isBillCategory(t.categoryId) || costs.some((r) => matchesRecurring(r, t)) ? 'bills' : 'everyday';
    },
    /** A charge for a bill or subscription you track (kept out of category budgets). */
    tracked: (t: Transaction) => costs.some((r) => matchesRecurring(r, t)),
  };
}

export interface SpendTotals {
  /** Everyday + bills (positive = spent; refunds reduce it). */
  spent: Cents;
  everyday: Cents;
  bills: Cents;
  income: Cents;
  /** Transactions counted (each once, however it's split). */
  count: number;
}

/**
 * Bills in whole dollars, as the total shown minus everyday shown, so "$363 everyday + $1,909 bills"
 * never sits beside a $2,271 total because each was rounded on its own.
 */
export const billsShown = (everyday: Cents, bills: Cents): Cents => dollars(everyday + bills) - dollars(everyday);
const dollars = (c: Cents) => Math.round(c / 100) * 100;

/** Totals for any set of transactions (a month, a filtered list…), by the rule above. */
export function spendTotals(txns: Transaction[], categories: Map<string, Category>, recurring: Recurring[]): SpendTotals {
  const { kind } = lineKinds(categories, recurring);
  const out: SpendTotals = { spent: 0, everyday: 0, bills: 0, income: 0, count: txns.length };
  for (const t of lines(txns)) {
    const k = kind(t);
    if (k === 'income') out.income += t.amount;
    else if (k === 'everyday') out.everyday -= t.amount;
    else if (k === 'bills') out.bills -= t.amount;
  }
  out.spent = out.everyday + out.bills;
  return out;
}
