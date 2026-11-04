import { useStore } from './store';
import { useBook } from './hooks';
import { buildRecap, type Recap, type RecapPeriod } from './lib/recap';
import { CREDIT_SCORES, type CreditScore } from './lib/credit';

/** A recap of `period`, from the shared data; `undefined` while loading. */
export function useRecap(period: RecapPeriod): Recap | undefined {
  const s = useStore();
  const book = useBook();
  const { transactions: txns, accounts, valuations, categories, recurring, budgets, goals } = s.raw;
  const creditScores = s.meta?.get(CREDIT_SCORES) as CreditScore[] | undefined;
  return s.derive(`recap:${period.from}:${period.to}`, [s.loaded, txns, accounts, valuations, categories, recurring, budgets, goals, book, creditScores], () =>
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
          creditScores,
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
