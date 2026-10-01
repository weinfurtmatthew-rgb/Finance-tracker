import { describe, expect, it } from 'vitest';
import { categoryHighlight, categoryMonths, lastMonths, placeKey, placeMonths, placeStats, topPlaces } from '../src/lib/detail';
import type { Transaction } from '../src/types';

let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: 'a', date, amount, description: payee.toUpperCase(), payee, categoryId, notes: '', source: 'csv', createdAt: 0, ...extra,
});

const txns = [
  tx('2026-07-03', -5000, 'dining', 'Chipotle'),
  tx('2026-08-03', -4000, 'dining', 'Chipotle'),
  tx('2026-08-20', -6000, 'dining', 'Olive Garden'),
  tx('2026-09-05', -1500, 'dining', 'chipotle '),
  tx('2026-09-06', -8000, 'dining', 'Olive Garden'),
  // Half of this one was groceries.
  tx('2026-09-07', -4000, 'dining', 'Target', { splits: [{ id: 's1', categoryId: 'dining', amount: -2000 }, { id: 's2', categoryId: 'groceries', amount: -2000 }] }),
  tx('2026-09-08', 1500, 'dining', 'Chipotle'), // refund
];

describe('category months', () => {
  it('adds up each month, counting split parts in their own category and refunds against it', () => {
    expect(lastMonths('2026-09', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(categoryMonths(txns, 'dining', ['2026-07', '2026-08', '2026-09'])).toEqual([5000, 10000, 10000]);
    expect(categoryMonths(txns, 'groceries', ['2026-09'])).toEqual([2000]);
  });
});

describe('categoryHighlight', () => {
  const labels = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  it('calls out the priciest month in a while', () => {
    expect(categoryHighlight('Dining', [16200, 19000, 17100, 20500, 16800, 24600], labels, 16, 31)).toBe(
      'Oct is already your priciest dining month in a year, and it’s only day 16.',
    );
    expect(categoryHighlight('Dining', [30000, 19000, 17100, 20500, 16800, 24600], labels, 31, 31)).toBe('Oct is your priciest dining month since May.');
  });
  it('otherwise compares the pace with the usual', () => {
    expect(categoryHighlight('Dining', [20000, 20000, 20000, 20000, 20000, 5000], labels, 15, 30)).toBe(
      'At this pace dining lands near $100 this month, $100 under your usual $200.',
    );
    expect(categoryHighlight('Dining', [20000, 20000, 20000, 20000, 20000, 10000], labels, 15, 30)).toBe('Dining is right around your usual $200 a month.');
  });
  it('needs a couple of months first', () => {
    expect(categoryHighlight('Dining', [0, 0, 0, 0, 5000, 4000], labels, 10, 31)).toBeNull();
  });
});

describe('places', () => {
  it('groups a store across spellings, biggest first', () => {
    const places = topPlaces(txns, 'dining', '2026-09-01', '2026-09-30');
    expect(places.map((p) => [p.key, p.count, p.total])).toEqual([
      ['olive garden', 1, 8000],
      ['target', 1, 2000],
      ['chipotle', 1, 1500],
    ]);
    expect(placeKey({ payee: ' Chipotle ', description: '' })).toBe('chipotle');
  });
  it('sums up a store’s history', () => {
    const s = placeStats(txns, 'chipotle', '2026-09-29')!;
    expect(s.count).toBe(3);
    expect(s.total).toBe(10500);
    expect(s.average).toBe(3500);
    expect(s.yearTotal).toBe(10500);
    expect(s.first).toBe('2026-07-03');
    expect(s.last).toBe('2026-09-08');
    expect(s.categoryId).toBe('dining');
    expect(placeMonths(s, ['2026-08', '2026-09'])).toEqual([4000, 1500]);
    expect(placeStats(txns, 'nowhere', '2026-09-29')).toBeNull();
  });
});
