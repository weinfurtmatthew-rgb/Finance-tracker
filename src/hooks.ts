import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Account, Category, Rule, Transaction } from './types';

const EMPTY: never[] = [];

export function useAccounts(): Account[] {
  return useLiveQuery(() => db.accounts.orderBy('createdAt').toArray(), []) ?? EMPTY;
}

export function useTransactions(): Transaction[] {
  return useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []) ?? EMPTY;
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []) ?? EMPTY;
}

export function useRules(): Rule[] {
  return useLiveQuery(() => db.rules.orderBy('createdAt').reverse().toArray(), []) ?? EMPTY;
}

export function useMeta<T>(key: string): T | undefined {
  return useLiveQuery(async () => (await db.meta.get(key))?.value as T | undefined, [key]);
}

/** Map helper for id → record lookups in render code. */
export function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Like the hooks above, but `undefined` until loaded — for forms that seed their state from the data. */
export function useLoaded() {
  return useLiveQuery(async () => {
    const [accounts, transactions, categories, lastAccountId] = await Promise.all([
      db.accounts.orderBy('createdAt').toArray(),
      db.transactions.toArray(),
      db.categories.orderBy('order').toArray(),
      db.meta.get('lastManualAccount').then((m) => m?.value as string | undefined),
    ]);
    return { accounts, transactions, categories, lastAccountId };
  }, []);
}
