import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdMaturityValue, cdStage, cdValueOn, maturityDate, termLabel, termMonths } from '../src/lib/cd';
import { balanceOn, makeBook, netWorthOn, staleValued } from '../src/lib/networth';
import { planSnapshot } from '../src/lib/planData';
import { accountTypeFor } from '../src/lib/rocketmoney';
import type { Account, Valuation } from '../src/types';

const anchor = (date: string, value: number): Valuation => ({ id: date, accountId: 'cd', date, value });
// $10,000 at 4.00% APY for a year.
const terms = { apy: 0.04, maturesOn: '2026-10-10' };
const deposit = [anchor('2025-10-10', 1_000_000)];

describe('CD terms', () => {
  it('matures the same day of the month, or the last day of a shorter month', () => {
    expect(maturityDate('2025-10-10', 12)).toBe('2026-10-10');
    expect(maturityDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(maturityDate('2026-08-31', 6)).toBe('2027-02-28');
  });
  it('recognizes a standard term, and only that', () => {
    expect(termMonths('2025-10-10', '2026-10-10')).toBe(12);
    expect(termMonths('2026-01-31', '2026-02-28')).toBe(1);
    expect(termMonths('2025-10-10', '2026-10-11')).toBeNull();
    expect([3, 12, 18, 60].map(termLabel)).toEqual(['3 months', '1 year', '18 months', '5 years']);
  });
});

describe('a CD grows on its own', () => {
  it('is worth nothing before the deposit, then grows at its APY until it matures, then holds', () => {
    expect(cdValueOn(terms, deposit, '2025-10-09')).toBe(0);
    expect(cdValueOn(terms, deposit, '2025-10-10')).toBe(1_000_000);
    expect(cdValueOn(terms, deposit, '2026-04-10')).toBe(Math.round(1_000_000 * 1.04 ** (182 / 365)));
    expect(cdValueOn(terms, deposit, '2026-10-10')).toBe(1_040_000);
    expect(cdValueOn(terms, deposit, '2027-03-01')).toBe(1_040_000);
    expect(cdMaturityValue(terms, deposit)).toBe(1_040_000);
  });

  it('stays at the deposit when the interest is paid out elsewhere, or there is no rate', () => {
    expect(cdValueOn({ ...terms, interestPaidOut: true }, deposit, '2026-04-10')).toBe(1_000_000);
    expect(cdValueOn({ maturesOn: '2026-10-10' }, deposit, '2026-04-10')).toBe(1_000_000);
  });

  it('after renewing, keeps the first term as it was and grows the new one at the new rate', () => {
    const renewed = [...deposit, anchor('2026-10-10', 1_040_000)];
    const next = { apy: 0.0425, maturesOn: '2027-10-10' };
    expect(cdValueOn(next, renewed, '2026-04-10')).toBe(cdValueOn(terms, deposit, '2026-04-10'));
    expect(cdValueOn(next, renewed, '2027-04-10')).toBe(Math.round(1_040_000 * 1.0425 ** (182 / 365)));
  });

  it('gives a heads-up two weeks out, then asks once it matures', () => {
    expect(cdStage({ maturesOn: '2026-11-10' }, '2026-09-29')).toBe('growing');
    expect(cdStage({ maturesOn: '2026-10-10' }, '2026-09-29')).toBe('maturing');
    expect(cdStage({ maturesOn: '2026-09-29' }, '2026-09-29')).toBe('matured');
    expect(cdStage({}, '2026-09-29')).toBeNull();
  });
});

describe('CDs in net worth and the plan', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-04-10T12:00:00'), toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

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
  const cd = acct('cd', 'cd', { apy: 0.04, openedOn: '2025-10-10', maturesOn: '2026-10-10' });
  const checking = acct('chk', 'checking', { openingBalance: 500_000 });

  it('counts its grown value today and in history', () => {
    const book = makeBook([checking, cd], [], deposit);
    const today = Math.round(1_000_000 * 1.04 ** (182 / 365));
    expect(balanceOn(book, cd)).toBe(today);
    expect(netWorthOn(book).net).toBe(500_000 + today);
    expect(netWorthOn(book, '2025-09-30').net).toBe(500_000);
    // It never needs a value typed in, so it's never "out of date".
    expect(staleValued(book, '2026-04-10')).toEqual([]);
  });

  it('is an investment in the plan, not cash', () => {
    const snap = planSnapshot({ accounts: [checking, cd], book: makeBook([checking, cd], [], deposit), txns: [], months: new Map(), today: '2026-04-10' });
    expect(snap.invested).toBe(Math.round(1_000_000 * 1.04 ** (182 / 365)));
    expect(snap.cash).toBe(500_000);
  });

  it('once cashed out, stays in history until the day it closed', () => {
    const closed = { ...cd, archived: true, closedOn: '2026-10-10' };
    const book = makeBook([checking, closed], [], deposit);
    expect(netWorthOn(book, '2026-06-30').net).toBe(500_000 + cdValueOn(cd, deposit, '2026-06-30'));
    expect(netWorthOn(book, '2026-10-31').net).toBe(500_000);
    expect(balanceOn(book, closed, '2026-10-31')).toBe(0);
  });

  it('comes in from a Rocket Money export as a CD', () => {
    expect(accountTypeFor({ key: 'a', label: '', name: '12 Month CD', type: 'Certificate of Deposit' })).toBe('cd');
    expect(accountTypeFor({ key: 'b', label: '', name: 'Share Certificate' })).toBe('cd');
    expect(accountTypeFor({ key: 'c', label: '', name: 'Sapphire', type: 'Credit Card' })).toBe('credit');
  });
});
