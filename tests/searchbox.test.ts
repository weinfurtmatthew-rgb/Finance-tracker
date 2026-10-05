import { describe, expect, it } from 'vitest';
import { addRecent, buildSearchIndex, looksLikeQuestion, matchesQuery, searchPlaces, searchTransactions, topHit } from '../src/lib/search';
import type { Transaction } from '../src/types';

describe('looksLikeQuestion', () => {
  it('sends questions to Ask and leaves plain searches alone', () => {
    expect(looksLikeQuestion('how much did I spend on dining')).toBe(true);
    expect(looksLikeQuestion('Am I over budget')).toBe(true);
    expect(looksLikeQuestion('coffee?')).toBe(true);
    expect(looksLikeQuestion('coffee')).toBe(false);
    expect(looksLikeQuestion('who')).toBe(false);
    expect(looksLikeQuestion('Showtime')).toBe(false);
    expect(looksLikeQuestion('  ')).toBe(false);
  });
});

describe('addRecent', () => {
  it('puts the newest first without repeats', () => {
    expect(addRecent(['coffee', 'Target'], 'target')).toEqual(['target', 'coffee']);
    expect(addRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(addRecent(['a'], '  ')).toEqual(['a']);
  });
});

describe('topHit', () => {
  const cats = [
    { id: 'dining', name: 'Dining' },
    { id: 'coffee', name: 'Coffee' },
    { id: 'gas', name: 'Gas & Fuel' },
  ];
  const places = [
    { key: 'starbucks', name: 'Starbucks', count: 12 },
    { key: 'shell', name: 'Shell', count: 1 },
    { key: 'whole foods', name: 'Whole Foods', count: 4 },
  ];
  it('prefers an exact name, then a category, then a regular store', () => {
    expect(topHit('coffee', cats, places)).toEqual({ kind: 'category', id: 'coffee' });
    expect(topHit('starbucks', cats, places)).toEqual({ kind: 'place', key: 'starbucks' });
    expect(topHit('fuel', cats, places)).toEqual({ kind: 'category', id: 'gas' });
    expect(topHit('star', cats, places)).toEqual({ kind: 'place', key: 'starbucks' });
    expect(topHit('foods', cats, places)).toEqual({ kind: 'place', key: 'whole foods' });
    // One visit isn't enough for a guess, but typing the whole name is.
    expect(topHit('she', cats, places)).toBeNull();
    expect(topHit('shell', cats, places)).toEqual({ kind: 'place', key: 'shell' });
    expect(topHit('s', cats, places)).toBeNull();
  });
});

describe('search index', () => {
  const tx = (id: string, payee: string, amount: number, categoryId: string, extra: Partial<Transaction> = {}): Transaction => ({
    id, accountId: 'a', date: '2026-09-01', amount, description: payee.toUpperCase() + ' #123', payee, categoryId, notes: '', source: 'csv', createdAt: 0, ...extra,
  });
  const txns = [
    tx('1', 'Starbucks', -575, 'coffee'),
    tx('2', 'Chipotle', -1250, 'dining', { tags: ['Italy 2026'], notes: 'lunch with Sam' }),
    tx('3', 'Starbucks', -490, 'coffee'),
    tx('4', 'Payroll', 240000, 'income'),
    tx('5', '', -1999, 'shopping', { description: 'AMZN MKTP' }),
  ];
  const names: Record<string, string> = { coffee: 'Coffee', dining: 'Dining', income: 'Income', shopping: 'Shopping' };
  const index = buildSearchIndex(txns, (id) => names[id]);

  it('finds exactly what matchesQuery (or the category name) finds', () => {
    for (const q of ['star', 'STAR', 'coffee', '#italy', 'italy', 'sam', '12.50', '$12', '-5.75', 'amzn', '#123', 'xyz', '2400']) {
      const expected = txns.filter((t) => matchesQuery(t, q) || names[t.categoryId].toLowerCase().includes(q.trim().toLowerCase())).map((t) => t.id);
      expect(searchTransactions(index, q).map((t) => t.id), q).toEqual(expected);
    }
  });

  it('lists stores by visits', () => {
    expect(searchPlaces(index, 'star')).toEqual([{ key: 'starbucks', name: 'Starbucks', count: 2 }]);
    expect(searchPlaces(index, '', 2).map((p) => p.key)).toEqual(['starbucks', 'chipotle']);
    expect(searchPlaces(index, 'amzn')[0].key).toBe('amzn mktp');
  });
});
