import { describe, expect, it } from 'vitest';
import { balanceOn, changeSince, goalProgress, historyDates, makeBook, netWorthHistory, staleValued } from '../src/lib/networth';
import type { Account, Transaction, Valuation } from '../src/types';

const acct = (id: string, type: Account['type'], openingBalance = 0): Account => ({ id, name: id, type, institution: '', openingBalance, archived: false, createdAt: 0 });
let n = 0;
const tx = (accountId: string, date: string, amount: number): Transaction => ({
  id: `t${n++}`, accountId, date, amount, description: '', payee: '', categoryId: 'other', notes: '', source: 'csv', createdAt: 0,
});
const val = (accountId: string, date: string, value: number): Valuation => ({ id: `v${n++}`, accountId, date, value });

const checking = acct('chk', 'checking', 100000);
const card = acct('card', 'credit');
const brokerage = acct('brk', 'brokerage');
const car = acct('car', 'vehicle');
const txns = [
  tx('chk', '2026-07-05', 240000), tx('chk', '2026-07-20', -50000),
  tx('chk', '2026-08-05', 240000), tx('card', '2026-08-10', -30000),
  tx('chk', '2026-09-05', 240000), tx('card', '2026-09-10', -20000), tx('chk', '2026-09-20', 30000 * -1),
  tx('brk', '2026-08-01', -500000), // a Fidelity "YOU BOUGHT" row: ignored once values exist
];
const vals = [val('brk', '2026-08-15', 1_000_000), val('brk', '2026-09-25', 1_050_000), val('car', '2026-09-01', 1_500_000)];
const book = makeBook([checking, card, brokerage, car], txns, vals);

describe('balances over time', () => {
  it('cash and cards come from transactions', () => {
    expect(balanceOn(book, checking, '2026-06-30')).toBe(100000);
    expect(balanceOn(book, checking, '2026-07-31')).toBe(290000);
    expect(balanceOn(book, checking)).toBe(740000);
    expect(balanceOn(book, card)).toBe(-50000);
  });
  it('investments and vehicles use the latest value, carried back before the first one', () => {
    expect(balanceOn(book, brokerage, '2026-07-31')).toBe(1_000_000);
    expect(balanceOn(book, brokerage, '2026-09-24')).toBe(1_000_000);
    expect(balanceOn(book, brokerage)).toBe(1_050_000);
    expect(balanceOn(book, car, '2026-01-01')).toBe(1_500_000);
  });
  it('net worth history at month ends plus today', () => {
    const dates = historyDates(book, '2026-09-28', '6m');
    expect(dates).toEqual(['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-28']);
    const h = netWorthHistory(book, dates);
    expect(h[3]).toEqual({ date: '2026-09-28', assets: 740000 + 1_050_000 + 1_500_000, debts: 50000, net: 3_240_000 });
    expect(h[1].net).toBe(290000 + 1_000_000 + 1_500_000);
  });
  it('change since last month, per account', () => {
    const c = changeSince(book, '2026-08-31');
    expect(c.total).toBe((740000 - 530000) + (-50000 + 30000) + 50000);
    expect(c.accounts.map((a) => a.account.id)).toEqual(['chk', 'brk', 'card']);
  });
  it('flags values older than 30 days', () => {
    expect(staleValued(book, '2026-09-28').map((a) => a.id)).toEqual([]);
    expect(staleValued(book, '2026-10-15').map((a) => a.id)).toEqual(['car']);
  });
});

describe('goals', () => {
  const savings = acct('sav', 'savings', 200000);
  const sb = makeBook([savings], [tx('sav', '2026-07-01', 30000), tx('sav', '2026-08-01', 30000), tx('sav', '2026-09-01', 30000)], []);
  const goal = { id: 'g', name: 'Emergency fund', emoji: '🛟', target: 500000, accountId: 'sav', createdAt: 0 };

  it('progress, pace and projected date', () => {
    const p = goalProgress(sb, goal, '2026-09-28');
    expect(p).toMatchObject({ saved: 290000, remaining: 210000, done: false, pace: 30000 });
    // $2,100 left at $300/month = 7 months from late September.
    expect(p.projectedDate! > '2027-04-15' && p.projectedDate! < '2027-05-15').toBe(true);
  });
  it('amounts needed for a target date, per month and per paycheck', () => {
    const paydays = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27', '2026-12-11', '2026-12-25', '2027-01-08'];
    const p = goalProgress(sb, { ...goal, targetDate: '2026-12-31' }, '2026-09-28', paydays);
    expect(p.paychecksLeft).toBe(7);
    expect(p.neededPerPaycheck).toBe(30000);
    expect(p.neededMonthly).toBeGreaterThan(65000);
    expect(p.onTrack).toBe(false);
  });
  it('done when the balance reaches the target', () => {
    expect(goalProgress(sb, { ...goal, target: 250000 }, '2026-09-28')).toMatchObject({ done: true, ratio: 1, remaining: 0 });
  });
});
