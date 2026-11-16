import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/dates';
import {
  burstLayout,
  dayPart,
  debtPaidDown,
  freshness,
  goalMilestone,
  greeting,
  isMonday,
  lastSevenDays,
  lastWeek,
  netWorthHigh,
  opensNow,
  standing,
  weekAhead,
  weekStart,
  worthALook,
} from '../src/lib/morning';
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

describe('Mondays: last week', () => {
  it('knows Mondays and where a week starts', () => {
    expect(isMonday('2026-09-28')).toBe(true);
    expect(isMonday('2026-09-29')).toBe(false);
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // a Sunday belongs to the week before it
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });
  it('Monday through Sunday before this week, by category and by place', () => {
    const txns = [
      ...Array.from({ length: 6 }, (_, i) => tx(addDays('2026-08-10', i * 7), -5000, 'Market', 'groceries')),
      tx('2026-09-21', -6000, 'Market', 'groceries'),
      tx('2026-09-22', -1200, 'Cafe', 'coffee'),
      tx('2026-09-23', -900, 'Cafe', 'coffee'),
      tx('2026-09-25', 1500, 'Market', 'groceries'), // a refund
      tx('2026-09-26', -4000, 'Cinema', 'entertainment'),
      tx('2026-09-27', -45000, 'Card payment', 'card-payment'),
      tx('2026-09-28', -999, 'This Monday', 'shopping'),
      tx('2026-09-20', -777, 'Sunday before', 'shopping'),
    ];
    const w = lastWeek(txns, cats, [], '2026-09-28');
    expect([w.from, w.to]).toEqual(['2026-09-21', '2026-09-27']);
    expect(w.total).toBe(6000 + 1200 + 900 - 1500 + 4000);
    expect(w.categories).toEqual([
      { categoryId: 'groceries', amount: 4500 },
      { categoryId: 'entertainment', amount: 4000 },
      { categoryId: 'coffee', amount: 2100 },
    ]);
    expect(w.places[0]).toEqual({ name: 'Market', amount: 4500, count: 2 });
    expect(w.places.map((p) => p.name)).toEqual(['Market', 'Cinema', 'Cafe']);
    expect(w.usual).toBeGreaterThan(0);
  });
});

describe('worth a look', () => {
  const today = '2026-09-28';
  const old = [
    tx('2026-06-01', -1500, 'Starter', 'other'), // the history starts in June
    ...['2026-07-02', '2026-08-02', '2026-09-02'].map((d) => tx(d, -4500, 'Gym', 'fitness')),
  ];
  it('flags a possible double charge, a fee, an unusual charge and a big first visit', () => {
    const recent = [
      tx('2026-09-25', -2350, 'Pizza Place', 'dining'),
      tx('2026-09-25', -2350, 'Pizza Place', 'dining'),
      tx('2026-09-26', -3500, 'Overdraft fee', 'fees'),
      tx('2026-09-27', -14500, 'Gym', 'fitness'),
      tx('2026-09-27', -32000, 'New Store', 'shopping'),
      tx('2026-09-27', -608, 'Coffee', 'coffee'),
      tx('2026-09-27', -608, 'Coffee', 'coffee'), // too small to call a double charge
    ];
    const looks = worthALook([...old, ...recent], cats, today);
    expect(looks.map((l) => l.kind)).toEqual(['double', 'fee', 'unusual', 'new']);
    expect(looks[0].txn.payee).toBe('Pizza Place');
    expect(looks[0].other?.payee).toBe('Pizza Place');
    expect(looks[2].usual).toBe(4500);
  });
  it('a first visit is not news when the history only just started', () => {
    const fresh = [tx('2026-09-01', -1000, 'Starter', 'other'), tx('2026-09-27', -32000, 'New Store', 'shopping')];
    expect(worthALook(fresh, cats, today)).toEqual([]);
  });
});

describe('milestones', () => {
  const chk = acct('chk', 'checking', 100000);
  const card = acct('card', 'credit');
  it('a new net worth high this week: above every day before it, and no dip since', () => {
    const txns = [
      tx('2026-06-05', 10000, 'Pay', 'income'),
      tx('2026-07-05', 10000, 'Pay', 'income'),
      tx('2026-08-05', -5000, 'Rent', 'housing'),
      tx('2026-09-25', 30000, 'Pay', 'income'),
    ];
    expect(netWorthHigh(makeBook([chk], txns, []), '2026-09-28')).toBe(true);
    const lower = [...txns.slice(0, 3), tx('2026-09-25', 1000, 'Pay', 'income')];
    expect(netWorthHigh(makeBook([chk], lower, []), '2026-09-28')).toBe(false);
    // Higher than ever earlier in the week, and down since: not a high today.
    const dipped = [...txns.slice(0, 3), tx('2026-09-22', 50000, 'Pay', 'income'), tx('2026-09-26', -30000, 'Rent', 'housing')];
    expect(netWorthHigh(makeBook([chk], dipped, []), '2026-09-28')).toBe(false);
    // Too little history to call it a high.
    expect(netWorthHigh(makeBook([chk], [tx('2026-09-01', 10000, 'Pay', 'income')], []), '2026-09-28')).toBe(false);
  });
  it('debt paid down since a date', () => {
    const txns = [tx('2026-08-01', -60000, 'Store', 'shopping', 'card'), tx('2026-09-10', 40000, 'Payment', 'card-payment', 'card')];
    const book = makeBook([chk, card], txns, []);
    expect(debtPaidDown(book, '2026-08-28')).toBe(40000);
    expect(debtPaidDown(book, '2026-07-28')).toBe(0); // owed more now than then
  });
  it('a goal passing a quarter mark in the last 7 days', () => {
    const sav = acct('sav', 'savings');
    const goal = { accountId: 'sav', target: 100000 };
    const at = (txns: Transaction[]) => goalMilestone(makeBook([sav], txns, []), goal, '2026-09-28');
    const before = tx('2026-09-01', 45000, 'Transfer', 'transfer', 'sav');
    expect(at([before, tx('2026-09-25', 10000, 'Transfer', 'transfer', 'sav')])).toBe(50);
    expect(at([before, tx('2026-09-25', 4000, 'Transfer', 'transfer', 'sav')])).toBe(null); // 49%: not there yet
    expect(at([before, tx('2026-09-15', 10000, 'Transfer', 'transfer', 'sav')])).toBe(null); // passed it, but before the week
    expect(at([before, tx('2026-09-25', 60000, 'Transfer', 'transfer', 'sav')])).toBe(100);
    expect(goalMilestone(makeBook([sav], [], []), { accountId: 'gone', target: 100000 }, '2026-09-28')).toBe(null);
  });
});

describe('the burst', () => {
  it('areas go with the amounts, biggest in the middle, and it fits the width', () => {
    const { bubbles, height } = burstLayout([400, 100, 100, 25], 340);
    expect(bubbles).toHaveLength(4);
    // Area goes with the amount: a quarter of it, half the radius.
    expect(bubbles[1].r / bubbles[0].r).toBeCloseTo(0.5, 5);
    expect(bubbles[3].r / bubbles[0].r).toBeCloseTo(0.25, 5);
    // The next biggest goes beside the first, not above it (the space is wide).
    expect(Math.abs(bubbles[1].y - bubbles[0].y)).toBeLessThan(1e-6);
    for (const b of bubbles) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r).toBeLessThanOrEqual(340);
      expect(b.y - b.r).toBeGreaterThanOrEqual(0);
      expect(b.y + b.r).toBeLessThanOrEqual(height);
    }
    // Each one overlaps one before it a little, and none overlaps another by much.
    for (let i = 1; i < bubbles.length; i++) {
      const gaps = bubbles.slice(0, i).map((o) => Math.hypot(o.x - bubbles[i].x, o.y - bubbles[i].y) / (o.r + bubbles[i].r));
      expect(Math.min(...gaps)).toBeLessThan(1);
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(0.86 - 1e-6);
    }
  });
  it('shrinks to fit, and one amount is one centered circle', () => {
    const many = burstLayout([500, 480, 470, 460, 450, 440], 300);
    for (const b of many.bubbles) expect(b.x + b.r).toBeLessThanOrEqual(300 + 1e-9);
    const one = burstLayout([120], 340);
    expect(one.bubbles[0].x).toBeCloseTo(170, 5);
    expect(one.height).toBeCloseTo(128 + 8, 5);
    expect(burstLayout([], 340).bubbles).toEqual([]);
  });
});
