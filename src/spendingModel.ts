import { useMemo } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { byId, useCategories, useTransactions } from './hooks';
import type { Budget } from './types';
import { spendingByMonth } from './lib/budgets';

const EMPTY: never[] = [];

/** Month-by-month spending (flexible vs fixed) plus the saved budgets, shared by the Overview and sheets. */
export function useSpending() {
  const txns = useTransactions();
  const categories = useCategories();
  const recurring = useLiveQuery(() => db.recurring.toArray(), []) ?? EMPTY;
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const cats = useMemo(() => byId(categories), [categories]);
  const months = useMemo(() => spendingByMonth(txns, cats, recurring), [txns, cats, recurring]);
  return { months, budgets: budgets ?? (EMPTY as Budget[]), budgetsLoaded: !!budgets, cats, categories };
}
