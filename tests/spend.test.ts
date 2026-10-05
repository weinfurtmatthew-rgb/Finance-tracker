import { describe, expect, it } from 'vitest';
import { monthSpent, spendingByMonth, suggestLimits } from '../src/lib/budgets';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { billsShown, spendTotals } from '../src/lib/spend';
import { todayFacts } from '../src/lib/today';
import type { Recurring, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee = 'X', extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`,
  accountId: 'a',
  date,
  amount,
  description: payee.toUpperCase(),
  payee,
  categoryId,
  notes: '',
  source: 'csv',
  createdAt: 0,
  ...extra,
});
const gym: Recurring = { id: 'g', name: 'Gym', kind: 'subscription', frequency: 'monthly', match: 'gym', amount: -4000, status: 'active', createdAt: 0 };

const sept = [
  tx('2026-09-01', -165000, 'housing', 'Landlord'), // rent: a bill before anything is confirmed
  tx('2026-09-03', -4000, 'fitness', 'Gym'), // a tracked subscription in an everyday category
  tx('2026-09-05', -6000, 'dining'),
  tx('2026-09-06', 1500, 'dining'), // refund
  tx('2026-09-07', -50000, 'card-payment', 'Discover'),
  tx('2026-09-08', -3000, 'transfer'),
  tx('2026-09-15', 250000, 'income'),
  tx('2026-09-20', -12000, 'groceries', 'Target', {
    splits: [
      { id: 'a', amount: -9000, categoryId: 'groceries' },
      { id: 'b', amount: -3000, categoryId: 'dining', owedBy: 'Sam' },
    ],
  }),
];

describe('one definition of spent', () => {
  it('splits spending into everyday and bills, leaving out transfers and money owed back', () => {
    expect(spendTotals(sept, cats, [gym])).toEqual({ spent: 182500, everyday: 13500, bills: 169000, income: 250000, count: sept.length });
  });

  it('counts bill categories as bills even with nothing tracked', () => {
    const t = spendTotals(sept, cats, []);
    expect(t.bills).toBe(165000);
    expect(t.everyday).toBe(17500);
    expect(t.spent).toBe(182500);
  });

  it('gives the same month totals on Spending, Activity and Today', () => {
    const m = spendingByMonth(sept, cats, [gym]).get('2026-09')!;
    const totals = spendTotals(sept, cats, [gym]);
    expect(monthSpent(m)).toBe(totals.spent);
    expect(m.everyday).toBe(totals.everyday);
    expect(m.bills).toBe(totals.bills);
    expect(m.income).toBe(totals.income);
    expect(todayFacts(sept, cats, [gym], '2026-09-30').spent).toBe(totals.everyday);
  });

  it('keeps budgets measuring their category, minus tracked bills', () => {
    const m = spendingByMonth(sept, cats, [gym]).get('2026-09')!;
    expect(m.byCategory.get('housing')).toBe(165000);
    expect(m.byCategory.has('fitness')).toBe(false);
    expect(m.allByCategory.get('fitness')).toBe(4000);
  });

  it("doesn't suggest budgets for bills", () => {
    const months = spendingByMonth(sept, cats, []);
    const s = suggestLimits(months, '2026-10', 1);
    expect(s.has('housing')).toBe(false);
    expect(s.get('groceries')).toBe(9000);
  });

  it('shows bills so the rounded parts add up to the rounded total', () => {
    // $363.40 + $1,908.50 = $2,271.90: shown as $363 + $1,909 = $2,272.
    expect(billsShown(36340, 190850)).toBe(190900);
    // $363.60 + $1,908.30 = $2,271.90: $364 + $1,908 = $2,272.
    expect(billsShown(36360, 190830)).toBe(190800);
  });
});
