import { describe, expect, it } from 'vitest';
import { contributionsByYear, iraDeadline, iraLimit, iraRoom, spotContributions, taxYearsFor } from '../src/lib/ira';
import { balanceOn, contributedAfter, makeBook, staleValued } from '../src/lib/networth';
import { planSnapshot } from '../src/lib/planData';
import { retirementProjection } from '../src/lib/plan';
import { accountTypeFor } from '../src/lib/rocketmoney';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Account, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
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
let n = 0;
const tx = (accountId: string, date: string, amount: number, payee: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`,
  accountId,
  date,
  amount,
  description: payee.toUpperCase(),
  payee,
  categoryId: 'uncategorized',
  notes: '',
  source: 'csv',
  createdAt: 0,
  ...extra,
});
const contribution = (accountId: string, date: string, amount: number, year: number, extra: Partial<Transaction> = {}) =>
  tx(accountId, date, amount, 'Contribution', { categoryId: 'investments', source: 'manual', contributionYear: year, ...extra });

describe('IRA limits', () => {
  it('uses the IRS limit for the year, plus the catch-up at 50 and older', () => {
    expect(iraLimit(2025)).toEqual({ limit: 700_000, catchUp: false, estimated: false });
    expect(iraLimit(2026)).toEqual({ limit: 750_000, catchUp: false, estimated: false });
    expect(iraLimit(2026, 1976).limit).toBe(860_000); // turns 50 in 2026
    expect(iraLimit(2026, 1977).limit).toBe(750_000);
    // A year the IRS hasn't announced yet uses the latest known limit, and says so.
    expect(iraLimit(2027)).toEqual({ limit: 750_000, catchUp: false, estimated: true });
  });

  it('can count for last year until April 15', () => {
    expect(iraDeadline(2026)).toBe('2027-04-15');
    expect(taxYearsFor('2027-04-15')).toEqual([2026, 2027]);
    expect(taxYearsFor('2027-04-16')).toEqual([2027]);
    expect(taxYearsFor('2026-09-29')).toEqual([2026]);
  });

  it('adds up every IRA for the year', () => {
    const txns = [
      contribution('roth', '2026-01-10', 300_000, 2026),
      contribution('trad', '2026-06-01', 200_000, 2026),
      contribution('roth', '2026-02-01', 100_000, 2025),
    ];
    expect(contributionsByYear(txns)).toEqual(
      new Map([
        [2026, 500_000],
        [2025, 100_000],
      ]),
    );
    expect(iraRoom(2026, txns)).toMatchObject({ contributed: 500_000, left: 250_000, deadline: '2027-04-15' });
    expect(iraRoom(2025, txns).left).toBe(600_000);
  });
});

describe('an IRA is its last value plus what went in since', () => {
  const roth = acct('roth', 'roth-ira');
  const values = [{ id: 'v', accountId: 'roth', date: '2026-06-30', value: 2_000_000 }];
  const txns = [
    contribution('roth', '2026-05-01', 50_000, 2026),
    contribution('roth', '2026-07-15', 50_000, 2026),
    contribution('roth', '2026-09-01', 50_000, 2026),
  ];
  const book = makeBook([roth], txns, values);

  it('adds contributions after the last value, not before it', () => {
    expect(balanceOn(book, roth)).toBe(2_100_000);
    expect(balanceOn(book, roth, '2026-08-01')).toBe(2_050_000);
    expect(contributedAfter(book, 'roth', '2026-06-30')).toBe(100_000);
  });

  it('before its first value, backs out what went in after that day', () => {
    expect(balanceOn(book, roth, '2026-04-30')).toBe(1_950_000);
  });

  it('with no value yet, is what went in; and asks for a value like any investment', () => {
    const fresh = makeBook([roth], txns, []);
    expect(balanceOn(fresh, roth)).toBe(150_000);
    expect(staleValued(fresh, '2026-09-29')).toEqual([roth]);
  });

  it('counts as invested in the plan', () => {
    const snap = planSnapshot({ accounts: [roth], book, txns, months: new Map(), today: '2026-09-29' });
    expect(snap.invested).toBe(2_100_000);
    expect(snap.cash).toBe(0);
  });
});

describe('spotting contributions in bank files', () => {
  const checking = acct('chk', 'checking');
  const card = acct('card', 'credit');
  const roth = acct('roth', 'roth-ira', { institution: 'Ally Invest' });
  const accounts = [checking, card, roth];
  const spot = (txns: Transaction[], reviewed: string[] = [], today = '2026-09-29') =>
    spotContributions({ txns, accounts, categories: cats, reviewed: new Set(reviewed), today }).map((s) => s.txn.payee);

  it('finds money sent from checking to a brokerage, or to the bank an IRA is at', () => {
    const txns = [
      tx('chk', '2026-09-03', -50_000, 'Fidelity Investments'),
      tx('chk', '2026-09-04', -25_000, 'Ally Invest Transfer'),
      tx('chk', '2026-09-05', -10_000, 'Roth IRA deposit'),
      tx('chk', '2026-09-06', -6_000, 'Chipotle'),
      tx('card', '2026-09-07', -9_900, 'Vanguard'), // a card, not a bank account
      tx('chk', '2026-09-08', 100_000, 'Vanguard'), // money in
      tx('chk', '2025-06-01', -50_000, 'Schwab'), // a tax year that's closed
    ];
    expect(spot(txns)).toEqual(['Fidelity Investments', 'Ally Invest Transfer', 'Roth IRA deposit']);
  });

  it('never asks again about lines you confirmed or said no to', () => {
    const sent = tx('chk', '2026-09-03', -50_000, 'Fidelity');
    const no = tx('chk', '2026-09-10', -50_000, 'Fidelity');
    const linked = contribution('roth', '2026-09-03', 50_000, 2026, { contributionFrom: sent.id });
    expect(spot([sent, no, linked], [no.id])).toEqual([]);
  });

  it('matches a contribution you added by hand for the same amount that week', () => {
    const sent = tx('chk', '2026-09-03', -50_000, 'Fidelity');
    const typed = contribution('roth', '2026-09-01', 50_000, 2026);
    const found = spotContributions({ txns: [sent, typed], accounts, categories: cats, reviewed: new Set(), today: '2026-09-29' });
    expect(found[0].match?.id).toBe(typed.id);
  });

  it('needs an IRA to look for', () => {
    expect(
      spotContributions({
        txns: [tx('chk', '2026-09-03', -50_000, 'Fidelity')],
        accounts: [checking],
        categories: cats,
        reviewed: new Set(),
        today: '2026-09-29',
      }),
    ).toEqual([]);
  });

  it('counts the bank an IRA is at only for transfers, and never a card payment', () => {
    const chaseIra = acct('chase-ira', 'ira', { institution: 'Chase' });
    const txns = [
      tx('chk', '2026-09-01', -50_000, 'Online Transfer to Chase', { categoryId: 'transfer' }),
      tx('chk', '2026-09-02', -40_000, 'Chase Credit Crd Autopay', { categoryId: 'card-payment' }),
      tx('chk', '2026-09-03', -3_000, 'Chase Field Concessions', { categoryId: 'dining' }),
      tx('chk', '2026-09-04', -2_000, 'Purchasers Club', { categoryId: 'uncategorized' }),
    ];
    const found = spotContributions({ txns, accounts: [checking, chaseIra], categories: cats, reviewed: new Set(), today: '2026-09-29' });
    expect(found.map((s) => s.txn.payee)).toEqual(['Online Transfer to Chase']);
  });

  it('comes in from a Rocket Money export as the right kind of IRA', () => {
    expect(accountTypeFor({ key: 'a', label: '', name: 'Roth IRA', type: 'Investment' })).toBe('roth-ira');
    expect(accountTypeFor({ key: 'b', label: '', name: 'Rollover IRA' })).toBe('ira');
    expect(accountTypeFor({ key: 'c', label: '', name: '401(k)', type: 'Retirement' })).toBe('401k');
  });
});

describe('retirement projection', () => {
  it('grows what you have and what you add, and says what it could pay each month', () => {
    const p = retirementProjection({ start: 1_000_000, yearly: 0, nominalReturn: 0.07, inflation: 0, years: 10, withdrawalRate: 0.04 });
    expect(p.end.balance).toBe(Math.round(1_000_000 * 1.07 ** 10));
    expect(p.monthlyIncome).toBe(Math.round((p.real * 0.04) / 12));
    const adding = retirementProjection({ start: 0, yearly: 120_000, nominalReturn: 0, inflation: 0.03, years: 2, withdrawalRate: 0.04 });
    expect(adding.end.contributed).toBe(240_000);
    expect(adding.real).toBe(Math.round(240_000 / 1.03 ** 2));
  });
});
