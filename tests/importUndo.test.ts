import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { diffRows, IMPORT_UNDO_KEY, recordImport, takeSnapshot, undoLastImport } from '../src/lib/importUndo';
import type { Account, Transaction } from '../src/types';

const tx = (id: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, accountId: 'a', date: '2026-09-01', amount, description: 'X', payee: 'X', categoryId: 'dining', notes: '', source: 'csv', createdAt: 0, ...extra,
});
const account: Account = { id: 'a', name: 'Checking', type: 'checking', institution: '', openingBalance: 0, archived: false, createdAt: 0 };

describe('diffRows', () => {
  it('finds added rows, and the old copies of changed and removed ones', () => {
    const before = [tx('1', -100), tx('2', -200), tx('3', -300)];
    const after = [tx('1', -100), tx('2', -250), tx('4', -400)];
    const d = diffRows(before, after, (t) => t.id);
    expect(d.added).toEqual(['4']);
    expect(d.before.map((t) => [t.id, t.amount])).toEqual([['2', -200], ['3', -300]]);
  });
});

describe('undo an import', () => {
  it('puts everything back the way it was, newest import first', async () => {
    await db.accounts.put(account);
    await db.transactions.bulkPut([tx('old', -100), tx('merged', -500)]);
    const original = await takeSnapshot();

    // An import: two new rows, one merged into an existing line, a balance set, a new account.
    const before = await takeSnapshot();
    await db.transactions.bulkAdd([tx('n1', -1000), tx('n2', -2000)]);
    await db.transactions.update('merged', { altImportIds: ['x'] });
    await db.accounts.update('a', { openingBalance: 5000 });
    await db.accounts.add({ ...account, id: 'b', name: 'Venmo' });
    await recordImport(before, '2 transactions into Checking');

    // A second import on top.
    const before2 = await takeSnapshot();
    await db.transactions.add(tx('n3', -3000));
    await recordImport(before2, '1 transaction into Checking');
    expect(((await db.meta.get(IMPORT_UNDO_KEY))?.value as unknown[]).length).toBe(2);

    expect((await undoLastImport())?.label).toBe('1 transaction into Checking');
    expect(await db.transactions.get('n3')).toBeUndefined();
    expect(await db.transactions.get('n1')).toBeDefined();

    expect((await undoLastImport())?.label).toBe('2 transactions into Checking');
    const now = await takeSnapshot();
    const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(now.transactions)).toEqual(byId(original.transactions));
    expect(byId(now.accounts)).toEqual(byId(original.accounts));
    expect(await undoLastImport()).toBeUndefined();
  });

  it("doesn't record an import that changed nothing", async () => {
    await db.meta.delete(IMPORT_UNDO_KEY);
    await recordImport(await takeSnapshot(), 'nothing');
    expect(await db.meta.get(IMPORT_UNDO_KEY)).toBeUndefined();
  });
});
