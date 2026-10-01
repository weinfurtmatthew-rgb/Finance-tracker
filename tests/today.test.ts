import { describe, expect, it } from 'vitest';
import { categoryChanges, pace, paceTarget, spendReadiness, todayFacts, todaySummary, verdictFor, type Phrase } from '../src/lib/today';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Recurring, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee = 'X'): Transaction => ({
  id: `t${n++}`, accountId: 'a', date, amount, description: payee.toUpperCase(), payee, categoryId, notes: '', source: 'csv', createdAt: 0,
});
const netflix: Recurring = { id: 'r', name: 'Netflix', kind: 'subscription', frequency: 'monthly', match: 'netflix', amount: -1549, status: 'active', createdAt: 0 };

// June–August: $100 dining on the 5th and $60 groceries on the 20th, every month. September: dining
// runs hot ($180 by the 16th), groceries not yet.
const history: Transaction[] = [];
for (const m of ['06', '07', '08']) history.push(tx(`2026-${m}-05`, -10000, 'dining'), tx(`2026-${m}-20`, -6000, 'groceries'), tx(`2026-${m}-02`, -1549, 'subscriptions', 'Netflix'));
const sept = [tx('2026-09-02', -1549, 'subscriptions', 'Netflix'), tx('2026-09-05', -9000, 'dining'), tx('2026-09-14', -9000, 'dining'), tx('2026-09-30', -5000, 'dining')];
const txns = [...history, ...sept];
const text = (s: Phrase[]) => s.map((p) => p.text).join('');

describe('todayFacts', () => {
  const f = todayFacts(txns, cats, [netflix], '2026-09-16');
  it('adds up everyday spending this month by day, leaving out bills and the future', () => {
    expect(f.day).toBe(16);
    expect(f.days).toBe(30);
    expect(f.curve).toHaveLength(16);
    expect(f.curve[3]).toBe(0);
    expect(f.curve[4]).toBe(9000);
    expect(f.spent).toBe(18000);
  });
  it('leaves rent and other fixed-cost categories out of everyday spending', () => {
    const withRent = todayFacts([...txns, tx('2026-09-01', -165000, 'housing', 'Oak Apartments')], cats, [netflix], '2026-09-16');
    expect(withRent.spent).toBe(18000);
  });
  it('knows the usual month and the usual by this day', () => {
    expect(f.usualMonth).toBe(16000);
    expect(f.usualSoFar).toBe(10000);
    expect(f.usualByCategory.get('dining')).toBe(10000);
    expect(f.usualByCategory.has('groceries')).toBe(false); // groceries come later in the month
  });
  it('flags categories running hot', () => {
    const { hot } = categoryChanges(f);
    expect(hot.map((c) => c.categoryId)).toEqual(['dining']);
    expect(hot[0].diff).toBe(8000);
  });
});

describe('pace', () => {
  const f = todayFacts(txns, cats, [netflix], '2026-09-16');
  it('measures against budgets first, else your usual month', () => {
    expect(paceTarget(f, 30000)).toEqual({ amount: 30000, kind: 'budget' });
    expect(paceTarget(f, 0)).toEqual({ amount: 16000, kind: 'usual' });
  });
  it('compares spending with an even pace', () => {
    const p = pace(f, { amount: 30000, kind: 'budget' });
    expect(p.expected).toBe(16000);
    expect(p.under).toBe(-2000);
    expect(p.left).toBe(12000);
    expect(p.daysLeft).toBe(15);
  });
});

describe('spendReadiness', () => {
  const f = todayFacts(txns, cats, [netflix], '2026-09-16');
  it('scores a comfortable day high', () => {
    const r = spendReadiness({ facts: { ...f, spent: 8000, last7: 2000 }, target: { amount: 30000, kind: 'budget' }, cash: 300000, billsDue: 20000, liquid: 1000000, monthlySpending: 200000 });
    expect(r.score).toBeGreaterThanOrEqual(9);
    expect(r.verdict).toBe('Go For It');
    expect(r.factors.map((x) => x.key)).toEqual(['pace', 'bills', 'cushion', 'momentum']);
  });
  it('scores an overspent, short-on-cash day low', () => {
    const r = spendReadiness({ facts: { ...f, spent: 30000, last7: 40000, usual7: 10000 }, target: { amount: 30000, kind: 'budget' }, cash: 5000, billsDue: 50000, liquid: 10000, monthlySpending: 200000 });
    expect(r.score).toBeLessThanOrEqual(3);
    expect(r.verdict).toBe('Hold Off');
    expect(r.factors.find((x) => x.key === 'bills')!.detail).toContain('more than checking holds');
  });
  it('treats missing data as neutral', () => {
    const r = spendReadiness({ facts: { ...f, usual7: null }, target: null, cash: 0, billsDue: 0, liquid: 0, monthlySpending: 0 });
    expect(r.factors.filter((x) => x.value === null).map((x) => x.key)).toEqual(['pace', 'cushion', 'momentum']);
    expect(r.score).toBe(7);
  });
  it('names the bands', () => {
    expect([10, 9, 8, 7, 6, 4, 3, 0].map(verdictFor)).toEqual(['Go For It', 'Go For It', 'On Track', 'On Track', 'Pace Yourself', 'Pace Yourself', 'Hold Off', 'Hold Off']);
  });
});

describe('todaySummary', () => {
  const f = todayFacts(txns, cats, [netflix], '2026-09-16');
  const name = (id: string) => cats.get(id)!.name;
  it('says how the month is pacing, what is running hot and what is due', () => {
    const s = todaySummary({ facts: f, target: { amount: 40000, kind: 'budget' }, monthName: 'September', categoryName: name, bills: { count: 2, total: 9000, payday: { label: 'Friday' }, covered: true } });
    expect(s.map(text)).toEqual([
      'You’re $33 under pace for September.',
      'Dining is running hot: $80 more than usual by this point.',
      '2 bills land before Friday’s paycheck ($90), and you’re covered.',
    ]);
    expect(s[0][1]).toEqual({ text: '$33 under pace', tone: 'good' });
  });
  it('warns when bills are more than checking holds, and when over pace', () => {
    const s = todaySummary({ facts: f, target: { amount: 20000, kind: 'usual' }, monthName: 'September', categoryName: name, bills: { count: 1, total: 9000, covered: false } });
    expect(text(s[0])).toBe('You’re $73 over pace for September compared with your usual month, so an easy few days would help.');
    expect(text(s[2])).toBe('One bill lands in the next week: $90, more than checking holds right now.');
  });
  it('is quiet with no data', () => {
    expect(todaySummary({ facts: todayFacts([], cats, [], '2026-09-16'), target: null, monthName: 'September', categoryName: name, bills: { count: 0, total: 0, covered: true } })).toEqual([]);
  });
});
