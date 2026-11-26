import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { accountLines, type Line } from '../src/lib/bankTrades';
import { merchantName } from '../src/lib/payee';
import { addLineTrades, keepOutLines, moveLineTrades, tradesForImport } from '../src/lineTrades';
import type { Account, Transaction } from '../src/types';

const FXAIX = 'YOU BOUGHT PROSPECTUS UNDER SEPARATE COVER FIDELITY 500 INDEX FUND (FXAIX) (Cash)';
const account = (id: string, name: string): Account => ({
  id,
  name,
  type: 'brokerage',
  institution: 'Fidelity',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
});
const txn = (id: string, date: string, patch: Partial<Transaction> = {}): Transaction => ({
  id,
  accountId: 'brk',
  date,
  amount: -10_000,
  description: FXAIX,
  // How it was named before brokerage lines were read.
  payee: merchantName(FXAIX),
  categoryId: 'investments',
  notes: '',
  source: 'csv',
  createdAt: 0,
  ...patch,
});

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.trades.clear(), db.securities.clear(), db.meta.clear()]);
  await db.accounts.bulkAdd([account('brk', 'Fidelity Brokerage'), account('ira', 'Roth IRA')]);
});

const lines = async () => accountLines((await db.accounts.get('brk'))!, await db.transactions.toArray(), await db.trades.toArray());

describe('putting lines’ trades into holdings', () => {
  it('adds each, names the stock, and gives its line the name that says what it bought', async () => {
    await db.transactions.bulkAdd([
      txn('a', '2026-09-08', { security: { ticker: 'FXAIX', shares: 0.525 } }),
      txn('b', '2026-09-14', { payee: 'My index fund' }),
      txn('c', '2026-09-21', { noTrade: true }),
    ]);
    const missing = (await lines()).filter((l) => l.state !== 'added') as (Line & { ticker: string })[];
    await addLineTrades(missing);
    const trades = await db.trades.orderBy('date').toArray();
    expect(trades.map((t) => [t.date, t.ticker, t.amount, t.shares, t.txnId, t.source])).toEqual([
      ['2026-09-08', 'FXAIX', 10_000, 0.525, 'a', 'import'],
      ['2026-09-14', 'FXAIX', 10_000, undefined, 'b', 'import'],
      ['2026-09-21', 'FXAIX', 10_000, undefined, 'c', 'import'],
    ]);
    expect((await db.securities.get('FXAIX'))?.name).toBe('FIDELITY 500 INDEX FUND');
    expect((await db.transactions.get('a'))?.payee).toBe('Bought FXAIX');
    // A name you chose stays.
    expect((await db.transactions.get('b'))?.payee).toBe('My index fund');
    // One you'd kept out is in now.
    expect((await db.transactions.get('c'))?.noTrade).toBeUndefined();
    expect((await lines()).map((l) => l.state)).toEqual(['added', 'added', 'added']);
  });

  it('a deleted trade’s line stays out', async () => {
    await db.transactions.add(txn('a', '2026-09-08'));
    const [trade] = await addLineTrades((await lines()) as (Line & { ticker: string })[]);
    await db.trades.delete(trade.id);
    await keepOutLines([trade]);
    expect((await lines()).map((l) => l.state)).toEqual(['kept-out']);
  });

  it('a line moved to another account or day takes its trade along', async () => {
    await db.transactions.add(txn('a', '2026-09-08'));
    await addLineTrades((await lines()) as (Line & { ticker: string })[]);
    await db.transactions.update('a', { accountId: 'ira', date: '2026-09-09' });
    await moveLineTrades([{ id: 'a', changes: { accountId: 'ira', date: '2026-09-09' } }]);
    expect((await db.trades.toArray()).map((t) => [t.accountId, t.date, t.txnId])).toEqual([['ira', '2026-09-09', 'a']]);
    expect(accountLines((await db.accounts.get('ira'))!, await db.transactions.toArray(), await db.trades.toArray()).map((l) => l.state)).toEqual(['added']);
  });
});

describe('after an import', () => {
  it('adds them where holdings are tracked and says what it did, and what waits', async () => {
    await db.trades.add({ id: 'held', accountId: 'brk', ticker: 'VTI', date: '2026-08-01', kind: 'buy', amount: 50_000, source: 'manual', createdAt: 0 });
    await db.transactions.bulkAdd([txn('a', '2026-09-08'), txn('b', '2026-09-14'), txn('c', '2026-09-14', { accountId: 'ira' })]);
    const r = await tradesForImport(new Set(['a', 'b', 'c']));
    expect(r.notes).toEqual({
      added: '2 purchases of FXAIX also went into Fidelity Brokerage’s holdings.',
      waiting: 'A purchase of FXAIX can go into Roth IRA’s holdings: open the account in Net Worth to add it.',
    });
    expect(
      (await db.trades.toArray())
        .filter((t) => t.txnId)
        .map((t) => t.txnId)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('says when a sale is of shares bought before the files start', async () => {
    await db.transactions.add(txn('s', '2026-09-20', { description: 'YOU SOLD APPLE INC (AAPL) (Cash)', amount: 115_000 }));
    const r = await tradesForImport(new Set(['s']));
    expect(r.notes).toEqual({
      unheld:
        'A sale of AAPL is of shares bought before your files start: open the account in Net Worth to add when you bought them, and it goes in with its gain.',
    });
    expect(await db.trades.count()).toBe(0);
  });

  it('says nothing when the lines aren’t trades', async () => {
    await db.transactions.add(txn('a', '2026-09-08', { description: 'Electronic Funds Transfer Received (Cash)', amount: 10_000 }));
    expect((await tradesForImport(new Set(['a']))).notes).toEqual({});
  });
});
