import { lines } from './lib/lines';
import { useStore } from './store';
import { useBook } from './hooks';
import { useSpending } from './spendingModel';
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
  const store = useStore();
  const rec = useRecurringModel();
  const { months, cats } = useSpending();
  const book = useBook();
  const { accounts, transactions: txns, valuations, categories, recurring } = store.raw;
  const loaded = !!(accounts && txns && valuations && categories && recurring && rec.loaded);
  return store.derive('plan', [loaded, rec, months, book, cats], () => {
    if (!loaded) return undefined;
    const raw = { accounts: accounts!, txns: txns! };
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
    for (const t of lines(raw.txns)) {
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
  });
}
