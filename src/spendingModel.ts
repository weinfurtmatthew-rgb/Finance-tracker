import { useStore } from './store';
import { byId } from './hooks';
import type { Budget } from './types';
import { spendingByMonth } from './lib/budgets';

const EMPTY: never[] = [];

/** Month-by-month spending (flexible vs fixed) plus the saved budgets, worked out once from the shared data. */
export function useSpending() {
  const s = useStore();
  const txns = s.raw.transactions ?? EMPTY;
  const categories = s.raw.categories ?? EMPTY;
  const recurring = s.raw.recurring ?? EMPTY;
  const cats = s.derive('cats', [categories], () => byId(categories));
  const months = s.derive('months', [txns, cats, recurring], () => spendingByMonth(txns, cats, recurring));
  return { months, budgets: s.raw.budgets ?? (EMPTY as Budget[]), budgetsLoaded: !!s.raw.budgets, cats, categories };
}
