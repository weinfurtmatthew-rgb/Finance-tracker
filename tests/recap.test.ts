import { describe, expect, it } from 'vitest';
import { autoRecapYear, buildRecap, last12Months, previousPeriod, spendingStyle, yearPeriod } from '../src/lib/recap';
import { makeBook } from '../src/lib/networth';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Account, Recurring, Transaction } from '../src/types';

let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: 'chk', date, amount, description: payee.toUpperCase(), payee, categoryId, notes: '', source: 'csv', createdAt: 0, ...extra,
});
const accounts: Account[] = [{ id: 'chk', name: 'Checking', type: 'checking', institution: '', openingBalance: 100_000, archived: false, createdAt: 0 }];

/** Two years of data: paychecks, coffee most days, a monthly subscription, one big purchase. */
function data() {
  const txns: Transaction[] = [];
  for (const year of [2025, 2026]) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      if (year === 2026 && m > 9) break;
      const pay = year === 2026 && m >= 6 ? 260_000 : 250_000;
      txns.push(tx(`${year}-${mm}-01`, pay, 'income', 'Acme Payroll'), tx(`${year}-${mm}-15`, pay, 'income', 'Acme Payroll'));
      txns.push(tx(`${year}-${mm}-03`, -1_549, 'subscriptions', 'Netflix'));
      txns.push(tx(`${year}-${mm}-05`, -150_000, 'housing', 'Oak Apartments'));
      for (let d = 2; d <= 26; d += 3) txns.push(tx(`${year}-${mm}-${String(d).padStart(2, '0')}`, -575, 'coffee', 'Starbucks'));
      txns.push(tx(`${year}-${mm}-20`, year === 2026 ? -30_000 : -15_000, 'dining', 'Chipotle'));
    }
  }
  txns.push(tx('2026-07-04', -129_900, 'electronics', 'Best Buy', { tags: ['Laptop'] }));
  return txns;
}
const netflix: Recurring = { id: 'r', name: 'Netflix', kind: 'subscription', frequency: 'monthly', match: 'netflix', amount: -1_549, status: 'active', createdAt: 0 };

describe('year in review', () => {
  const txns = data();
  const r = buildRecap({
    period: yearPeriod(2026, '2026-09-29'),
    txns,
    accounts,
    book: makeBook(accounts, txns, []),
    categories: DEFAULT_CATEGORIES,
    recurring: [netflix],
    budgets: [{ categoryId: 'dining', limit: 50_000, createdAt: 0 }],
    goals: [],
  });

  it('totals, top categories and your #1 spot', () => {
    expect(r.period.label).toBe('2026 so far');
    expect(r.earned).toBe((250_000 * 2 * 5) + (260_000 * 2 * 4));
    expect(r.topCategories[0]).toMatchObject({ id: 'housing', value: 150_000 * 9 });
    expect(r.topMerchants.find((m) => m.id === 'Starbucks')).toMatchObject({ visits: 81 });
    expect(r.habit).toMatchObject({ name: 'Starbucks', visits: 81, average: 575 });
    expect(r.savingsRate).toBeGreaterThan(0.3);
  });

  it('big moments: biggest purchase and the priciest month', () => {
    // Rent and bills aren't "purchases".
    expect(r.biggest).toMatchObject({ payee: 'Best Buy', amount: 129_900 });
    expect(r.topMerchants.map((m) => m.id)).not.toContain('Oak Apartments');
    expect(r.priciestMonth?.month).toBe('2026-07');
  });

  it('no-spend days and when you spend', () => {
    expect(r.noSpend!.days).toBeGreaterThan(100);
    expect(r.noSpend!.longest).toBeGreaterThanOrEqual(2);
    expect(r.weekdays?.busiest).toBeTruthy();
  });

  it('subscriptions, trips, budgets', () => {
    expect(r.subscriptions).toMatchObject({ total: 1_549 * 9, count: 1 });
    expect(r.trips).toEqual([{ tag: 'Laptop', total: 129_900, from: '2026-07-04', to: '2026-07-04' }]);
    expect(r.budgets!.monthsTracked).toBeGreaterThan(0);
  });

  it('spots the raise and compares with last year', () => {
    expect(r.income).toMatchObject({ mainPayer: 'Acme Payroll', paychecks: 18 });
    expect(r.income!.raise!.pct).toBeCloseTo(0.04, 2);
    // Dining doubled ($150 → $300 a month, +$1,350) and the laptop is new (+$1,299).
    expect(r.vsLastYear!.up.slice(0, 2)).toMatchObject([
      { id: 'dining', value: 135_000 },
      { id: 'electronics', value: 129_900 },
    ]);
  });

  it('net worth change and a spending style', () => {
    expect(r.netWorth).toMatchObject({ change: r.saved, known: true });
    expect(r.style?.name).toBeTruthy();
  });

  it('leaves cards out when there is not enough data', () => {
    const few = [tx('2026-09-20', -500, 'coffee', 'Starbucks')];
    const small = buildRecap({ period: yearPeriod(2026, '2026-09-29'), txns: few, accounts, book: makeBook(accounts, few, []), categories: DEFAULT_CATEGORIES, recurring: [], budgets: [], goals: [] });
    expect(small.habit).toBeUndefined();
    expect(small.priciestMonth).toBeUndefined();
    expect(small.weekdays).toBeUndefined();
    expect(small.vsLastYear).toBeUndefined();
    expect(small.noSpend).toBeUndefined();
    // Data only starts this year, so there's no honest "change since January".
    expect(small.netWorth?.known).toBe(false);
  });
});

describe('periods and timing', () => {
  it('periods', () => {
    expect(yearPeriod(2025, '2026-09-29')).toMatchObject({ from: '2025-01-01', to: '2025-12-31', label: '2025' });
    expect(last12Months('2026-03-31')).toMatchObject({ from: '2025-04-01', to: '2026-03-31' });
    expect(previousPeriod(yearPeriod(2026, '2026-09-29'))).toMatchObject({ from: '2025-01-01', to: '2025-09-29' });
  });
  it('opens by itself in December (this year) and early January (last year)', () => {
    expect(autoRecapYear('2026-12-02')).toBe(2026);
    expect(autoRecapYear('2027-01-10')).toBe(2026);
    expect(autoRecapYear('2027-01-20')).toBeNull();
    expect(autoRecapYear('2026-09-29')).toBeNull();
  });
  it('styles', () => {
    expect(spendingStyle({ savingsRate: 0.1 }, new Map([['travel', 5000]]), 10000)?.name).toBe('The Explorer');
    expect(spendingStyle({ savingsRate: 0.1 }, new Map([['other', 5000]]), 10000)?.name).toBe('The All-Rounder');
  });
});
