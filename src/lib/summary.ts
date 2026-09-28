import type { Category, Cents, Transaction } from '../types';
import { monthKey } from './dates';

export interface MonthSummary {
  spent: Cents; // positive number
  income: Cents;
  byCategory: { categoryId: string; spent: Cents }[];
}

/** Spending and income for a month, ignoring transfers (card payments, moving money between accounts). */
export function summarizeMonth(txns: Transaction[], categories: Map<string, Category>, month: string): MonthSummary {
  let spent = 0;
  let income = 0;
  const per = new Map<string, number>();
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue;
    const cat = categories.get(t.categoryId);
    if (!cat || cat.group === 'transfer') continue;
    if (cat.group === 'income') {
      income += t.amount;
      continue;
    }
    // Expense categories: purchases are negative; refunds (positive) reduce spending.
    spent -= t.amount;
    per.set(t.categoryId, (per.get(t.categoryId) ?? 0) - t.amount);
  }
  const byCategory = [...per.entries()]
    .map(([categoryId, s]) => ({ categoryId, spent: s }))
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  return { spent, income, byCategory };
}
