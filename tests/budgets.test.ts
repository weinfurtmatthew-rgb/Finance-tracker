import { describe, expect, it } from 'vitest';
import { budgetProgress, heldEveryBudget, monthElapsed, roundLimit, spendingByMonth, suggestLimits } from '../src/lib/budgets';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Recurring, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee = 'X'): Transaction => ({
  id: `t${n++}`, accountId: 'a', date, amount, description: payee.toUpperCase(), payee, categoryId, notes: '', source: 'csv', createdAt: 0,
});
const netflix: Recurring = { id: 'r', name: 'Netflix', kind: 'subscription', frequency: 'monthly', match: 'netflix', amount: -1549, status: 'active', createdAt: 0 };
const cardPay: Recurring = { id: 'c', name: 'Discover', kind: 'card-payment', frequency: 'monthly', match: 'discover', amount: -40000, status: 'active', createdAt: 0 };

const txns = [
  tx('2026-06-03', -12000, 'dining'), tx('2026-06-20', -5000, 'groceries'),
  tx('2026-07-03', -9000, 'dining'), tx('2026-07-21', -6000, 'groceries'),
  tx('2026-08-03', -15000, 'dining'), tx('2026-08-22', -7000, 'groceries'), tx('2026-08-25', 2000, 'dining'), // refund
  tx('2026-08-02', -1549, 'subscriptions', 'Netflix'),
  tx('2026-08-15', 240000, 'income'),
  tx('2026-08-20', -40000, 'transfer', 'Discover'),
  tx('2026-09-02', -1549, 'subscriptions', 'Netflix'),
  tx('2026-09-05', -10000, 'dining'), tx('2026-09-10', -9000, 'dining'), tx('2026-09-12', -2000, 'groceries'),
];

describe('spendingByMonth', () => {
  const months = spendingByMonth(txns, cats, [netflix, cardPay]);
  it('separates bills from everyday spending and ignores transfers', () => {
    const aug = months.get('2026-08')!;
    expect(aug.byCategory.get('dining')).toBe(13000); // refund nets out
    expect(aug.byCategory.has('subscriptions')).toBe(false); // Netflix is a tracked bill
    expect(aug.bills).toBe(1549);
    expect(aug.everyday).toBe(20000);
    expect(aug.income).toBe(240000);
  });

  it('suggests limits from the last 3 full months, rounded up', () => {
    const s = suggestLimits(months, '2026-09');
    expect(s.get('dining')).toBe(12000); // avg (120 + 90 + 130) / 3 = 113.33 → $120
    expect(s.get('groceries')).toBe(6000); // avg 60 → $60
    expect(s.has('subscriptions')).toBe(false);
  });
});

describe('budgetProgress', () => {
  const months = spendingByMonth(txns, cats, [netflix]);
  const budgets = [
    { categoryId: 'dining', limit: 20000, createdAt: 0 },
    { categoryId: 'groceries', limit: 2400, createdAt: 0 },
    { categoryId: 'shopping', limit: 10000, createdAt: 0 },
  ];
  it('states and on-pace projection mid-month', () => {
    const [dining, groceries, shopping] = budgetProgress(budgets, months.get('2026-09'), '2026-09', '2026-09-12');
    expect(dining).toMatchObject({ spent: 19000, state: 'warning', remaining: 1000 });
    expect(groceries).toMatchObject({ spent: 2000, state: 'warning' });
    expect(shopping).toMatchObject({ spent: 0, state: 'ok', offPace: false });
    const early = budgetProgress([{ categoryId: 'dining', limit: 40000, createdAt: 0 }], months.get('2026-09'), '2026-09', '2026-09-12')[0];
    expect(early.projected).toBe(47500); // $190 over 12 days → $475 by the 30th
    expect(early.offPace).toBe(true);
  });
  it('no projection for past months or the first week', () => {
    expect(budgetProgress(budgets, months.get('2026-08'), '2026-08', '2026-09-12')[0].projected).toBeUndefined();
    expect(budgetProgress(budgets, months.get('2026-09'), '2026-09', '2026-09-03')[0].projected).toBeUndefined();
  });
  it('over budget', () => {
    expect(budgetProgress([{ categoryId: 'dining', limit: 10000, createdAt: 0 }], months.get('2026-09'), '2026-09', '2026-09-30')[0].state).toBe('over');
  });
});

describe('helpers', () => {
  it('roundLimit', () => {
    expect(roundLimit(11333)).toBe(12000);
    expect(roundLimit(21001)).toBe(22500);
    expect(roundLimit(165000)).toBe(165000);
    expect(roundLimit(100)).toBe(1000);
  });
  it('monthElapsed', () => {
    expect(monthElapsed('2026-09', '2026-09-15')).toBe(0.5);
    expect(monthElapsed('2026-08', '2026-09-15')).toBe(1);
  });
});

describe('heldEveryBudget', () => {
  const start = new Date('2026-08-01T00:00:00').getTime();
  const b = (createdAt: number) => ({ categoryId: 'dining', limit: 20000, createdAt });
  const p = (spent: number) => ({ categoryId: 'dining', limit: 20000, spent, remaining: 20000 - spent, ratio: spent / 20000, state: 'ok' as const, offPace: false });
  it('celebrates only a month where every budget (set beforehand) held', () => {
    expect(heldEveryBudget([b(start - 1)], [p(19000)], start)).toBe(true);
    expect(heldEveryBudget([b(start - 1)], [p(20000)], start)).toBe(true);
    expect(heldEveryBudget([b(start - 1)], [p(20001)], start)).toBe(false);
    expect(heldEveryBudget([b(start + 1)], [p(100)], start)).toBe(false);
    expect(heldEveryBudget([], [], start)).toBe(false);
  });
});
