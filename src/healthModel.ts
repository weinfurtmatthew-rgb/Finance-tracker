import { useStore } from './store';
import { useTransactions } from './hooks';
import { usePlanData } from './planModel';
import { useRecurringModel } from './recurringModel';
import { useSpending } from './spendingModel';
import { addDays } from './lib/dates';
import { countsAsCost } from './lib/recurring';
import { LATE_FEE, moneyHealth, type Health } from './lib/health';

/** Money Health from everything in the app; `null` until there's a month of history to score. */
export function useMoneyHealth(): Health | null | undefined {
  const plan = usePlanData();
  const rec = useRecurringModel();
  const txns = useTransactions();
  const { budgets } = useSpending();
  const store = useStore();
  const goals = store.raw.goals?.length;
  return store.derive('health', [plan, rec, txns, budgets, goals], () => {
    if (!plan || goals === undefined) return undefined;
    const yearAgo = addDays(rec.today, -365);
    const lateFees = txns.filter((t) => t.date >= yearAgo && t.amount < 0 && LATE_FEE.test(`${t.description} ${t.payee}`)).length;
    const active = rec.statuses.filter((s) => s.rec.status === 'active');
    return moneyHealth({
      months: plan.averagedMonths.length,
      monthlyIncome: plan.monthlyIncome,
      monthlySpending: plan.monthlySpending,
      cash: plan.cash,
      invested: plan.invested,
      debt: plan.debts.filter((d) => !/mortgage/i.test(d.name)).reduce((s, d) => s + d.balance, 0),
      lateBills: rec.upcomingItems.filter((i) => i.late && countsAsCost(i.status.rec)).length,
      lateFees,
      budgets: budgets.length,
      goals,
      tracked: active.filter((s) => countsAsCost(s.rec)).length,
    });
  });
}
