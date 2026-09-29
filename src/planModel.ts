import { useMemo } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { byId } from './hooks';
import { makeBook } from './lib/networth';
import { spendingByMonth } from './lib/budgets';
import { monthlyCost } from './lib/recurring';
import { planSnapshot, type PlanSnapshot } from './lib/planData';
import { useRecurringModel } from './recurringModel';
import type { Cents } from './types';

/** Something you spend on regularly, for "what does this habit really cost?". */
export interface Habit {
  key: string;
  name: string;
  monthly: Cents;
  kind: 'subscription' | 'merchant';
}

export interface PlanData extends PlanSnapshot {
  /** Cash left after bills due before the next paycheck (needs a tracked paycheck). */
  leftAfterBills?: Cents;
  habits: Habit[];
  subscriptionsMonthly: Cents;
}

/** Everything the calculators start from; `undefined` until loaded so forms can seed from it. */
export function usePlanData(): PlanData | undefined {
  const rec = useRecurringModel();
  const raw = useLiveQuery(async () => {
    const [accounts, txns, valuations, categories, recurring] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.valuations.toArray(),
      db.categories.toArray(),
      db.recurring.toArray(),
    ]);
    return { accounts, txns, valuations, categories, recurring };
  }, []);

  return useMemo(() => {
    if (!raw || !rec.loaded) return undefined;
    const cats = byId(raw.categories);
    const months = spendingByMonth(raw.txns, cats, raw.recurring);
    const book = makeBook(raw.accounts, raw.txns, raw.valuations);
    const snap = planSnapshot({
      accounts: raw.accounts,
      book,
      txns: raw.txns,
      months,
      today: rec.today,
    });

    const active = rec.statuses.filter((s) => s.rec.status === 'active' && s.rec.kind === 'subscription');
    const habits: Habit[] = active
      .map((s) => ({
        key: `rec:${s.rec.id}`,
        name: s.rec.name,
        monthly: monthlyCost(s),
        kind: 'subscription' as const,
      }))
      .filter((h) => h.monthly > 0)
      .sort((a, b) => b.monthly - a.monthly);

    // Everyday merchants you visit often, averaged over the same months as spending.
    const inMonths = new Set(snap.averagedMonths);
    const tracked = rec.statuses.map((s) => s.rec.name.toLowerCase());
    const byPayee = new Map<string, { total: Cents; count: number }>();
    for (const t of raw.txns) {
      if (!inMonths.has(t.date.slice(0, 7)) || cats.get(t.categoryId)?.group !== 'expense' || t.amount >= 0) continue;
      const p = byPayee.get(t.payee) ?? { total: 0, count: 0 };
      p.total -= t.amount;
      p.count++;
      byPayee.set(t.payee, p);
    }
    const n = Math.max(1, snap.averagedMonths.length);
    const merchants = [...byPayee]
      .filter(([name, p]) => p.count >= n * 2 && !tracked.includes(name.toLowerCase()))
      .map(([name, p]) => ({
        key: `payee:${name}`,
        name,
        monthly: Math.round(p.total / n),
        kind: 'merchant' as const,
      }))
      .sort((a, b) => b.monthly - a.monthly)
      .slice(0, 8);

    return {
      ...snap,
      leftAfterBills: rec.cashFlow?.left,
      habits: [...habits, ...merchants],
      subscriptionsMonthly: rec.monthlySubscriptions,
    };
  }, [raw, rec]);
}
