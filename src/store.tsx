/**
 * The app's one copy of its data. Each table is read once (and re-read only when that table changes),
 * and everything worked out from it (bills, spending by month, balances, the plan numbers, Money
 * Health…) is computed once, the first time a screen asks, then shared until its inputs change.
 *
 * Before this, every screen and hook read the whole database on its own and redid the same work; with a
 * few years of history that made switching tabs take seconds on a phone.
 */
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Account, Budget, Category, Goal, Recurring, Rule, Transaction, Valuation } from './types';
import { todayISO } from './lib/dates';

export interface Tables {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  valuations: Valuation[];
  recurring: Recurring[];
  budgets: Budget[];
  goals: Goal[];
}

export interface Store {
  /** Each table, or undefined until its first read finishes. */
  raw: { [K in keyof Tables]: Tables[K] | undefined };
  /** Settings and other small values (`meta` table), or undefined until read. */
  meta: Map<string, unknown> | undefined;
  /** Every table has been read. */
  loaded: boolean;
  today: string;
  /** Computes a value from the store once per change of `deps`, shared by everything that asks. */
  derive<T>(key: string, deps: unknown[], compute: () => T): T;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside <DataProvider>');
  return s;
}

/** Re-renders at midnight so "today" moves on while the app stays open. */
function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const id = setInterval(() => setToday((t) => (t === todayISO() ? t : todayISO())), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function DataProvider(props: { children: ComponentChildren }) {
  // One query per table: Dexie re-runs a query only when its own table changes.
  const accounts = useLiveQuery(() => db.accounts.orderBy('createdAt').toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
  const rules = useLiveQuery(() => db.rules.orderBy('createdAt').reverse().toArray(), []);
  const valuations = useLiveQuery(() => db.valuations.toArray(), []);
  const recurring = useLiveQuery(() => db.recurring.orderBy('id').toArray(), []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('id').toArray(), []);
  const metaRows = useLiveQuery(() => db.meta.toArray(), []);
  const today = useToday();
  // Lives for the whole app: computed values are kept per key with the inputs they came from.
  const [cache] = useState(() => new Map<string, { deps: unknown[]; value: unknown }>());

  const meta = useMemo(() => (metaRows ? new Map(metaRows.map((m) => [m.key, m.value])) : undefined), [metaRows]);
  const store = useMemo<Store>(() => {
    const raw = { accounts, transactions, categories, rules, valuations, recurring, budgets, goals };
    return {
      raw,
      meta,
      today,
      loaded: Object.values(raw).every((v) => v !== undefined) && meta !== undefined,
      derive<T>(key: string, deps: unknown[], compute: () => T): T {
        const hit = cache.get(key);
        if (hit && sameDeps(hit.deps, deps)) return hit.value as T;
        const value = compute();
        cache.set(key, { deps, value });
        return value;
      },
    };
  }, [accounts, transactions, categories, rules, valuations, recurring, budgets, goals, meta, today]);

  return <StoreContext.Provider value={store}>{props.children}</StoreContext.Provider>;
}
