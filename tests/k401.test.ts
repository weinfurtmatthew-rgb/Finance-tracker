import { describe, expect, it } from 'vitest';
import { k401Limit, k401Totals, k401Year, missedMatch } from '../src/lib/k401';
import { balanceOn, makeBook, staleValued } from '../src/lib/networth';
import { planSnapshot } from '../src/lib/planData';
import { moneyHealth, type HealthInput } from '../src/lib/health';
import { accountTypeFor } from '../src/lib/rocketmoney';
import { typeName } from '../src/screens/AccountEditor';
import type { Account } from '../src/types';

const acct = (id: string, type: Account['type'], extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type,
  institution: '',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
  ...extra,
});
const PAY = 10_000_000; // $100,000 a year
// 50% of what you put in, on up to 6% of your pay.
const plan = (rate: number, extra: Partial<Account> = {}) =>
  acct('k', '401k', { contributionRate: rate, employerMatch: 0.5, employerMatchUpTo: 0.06, ...extra });

describe('401(k) limits', () => {
  it('uses the IRS limit, with the catch-up at 50 and the bigger one at 60 to 63', () => {
    expect(k401Limit(2025)).toEqual({ limit: 2_350_000, catchUp: false, estimated: false });
    expect(k401Limit(2026).limit).toBe(2_450_000);
    expect(k401Limit(2026, 1976).limit).toBe(3_250_000); // 50
    expect(k401Limit(2026, 1966).limit).toBe(3_575_000); // 60
    expect(k401Limit(2026, 1962).limit).toBe(3_250_000); // 64: back to the usual catch-up
    expect(k401Limit(2024, 1963).limit).toBe(3_050_000); // 61, before the bigger catch-up began
    expect(k401Limit(2027)).toEqual({ limit: 2_450_000, catchUp: false, estimated: true });
  });
});

describe('a year of a 401(k)', () => {
  it('works out what you and your employer put in, and the match you miss', () => {
    const low = k401Year(plan(0.04), PAY, 2_450_000);
    expect(low).toEqual({ yours: 400_000, match: 200_000, fullMatch: 300_000, fullMatchAt: 0.06, overLimit: false });
    expect(missedMatch(low)).toBe(100_000);
    const full = k401Year(plan(0.1), PAY, 2_450_000);
    expect(full.match).toBe(300_000);
    expect(missedMatch(full)).toBe(0);
  });

  it('stops at the limit', () => {
    const y = k401Year(plan(0.3), PAY, 2_450_000);
    expect(y.yours).toBe(2_450_000);
    expect(y.overLimit).toBe(true);
  });

  it('a match without a cap follows what you put in, so none is missed', () => {
    const y = k401Year(plan(0.05, { employerMatch: 1, employerMatchUpTo: undefined }), PAY, 2_450_000);
    expect(y.match).toBe(500_000);
    expect(y.fullMatchAt).toBeNull();
    expect(missedMatch(y)).toBe(0);
  });

  it('adds up your 401(k)s, needing your pay and a contribution rate', () => {
    const old = acct('old', '401k'); // a past job's: value only
    const now = plan(0.06);
    expect(k401Totals([old, now], undefined, 2026)).toBeNull();
    expect(k401Totals([old], PAY, 2026)).toBeNull();
    const t = k401Totals([old, now], PAY, 2026)!;
    expect(t.plans.map((p) => p.account.id)).toEqual(['k']);
    expect([t.yours, t.match, t.monthly]).toEqual([600_000, 300_000, 75_000]);
  });
});

describe('401(k)s in your numbers', () => {
  const k = plan(0.06, { type: 'roth-401k' });
  const book = makeBook([k], [], [{ id: 'v', accountId: 'k', date: '2026-09-01', value: 5_000_000 }]);

  it('is its value, entered by hand, and asks for a new one now and then', () => {
    expect(balanceOn(book, k)).toBe(5_000_000);
    expect(staleValued(book, '2026-10-15')).toEqual([k]);
  });

  it('counts as invested, and what goes in each month is saving', () => {
    const snap = planSnapshot({ accounts: [k], book, txns: [], months: new Map(), today: '2026-09-29', pay: PAY });
    expect(snap.invested).toBe(5_000_000);
    expect(snap.retirementMonthly).toBe(75_000);
    expect(planSnapshot({ accounts: [k], book, txns: [], months: new Map(), today: '2026-09-29' }).retirementMonthly).toBe(0);
  });

  it('counts in Money Health’s savings rate, as money earned and saved', () => {
    const input: HealthInput = {
      months: 3,
      monthlyIncome: 500_000,
      monthlySpending: 450_000,
      cash: 0,
      invested: 0,
      debt: 0,
      lateBills: 0,
      lateFees: 0,
      budgets: 0,
      goals: 0,
      tracked: 0,
      has: { cash: true, invest: true, debt: false },
    };
    const earn = (i: HealthInput) => moneyHealth(i)!.pillars.find((p) => p.key === 'earn')!;
    expect(earn(input).metric).toBe('Saving 10% of what comes in');
    // $500 a month into a 401(k): (5,000 + 500 − 4,500) / 5,500.
    expect(earn({ ...input, retirementMonthly: 50_000 }).metric).toBe('Saving 18% of what comes in, with your 401(k)');
  });

  it('comes in from a Rocket Money export as a 401(k), and is named right', () => {
    expect(accountTypeFor({ key: 'a', label: '', name: 'Acme 401(k)', type: 'Retirement' })).toBe('401k');
    expect(accountTypeFor({ key: 'b', label: '', name: 'Roth 401k' })).toBe('roth-401k');
    expect(accountTypeFor({ key: 'c', label: '', name: 'School 403(b)' })).toBe('401k');
    expect(accountTypeFor({ key: 'd', label: '', name: 'Rollover IRA' })).toBe('ira');
    expect(typeName('401k')).toBe('401(k) / 403(b)');
    expect(typeName('wallet')).toBe('Payment app');
  });
});
