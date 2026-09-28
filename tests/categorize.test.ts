import { describe, expect, it } from 'vitest';
import { categorize, guessCategory } from '../src/lib/categorize';
import { cleanPayee } from '../src/lib/payee';
import { importIds, prepareImport } from '../src/lib/importer';
import { accountBalance, openingBalanceFor } from '../src/lib/balances';
import { summarizeMonth } from '../src/lib/summary';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Account, Rule, Transaction } from '../src/types';

describe('cleanPayee', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee'],
    ['STARBUCKS STORE 01234', 'Starbucks'],
    ['AMAZON MKTPL*2K4AB1C23 AMZN.COM/BILL WA', 'Amazon'],
    ['TRADER JOE S #552 CAMBRIDGE MA', "Trader Joe's"],
    ['CHECKCARD 0902 SHAWS 1234 BOSTON MA', 'Shaws'],
    ['NETFLIX.COM         LOS GATOS    CA', 'Netflix'],
    ['SHELL OIL 57444281508 BOSTON MA', 'Shell Oil'],
    ['Local Bakery', 'Local Bakery'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanPayee(raw)).toBe(expected);
  });
});

describe('guessCategory', () => {
  it.each([
    ['WHOLEFDS CAM 10234', -8217, 'groceries'],
    ['SHELL OIL 57444281508', -4102, 'gas'],
    ['T-MOBILE AUTOPAY', -7000, 'bills'],
    ['DISCOVER E-PAYMENT 1234', -41233, 'transfer'],
    ['CAPITAL ONE MOBILE PYMT', -25000, 'transfer'],
    ['AUTOPAY PAYMENT - THANK YOU', 25000, 'transfer'],
    ['T-MOBILE *POSTPAID', -7000, 'bills'],
    ['BEST BUY 00012', -19999, 'shopping'],
    ['CURRENT ACCOUNT FEE', -500, 'uncategorized'],
    ['ACME CORP PAYROLL', 240000, 'income'],
    ['DIVIDEND RECEIVED SPAXX', 123, 'interest'],
    ['YOU BOUGHT VTI', -56020, 'investments'],
    ['RANDOM MERCHANT', -1000, 'uncategorized'],
    ['RANDOM REFUND', 1000, 'income'],
    ['SHELL OIL REFUND', 1000, 'gas'],
    ['INTEREST CHARGE ON PURCHASES', -1500, 'fees'],
  ])('%s (%i) → %s', (desc, amount, expected) => {
    expect(guessCategory(desc, amount)).toBe(expected);
  });
});

describe('categorize', () => {
  const rules: Rule[] = [
    { id: '1', match: 'coffee', categoryId: 'dining', createdAt: 0 },
    { id: '2', match: 'blue bottle coffee', payee: 'Blue Bottle', categoryId: 'groceries', createdAt: 0 },
  ];
  it('your rules win, longest match first', () => {
    expect(categorize({ description: 'SQ *BLUE BOTTLE COFFEE', payee: 'Blue Bottle Coffee', amount: -525 }, rules)).toEqual({
      payee: 'Blue Bottle',
      categoryId: 'groceries',
    });
  });
  it('specific merchant keywords beat the bank’s broad category', () => {
    expect(categorize({ description: 'NETFLIX.COM 866-579-7172 CA', payee: 'Netflix', amount: -1549, bankCategory: 'Services' }, []).categoryId).toBe('subscriptions');
  });
  it('then the bank category', () => {
    expect(categorize({ description: 'XYZ', payee: 'Xyz', amount: -100, bankCategory: 'Supermarkets' }, [])).toEqual({ payee: 'Xyz', categoryId: 'groceries' });
    expect(categorize({ description: 'DIRECTPAY', payee: 'Directpay', amount: 41233, bankCategory: 'Payments and Credits' }, []).categoryId).toBe('transfer');
    expect(categorize({ description: 'CASHBACK', payee: 'Cashback', amount: 1250, bankCategory: 'Awards and Rebate Credits' }, []).categoryId).toBe('income');
  });
  it('refunds keep the purchase category so they offset spending', () => {
    expect(categorize({ description: 'AMAZON RETURN', payee: 'Amazon', amount: 2399, bankCategory: 'Merchandise' }, []).categoryId).toBe('shopping');
    expect(categorize({ description: 'AMAZON RETURN', payee: 'Amazon', amount: 2399 }, []).categoryId).toBe('shopping');
  });
});

describe('duplicate detection', () => {
  const drafts = [
    { date: '2026-09-10', amount: -645, description: 'STARBUCKS STORE 01234' },
    { date: '2026-09-10', amount: -645, description: 'STARBUCKS STORE 01234' },
    { date: '2026-09-11', amount: -525, description: 'SQ *BLUE BOTTLE COFFEE' },
  ];
  it('keeps identical rows within a file, but ids are stable across imports', () => {
    const a = importIds('acct', drafts);
    expect(new Set(a).size).toBe(3);
    expect(importIds('acct', drafts)).toEqual(a);
  });
  it('flags rows already imported from an overlapping file', () => {
    const first = importIds('acct', drafts.slice(0, 2));
    const prepared = prepareImport('acct', drafts, new Set(first), []);
    expect(prepared.map((p) => p.duplicate)).toEqual([true, true, false]);
  });
  it('uses FITID for OFX', () => {
    expect(importIds('acct', [{ date: '2026-09-10', amount: 1, description: 'x', fitid: 'F1' }])).toEqual(['acct:ofx:F1']);
  });
});

describe('balances & summaries', () => {
  const account: Account = { id: 'a', name: 'Checking', type: 'checking', institution: '', openingBalance: 0, archived: false, createdAt: 0 };
  const t = (date: string, amount: number, categoryId: string): Transaction => ({
    id: `${date}${amount}`, accountId: 'a', date, amount, description: '', payee: '', categoryId, notes: '', source: 'manual', createdAt: 0,
  });
  const txns = [t('2026-09-01', 240000, 'income'), t('2026-09-02', -5000, 'dining'), t('2026-09-03', 1000, 'dining'), t('2026-09-04', -30000, 'transfer'), t('2026-09-30', -2000, 'gas')];

  it('sets an opening balance that matches a statement balance as of a date', () => {
    const opening = openingBalanceFor('a', txns, 500000, '2026-09-04');
    expect(accountBalance({ ...account, openingBalance: opening }, txns, '2026-09-04')).toBe(500000);
    expect(accountBalance({ ...account, openingBalance: opening }, txns)).toBe(498000);
  });

  it('month summary ignores transfers and nets refunds', () => {
    const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
    const s = summarizeMonth(txns, cats, '2026-09');
    expect(s.income).toBe(240000);
    expect(s.spent).toBe(6000);
    expect(s.byCategory).toEqual([
      { categoryId: 'dining', spent: 4000 },
      { categoryId: 'gas', spent: 2000 },
    ]);
  });
});
