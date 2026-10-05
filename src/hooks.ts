import { useStore } from './store';
import type { Account, Category, Goal, Rule, Transaction, Valuation } from './types';
import { makeBook } from './lib/networth';

// All of these read the app's shared copy of the data (see store.tsx); none of them query the database.

const EMPTY: never[] = [];

export function useAccounts(): Account[] {
  return useStore().raw.accounts ?? EMPTY;
}

/** Newest first. */
export function useTransactions(): Transaction[] {
  return useStore().raw.transactions ?? EMPTY;
}

export function useCategories(): Category[] {
  return useStore().raw.categories ?? EMPTY;
}

export function useRules(): Rule[] {
  return useStore().raw.rules ?? EMPTY;
}

export function useValuations(): Valuation[] {
  return useStore().raw.valuations ?? EMPTY;
}

export function useGoals(): Goal[] {
  return useStore().raw.goals ?? EMPTY;
}

/** A setting or other small saved value; undefined while loading and when it was never set. */
export function useMeta<T>(key: string): T | undefined {
  return useStore().meta?.get(key) as T | undefined;
}

/** Map helper for id → record lookups in render code. */
export function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Like the hooks above, but `undefined` until loaded — for forms that seed their state from the data. */
export function useLoaded() {
  const s = useStore();
  const { accounts, transactions, categories } = s.raw;
  if (!accounts || !transactions || !categories || !s.meta) return undefined;
  return { accounts, transactions, categories, lastAccountId: s.meta.get('lastManualAccount') as string | undefined };
}

/** Balances over time (transactions + values you entered), shared by Net Worth, Today and goals. */
export function useBook() {
  const s = useStore();
  const accounts = s.raw.accounts ?? EMPTY;
  const txns = s.raw.transactions ?? EMPTY;
  const valuations = s.raw.valuations ?? EMPTY;
  return s.derive('book', [accounts, txns, valuations], () => makeBook(accounts, txns, valuations));
}
