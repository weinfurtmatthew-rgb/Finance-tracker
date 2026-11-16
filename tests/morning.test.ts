import { describe, expect, it } from 'vitest';
import { dayPart, freshness, greeting, lastSevenDays, opensNow, standing, weekAhead } from '../src/lib/morning';
import { makeBook } from '../src/lib/networth';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { RecurringStatus, UpcomingItem } from '../src/lib/recurring';
import type { Account, Recurring, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const acct = (id: string, type: Account['type'], openingBalance = 0): Account => ({
  id,
  name: id,
  type,
  institution: '',
  openingBalance,
  archived: false,
  createdAt: 0,
});
let n = 0;
const tx = (date: string, amount: number, payee: string, categoryId: string, accountId = 'chk'): Transaction => ({
  id: `t${n++}`,
  accountId,
  date,
  amount,
  description: payee.toUpperCase(),
  payee,
  categoryId,
  notes: '',
  source: 'csv',
  createdAt: 0,
});

describe('when it opens and how it greets you', () => {
  it('mornings are 4 a.m. to noon; before 4 is still the evening', () => {
    expect([3, 4, 11, 12, 16, 17, 23].map(dayPart)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });
  it('opens once a day, in the morning, when there is data', () => {
    const base = { hour: 8, today: '2026-09-28', hasData: true };
    expect(opensNow(base)).toBe(true);
    expect(opensNow({ ...base, seen: '2026-09-27' })).toBe(true);
    expect(opensNow({ ...base, seen: '2026-09-28' })).toBe(false);
    expect(opensNow({ ...base, hour: 12 })).toBe(false);
    expect(opensNow({ ...base, hasData: false })).toBe(false);
  });
  it('greets by name when there is one', () => {
    expect(greeting(8)).toBe('Good morning');
    expect(greeting(14, ' Sam ')).toBe('Good afternoon, Sam');
    expect(greeting(20, '')).toBe('Good evening');
  });
});

describe('freshness', () => {
  it('the newest transaction up to today, and whether an import would help', () => {
    const txns = [tx('2026-09-20', -500, 'A', 'dining'), tx('2026-09-24', -500, 'B', 'dining'), tx('2026-10-02', -500, 'Later', 'dining')];
    expect(freshness(txns, '2026-09-27')).toEqual({ newest: '2026-09-24', age: 3, behind: false });
    expect(freshness(txns, '2026-09-28').behind).toBe(true);
    expect(freshness([], '2026-09-28')).toEqual({ behind: false });
  });
});

describe('standing', () => {
  const chk = acct('chk', 'checking', 100000);
  const sav = acct('sav', 'savings', 50000);
  const card = acct('card', 'credit');
  const txns = [
    tx('2026-08-01', 240000, 'Acme', 'income'),
    tx('2026-09-20', -30000, 'Store', 'shopping', 'card'),
    tx('2026-09-25', 240000, 'Acme', 'income'),
    tx('2026-09-26', 10000, 'Interest', 'interest', 'sav'),
  ];
  it('net worth, its change over 7 days, cash and what is on cards', () => {
    const s = standing(makeBook([chk, sav, card], txns, []), '2026-09-28');
    expect(s.netWorth).toBe(100000 + 240000 + 240000 + 50000 + 10000 - 30000);
    expect(s.week?.total).toBe(250000);
    expect(s.week?.accounts.map((a) => a.account.id)).toEqual(['chk', 'sav']);
    expect(s.cash).toBe(100000 + 480000 + 60000);
    expect(s.cards).toBe(30000);
  });
  it('no 7-day change when the history is shorter than that, and no cards without a card', () => {
    const s = standing(makeBook([chk], [tx('2026-09-25', 240000, 'Acme', 'income')], []), '2026-09-28');
    expect(s.week).toBeNull();
    expect(s.cards).toBeNull();
  });
});

describe('the last 7 days', () => {
  const today = '2026-09-28';
  // Two months of $70 a week at the grocery store, then a bigger week.
  const usual = Array.from({ length: 9 }, (_, i) =>
    tx(`2026-${i < 4 ? '07' : '08'}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, -7000, 'Market', 'groceries'),
  );
  const week = [
    tx('2026-09-22', -12000, 'Market', 'groceries'),
    tx('2026-09-23', -165000, 'Oak Apartments', 'housing'),
    tx('2026-09-24', 2500, 'Market', 'groceries'), // a refund
    tx('2026-09-25', 240000, 'Acme payroll', 'income'),
    tx('2026-09-26', -45000, 'Card payment', 'card-payment'),
    tx('2026-09-27', -21000, 'Best Buy', 'shopping'),
    tx('2026-09-21', -9999, 'Last Monday', 'shopping'), // a day before the 7 days
  ];
  const r = lastSevenDays([...usual, ...week], cats, [], today);
  it('counts spending as Spending does: purchases minus refunds, no transfers', () => {
    expect(r.from).toBe('2026-09-22');
    expect(r.spent.total).toBe(12000 + 165000 - 2500 + 21000);
  });
  it('compares with a usual week from the weeks before', () => {
    expect(r.spent.usual).toBeGreaterThan(0);
    expect(r.spent.usual).toBeLessThan(12000);
  });
  it('lists money in and the biggest purchases', () => {
    expect(r.income.total).toBe(240000);
    expect(r.income.items.map((t) => t.payee)).toEqual(['Acme payroll']);
    expect(r.biggest.map((t) => t.payee)).toEqual(['Oak Apartments', 'Best Buy', 'Market']);
  });
  it('no usual week without two full weeks of history before', () => {
    expect(lastSevenDays(week, cats, [], today).spent.usual).toBeNull();
  });
});

describe('the week ahead', () => {
  const rec = (kind: Recurring['kind'], name: string): Recurring => ({
    id: name,
    name,
    kind,
    frequency: 'monthly',
    match: name,
    amount: 0,
    status: 'active',
    createdAt: 0,
  });
  const item = (r: Recurring, date: string, amount: number, late = false): UpcomingItem => ({ status: { rec: r } as RecurringStatus, date, amount, late });
  it('lays out bills and paydays over 7 days, with late ones apart', () => {
    const rent = rec('loan', 'Rent');
    const pay = rec('income', 'Pay');
    const phone = rec('bill', 'Phone');
    const w = weekAhead(
      [item(rent, '2026-09-26', -165000, true), item(phone, '2026-09-28', -8500), item(pay, '2026-10-02', 240000), item(rent, '2026-10-05', -165000)],
      '2026-09-28',
    );
    expect(w.days.map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(w.days[0].due.map((i) => i.status.rec.name)).toEqual(['Phone']);
    expect(w.days[4].pay.map((i) => i.status.rec.name)).toEqual(['Pay']);
    expect(w.late.map((i) => i.status.rec.name)).toEqual(['Rent']);
    expect(w.dueTotal).toBe(8500);
    expect(w.payTotal).toBe(240000);
  });
});
