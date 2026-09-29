import { describe, expect, it } from 'vitest';
import { allTags, cleanTag, lines, owedByPerson, owedItems, repaymentCandidates, splitProblem } from '../src/lib/lines';
import { spendingByMonth } from '../src/lib/budgets';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { answer, findTag, parseQuestion, type AnswerData } from '../src/ai/ask';
import type { Transaction } from '../src/types';

let n = 0;
const tx = (amount: number, categoryId: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: 'a', date: '2026-09-10', amount, description: 'TARGET', payee: 'Target', categoryId, notes: '', source: 'csv', createdAt: 0, ...extra,
});
const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

describe('split transactions', () => {
  const target = tx(-12000, 'groceries', {
    splits: [
      { id: 'a', amount: -8000, categoryId: 'groceries' },
      { id: 'b', amount: -2500, categoryId: 'shopping' },
      { id: 'c', amount: -1500, categoryId: 'dining', owedBy: 'Alex' },
    ],
  });

  it('count once per part in their own categories; parts for someone else are not spending', () => {
    const m = spendingByMonth([target], cats, []).get('2026-09')!;
    expect(m.byCategory.get('groceries')).toBe(8000);
    expect(m.byCategory.get('shopping')).toBe(2500);
    expect(m.byCategory.get('dining')).toBeUndefined();
    expect(m.flexible).toBe(10500);
    expect(lines([target]).map((l) => l.categoryId)).toEqual(['groceries', 'shopping', 'owed']);
  });

  it('parts must add up to the total', () => {
    expect(splitProblem(-12000, target.splits!)).toBeNull();
    expect(splitProblem(-12000, [{ amount: -8000, categoryId: 'x' }, { amount: -3000, categoryId: 'y' }])).toMatch(/add up/);
    expect(splitProblem(-12000, [{ amount: -12000, categoryId: 'x' }])).toMatch(/two parts/);
  });

  it('Ask sums split parts and counts one visit', () => {
    const d = { txns: [target], categories: cats, today: '2026-09-29' } as unknown as AnswerData;
    const q = parseQuestion('how much did i spend on shopping this month', { today: '2026-09-29', categories: DEFAULT_CATEGORIES, merchants: ['Target'] })!;
    expect(answer(q, d).headline).toContain('$25');
  });
});

describe('owed to you', () => {
  const lunch = tx(-3000, 'owed', { owedBy: 'Alex', date: '2026-09-01' });
  const target = tx(-12000, 'groceries', { splits: [{ id: 'a', amount: -8000, categoryId: 'groceries' }, { id: 'c', amount: -4000, categoryId: 'dining', owedBy: 'Sam' }] });
  const venmo = tx(3000, 'uncategorized', { payee: 'Venmo', date: '2026-09-05' });

  it('lists what each person owes', () => {
    const people = owedByPerson(owedItems([lunch, target]));
    expect(people.map((p) => [p.who, p.total])).toEqual([
      ['Sam', 4000],
      ['Alex', 3000],
    ]);
  });

  it('paid back items drop off, and a repayment is only used once', () => {
    const settled = { ...lunch, settledBy: venmo.id };
    expect(owedByPerson(owedItems([settled, target])).map((p) => p.who)).toEqual(['Sam']);
    expect(repaymentCandidates([lunch, venmo], 3000, '2026-08-29').map((t) => t.id)).toEqual([venmo.id]);
    expect(repaymentCandidates([settled, venmo], 3000, '2026-08-29')).toEqual([]);
  });
});

describe('tags', () => {
  const trip = [tx(-5000, 'travel', { tags: ['Italy 2026'] }), tx(-2000, 'dining', { tags: ['italy 2026'] }), tx(-900, 'coffee')];
  it('match ignoring case and keep the first spelling', () => {
    expect(allTags(trip)).toMatchObject([{ tag: 'Italy 2026', count: 2, total: -7000 }]);
    expect(cleanTag('  #ITALY   2026 ', ['Italy 2026'])).toBe('Italy 2026');
    expect(cleanTag('Wedding', ['Italy 2026'])).toBe('Wedding');
    expect(cleanTag('  ', [])).toBeNull();
  });
  it('Ask understands "how much did the italy trip cost" (all time)', () => {
    expect(findTag('how much did the italy trip cost', ['Italy 2026'])).toBe('Italy 2026');
    const q = parseQuestion('how much did the italy trip cost', { today: '2026-09-29', categories: DEFAULT_CATEGORIES, merchants: [], tags: ['Italy 2026'] })!;
    expect(q).toMatchObject({ intent: 'spending', tag: 'Italy 2026' });
    const d = { txns: trip, categories: cats, today: '2026-09-29' } as unknown as AnswerData;
    expect(answer(q, d).headline).toContain('$70');
  });
});

describe('tag questions and categories', () => {
  it('"flights on the italy trip" keeps Travel', () => {
    const q = parseQuestion('how much were flights on the italy trip', { today: '2026-09-29', categories: DEFAULT_CATEGORIES, merchants: [], tags: ['Italy 2026'] })!;
    expect(q).toMatchObject({ tag: 'Italy 2026', categoryId: 'travel' });
  });
});
