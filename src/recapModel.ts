import { useMemo } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { makeBook } from './lib/networth';
import { buildRecap, type Recap, type RecapPeriod } from './lib/recap';

/** Everything the recap needs, loaded once; `undefined` while loading. */
export function useRecapData() {
  return useLiveQuery(async () => {
    const [txns, accounts, valuations, categories, recurring, budgets, goals] = await Promise.all([
      db.transactions.toArray(),
      db.accounts.toArray(),
      db.valuations.toArray(),
      db.categories.toArray(),
      db.recurring.toArray(),
      db.budgets.toArray(),
      db.goals.toArray(),
    ]);
    return { txns, accounts, valuations, categories, recurring, budgets, goals };
  }, []);
}

export function useRecap(period: RecapPeriod): Recap | undefined {
  const data = useRecapData();
  return useMemo(() => {
    if (!data) return undefined;
    return buildRecap({ ...data, period, book: makeBook(data.accounts, data.txns, data.valuations) });
  }, [data, period.from, period.to]);
}

/** Years that have any transactions, newest first. */
export function useRecapYears(): number[] {
  const data = useRecapData();
  return useMemo(() => [...new Set((data?.txns ?? []).map((t) => Number(t.date.slice(0, 4))))].sort((a, b) => b - a), [data]);
}
