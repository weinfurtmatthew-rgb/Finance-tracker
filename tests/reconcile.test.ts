import { describe, expect, it } from 'vitest';
import { findDuplicates, findGap, matchBank, reconcile } from '../src/lib/reconcile';
import type { Account, Transaction } from '../src/types';

const acct = (type: Account['type'], openingBalance = 0, extra: Partial<Account> = {}): Account => ({
  id: 'a', name: 'A', type, institution: '', openingBalance, archived: false, createdAt: 0, ...extra,
});
let n = 0;
const tx = (date: string, amount: number, payee: string, createdAt = 1, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: 'a', date, amount, description: payee.toUpperCase(), payee, categoryId: 'dining', notes: '', source: 'csv', createdAt, ...extra,
});

describe('balance check', () => {
  it('matches when the numbers agree', () => {
    const r = reconcile({ account: acct('checking', 10_000), txns: [tx('2026-09-01', -2_500, 'Cafe')], bankBalance: 7_500, today: '2026-09-29' });
    expect(r).toMatchObject({ matches: true, difference: 0 });
  });

  it('cards: the bank shows what you owe as a positive number', () => {
    const r = reconcile({ account: acct('credit'), txns: [tx('2026-09-01', -4_000, 'Shop')], bankBalance: 4_000, today: '2026-09-29' });
    expect(r.matches).toBe(true);
  });

  it('finds a charge imported twice (pending, then posted) and knows removing it fixes the balance', () => {
    const txns = [
      tx('2026-09-10', -1_299, 'Blue Door Cafe', 1, { importId: 'a:csv:pending1:0' }),
      tx('2026-09-11', -1_299, 'Blue Door Cafe Boston', 2, { importId: 'a:csv:posted1:0' }),
      tx('2026-09-12', -500, 'Deli', 2, { importId: 'a:csv:deli:0' }),
    ];
    const r = reconcile({ account: acct('checking', 10_000), txns, bankBalance: 10_000 - 1_299 - 500, today: '2026-09-29' });
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicatesExplain).toBe(true);
    expect(r.difference).toBe(-1_299);
  });

  it('two identical coffees the bank lists separately are not duplicates', () => {
    expect(findDuplicates([tx('2026-09-10', -500, 'Starbucks', 7, { importId: 'a:csv:h1:0' }), tx('2026-09-10', -500, 'Starbucks', 7, { importId: 'a:csv:h1:1' })])).toHaveLength(0);
    expect(findDuplicates([tx('2026-09-10', -500, 'Starbucks', 7, { importId: 'a:ofx:111' }), tx('2026-09-10', -500, 'Starbucks', 8, { importId: 'a:ofx:222' })])).toHaveLength(0);
  });

  it('a hand-entered purchase that later arrives in a bank file is the duplicate', () => {
    const [p] = findDuplicates([tx('2026-09-10', -800, 'Farmers Market', 1, { source: 'manual' }), tx('2026-09-11', -800, 'Farmers Market', 2)]);
    expect(p.extra.source).toBe('manual');
  });

  it('spots a missing stretch of transactions', () => {
    const txns: Transaction[] = [];
    for (let d = 1; d <= 30; d += 2) txns.push(tx(`2026-07-${String(d).padStart(2, '0')}`, -100, 'x'));
    for (let d = 1; d <= 29; d += 2) txns.push(tx(`2026-09-${String(d).padStart(2, '0')}`, -100, 'x'));
    expect(findGap(txns, '2026-09-29')).toEqual({ from: '2026-07-30', to: '2026-08-31' });
    expect(findGap(txns.filter((t) => t.date >= '2026-09-01'), '2026-09-29')).toBeUndefined();
  });

  it('"match my bank" sets the starting balance the first time, then records an adjustment', () => {
    const txns = [tx('2026-09-01', -2_500, 'Cafe')];
    const first = reconcile({ account: acct('checking', 0), txns, bankBalance: 97_500, today: '2026-09-29' });
    expect(first.neverChecked).toBe(true);
    expect(matchBank(acct('checking', 0), first)).toEqual({ openingBalance: 100_000 });
    const later = reconcile({ account: acct('checking', 100_000, { checkedOn: '2026-08-01' }), txns, bankBalance: 97_000, today: '2026-09-29' });
    expect(matchBank(acct('checking', 100_000, { checkedOn: '2026-08-01' }), later)).toEqual({ adjustment: -500 });
    const card = acct('credit', 0, { checkedOn: '2026-08-01' });
    const owed = reconcile({ account: card, txns: [tx('2026-09-01', -4_000, 'Shop')], bankBalance: 4_500, today: '2026-09-29' });
    expect(matchBank(card, owed)).toEqual({ adjustment: -500 });
  });
});

import { oldGuesses } from '../src/lib/cleanup';

describe('tidy-up of old guesses', () => {
  const t = (payee: string, amount: number, categoryId: string, categorySource?: Transaction['categorySource'], accountId = 'chk'): Transaction => ({
    id: `g${n++}`, accountId, date: '2026-05-01', amount, description: payee.toUpperCase(), payee, categoryId, categorySource, notes: '', source: 'csv', createdAt: 0,
  });
  const accounts = [acct('checking'), { ...acct('credit'), id: 'card' }].map((a, i) => ({ ...a, id: i ? 'card' : 'chk' }));
  it('finds guessed categories and leaves your choices alone', () => {
    const txns = [
      t('Mystery Shop', -500, 'other'), // legacy bank "Other"
      t('Acme Llc', 5000, 'income'), // legacy unknown money-in
      t('Acme Corp Payroll', 250000, 'income'), // keyword says income: fine
      t('Refund Co', 900, 'income', undefined, 'card'), // money back on a card is never income
      t('Corner Deli', -700, 'uncategorized'),
      t('My Pick', -300, 'other', 'user'),
      t('Rule Pick', 4000, 'income', 'rule'),
      t('Blue Cafe', -600, 'dining', 'keyword'),
    ];
    expect(oldGuesses(txns, [], accounts).map((x) => x.payee).sort()).toEqual(['Acme Llc', 'Corner Deli', 'Mystery Shop', 'Refund Co']);
  });
});
