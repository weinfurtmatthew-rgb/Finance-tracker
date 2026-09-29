import { describe, expect, it } from 'vitest';
import {
  affordability, doublingYears, estimateApy, fiPlan, growth, inTodaysDollars, loanPayment, monthlyRate, monthsToReach, payoff, realRate,
  runway, simulateRetirement, trueCost,
} from '../src/lib/plan';

describe('compound growth', () => {
  it('monthly rate compounds back to the yearly rate', () => {
    expect(Math.pow(1 + monthlyRate(0.045), 12) - 1).toBeCloseTo(0.045, 10);
  });
  it('lump sum at 7% for 30 years (matches published fee-drag example)', () => {
    // $100,000 at 7% for 30 years ≈ $761,226
    expect(growth(10_000_000, 0, 0.07, 30).at(-1)!.balance / 100).toBeCloseTo(761_226, -1);
  });
  it('monthly deposits into a 4.5% APY savings account', () => {
    const g = growth(500_000, 30_000, 0.045, 5);
    expect(g).toHaveLength(6);
    expect(g[5].contributed).toBe(500_000 + 30_000 * 60);
    // $5,000 + $300/mo for 5 years at 4.5% APY ≈ $26,400
    expect(g[5].balance / 100).toBeGreaterThan(26_000);
    expect(g[5].balance / 100).toBeLessThan(26_800);
  });
  it('inflation and doubling', () => {
    expect(inTodaysDollars(10_000_000, 0.03, 10)).toBe(7_440_939);
    expect(realRate(0.07, 0.03)).toBeCloseTo(0.0388, 4);
    expect(doublingYears(0.07).rule72).toBeCloseTo(10.29, 2);
    expect(doublingYears(0.07).exact).toBeCloseTo(10.24, 2);
  });
  it('months to reach a target', () => {
    expect(monthsToReach(0, 50_000, 0, 600_000)).toBe(12);
    expect(monthsToReach(700_000, 0, 0, 600_000)).toBe(0);
    expect(monthsToReach(0, 0, 0, 100)).toBeNull();
  });
});

describe('runway', () => {
  it('months of spending covered and time to a 6-month cushion', () => {
    const r = runway(1_200_000, 400_000, 6, 50_000);
    expect(r.months).toBe(3);
    expect(r.target).toBe(2_400_000);
    expect(r.gap).toBe(1_200_000);
    expect(r.monthsToTarget).toBe(24);
  });
});

describe('affordability', () => {
  it('standard loan payment', () => {
    // $20,000 at 6% for 60 months ≈ $386.66
    expect(loanPayment(2_000_000, 0.06, 60)).toBe(38_666);
    expect(loanPayment(1_200_000, 0, 12)).toBe(100_000);
  });
  it('cash purchase that keeps a healthy cushion', () => {
    const a = affordability({ price: 100_000, financed: false, downPayment: 0, apr: 0, months: 0, cash: 2_000_000, monthlySpending: 400_000, monthlySurplus: 80_000, leftAfterBills: 500_000, returnRate: 0.07 });
    expect(a.verdict).toBe('comfortable');
    expect(a.cashAfter).toBe(1_900_000);
    expect(a.opportunity[1].value).toBeGreaterThan(190_000); // $1,000 → ~$1,967 in 10 years at 7%
  });
  it('financed purchase whose payment exceeds the monthly surplus', () => {
    const a = affordability({ price: 3_000_000, financed: true, downPayment: 300_000, apr: 0.07, months: 60, cash: 1_000_000, monthlySpending: 400_000, monthlySurplus: 30_000, returnRate: 0.07 });
    expect(a.monthlyPayment).toBe(loanPayment(2_700_000, 0.07, 60));
    expect(a.surplusAfter).toBeLessThan(0);
    expect(a.verdict).toBe('stretch');
  });
});

describe('debt payoff', () => {
  const debts = [
    { id: 'a', name: 'Card A', balance: 500_000, apr: 0.2499, minPayment: 15_000 },
    { id: 'b', name: 'Card B', balance: 100_000, apr: 0.1499, minPayment: 3_500 },
    { id: 'c', name: 'Car loan', balance: 1_200_000, apr: 0.069, minPayment: 30_000 },
  ];
  it('avalanche pays the highest APR first and costs the least interest', () => {
    const av = payoff(debts, 20_000, 'avalanche');
    const sb = payoff(debts, 20_000, 'snowball');
    expect(av.neverPaidOff).toBe(false);
    expect(av.totalInterest).toBeLessThanOrEqual(sb.totalInterest);
    expect(sb.order[0].name).toBe('Card B'); // smallest balance first
    expect(av.order.findIndex((o) => o.name === 'Card A')).toBeLessThan(av.order.findIndex((o) => o.name === 'Car loan'));
    expect(av.remaining.at(-1)).toBe(0);
  });
  it('flags payments that never catch up with interest', () => {
    expect(payoff([{ id: 'x', name: 'X', balance: 1_000_000, apr: 0.3, minPayment: 10_000 }], 0, 'avalanche').neverPaidOff).toBe(true);
  });
  it('extra payments shorten the payoff', () => {
    expect(payoff(debts, 50_000, 'avalanche').months).toBeLessThan(payoff(debts, 0, 'avalanche').months);
  });
});

describe('true cost & independence', () => {
  it('true cost of $150/month', () => {
    const [ten] = trueCost(15_000, 0.07, [10]);
    expect(ten.spent).toBe(1_800_000);
    expect(ten.invested / 100).toBeGreaterThan(25_000); // ~$25.9k invested at 7%
  });
  it('FI target is 25x yearly spending at a 4% withdrawal rate', () => {
    const p = fiPlan({ annualSpending: 4_000_000, invested: 5_000_000, monthlyInvesting: 150_000, monthlyIncome: 600_000, nominalReturn: 0.07, inflation: 0.03, withdrawalRate: 0.04 });
    expect(p.target).toBe(100_000_000);
    expect(p.savingsRate).toBeCloseTo(0.25);
    expect(p.years).toBeGreaterThan(20);
    expect(p.years).toBeLessThan(35);
  });
  it('simulation: 4% withdrawals usually last 30 years; 8% often do not', () => {
    const safe = simulateRetirement({ balance: 100_000_000, annualWithdrawal: 4_000_000, years: 30, meanReturn: 0.07, volatility: 0.15, inflation: 0.03, seed: 1 });
    const risky = simulateRetirement({ balance: 100_000_000, annualWithdrawal: 8_000_000, years: 30, meanReturn: 0.07, volatility: 0.15, inflation: 0.03, seed: 1 });
    expect(safe.successRate).toBeGreaterThan(0.6);
    expect(risky.successRate).toBeLessThan(safe.successRate - 0.3);
    expect(safe.medianPath).toHaveLength(31);
    expect(risky.runsOutYearP10).not.toBeNull();
    // Same seed, same answer.
    expect(simulateRetirement({ balance: 100_000_000, annualWithdrawal: 4_000_000, years: 30, meanReturn: 0.07, volatility: 0.15, inflation: 0.03, seed: 1 }).successRate).toBe(safe.successRate);
  });
  it('APY estimated from interest received', () => {
    // $45 of interest over 12 months on an average $1,000 → ~4.6% APY
    expect(estimateApy(4_500, 100_000, 12)).toBeCloseTo(0.046, 3);
    expect(estimateApy(0, 100_000, 12)).toBeNull();
  });
});

import { planSnapshot, estimateMinPayment, TYPICAL_CARD_APR } from '../src/lib/planData';
import { makeBook } from '../src/lib/networth';
import { spendingByMonth } from '../src/lib/budgets';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Account, Transaction } from '../src/types';

describe('plan snapshot', () => {
  const acct = (id: string, type: Account['type'], openingBalance: number, extra: Partial<Account> = {}): Account => ({ id, name: id, type, institution: '', openingBalance, archived: false, createdAt: 0, ...extra });
  let n = 0;
  const tx = (accountId: string, date: string, amount: number, categoryId: string, payee = 'x'): Transaction => ({ id: String(n++), accountId, date, amount, description: payee, payee, categoryId, notes: '', source: 'manual', createdAt: 0 });
  const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
  const accounts = [acct('chk', 'checking', 500_000), acct('sav', 'savings', 1_000_000), acct('card', 'credit', -200_000), acct('loan', 'loan', -1_000_000, { apr: 0.05, minPayment: 30_000 })];
  const txns: Transaction[] = [];
  for (const m of ['06', '07', '08']) {
    txns.push(tx('chk', `2026-${m}-01`, 400_000, 'income'), tx('chk', `2026-${m}-05`, -300_000, 'groceries'), tx('sav', `2026-${m}-28`, 3_500, 'interest'));
  }
  const snap = planSnapshot({ accounts, book: makeBook(accounts, txns, []), txns, months: spendingByMonth(txns, cats, []), today: '2026-09-15' });

  it('averages the last full months and sums cash', () => {
    expect(snap.averagedMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(snap.monthlySpending).toBe(300_000);
    expect(snap.monthlyIncome).toBe(400_000 + 3_500);
    expect(snap.cash).toBe(500_000 + 300_000 * 1 + 1_000_000 + 10_500);
  });

  it('lists debts with typed or typical rates', () => {
    const card = snap.debts.find((d) => d.id === 'card')!;
    expect(card.apr).toBe(TYPICAL_CARD_APR);
    expect(card.aprEstimated).toBe(true);
    expect(card.minPayment).toBe(estimateMinPayment({ type: 'credit' }, 200_000, TYPICAL_CARD_APR));
    const loan = snap.debts.find((d) => d.id === 'loan')!;
    expect(loan).toMatchObject({ apr: 0.05, minPayment: 30_000, aprEstimated: false });
  });

  it('estimates savings APY from interest received, or uses the typed rate', () => {
    expect(snap.apySource).toBe('interest');
    expect(snap.apy!).toBeGreaterThan(0.035);
    expect(snap.apy!).toBeLessThan(0.05);
    const typed = accounts.map((a) => (a.id === 'sav' ? { ...a, apy: 0.041 } : a));
    const s2 = planSnapshot({ accounts: typed, book: makeBook(typed, txns, []), txns, months: spendingByMonth(txns, cats, []), today: '2026-09-15' });
    expect(s2).toMatchObject({ apy: 0.041, apySource: 'account' });
  });

  it('card minimum is interest + 1%, at least $25', () => {
    expect(estimateMinPayment({ type: 'credit' }, 1_000, 0.2)).toBe(1_000);
    expect(estimateMinPayment({ type: 'credit' }, 100_000, 0.24)).toBe(3_000);
  });
});
