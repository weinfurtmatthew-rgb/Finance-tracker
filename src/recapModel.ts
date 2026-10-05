import { useStore } from './store';
import { useBook } from './hooks';
import { buildRecap, type Recap, type RecapPeriod } from './lib/recap';

/** A recap of `period`, from the shared data; `undefined` while loading. */
export function useRecap(period: RecapPeriod): Recap | undefined {
  const s = useStore();
  const book = useBook();
  const { transactions: txns, accounts, valuations, categories, recurring, budgets, goals } = s.raw;
  return s.derive(`recap:${period.from}:${period.to}`, [s.loaded, txns, accounts, valuations, categories, recurring, budgets, goals, book], () =>
    s.loaded
      ? buildRecap({
          txns: txns!,
          accounts: accounts!,
         
          categories: categories!,
          recurring: recurring!,
          budgets: budgets!,
          goals: goals!,
          period,
          book,
        })
      : undefined,
  );
}

/** Years that have any transactions, newest first. */
export function useRecapYears(): number[] {
  const s = useStore();
  const txns = s.raw.transactions;
  return s.derive('recapYears', [txns], () => [...new Set((txns ?? []).map((t) => Number(t.date.slice(0, 4))))].sort((a, b) => b - a));
}
