import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../src/db';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';

describe('database upgrade to v5', () => {
  it('moves existing card payments from Transfer to Credit Card Payment', async () => {
    // A database as the app left it before this version (schema v4, no card-payment category).
    const old = new Dexie('upgrade-test');
    old.version(4).stores({
      accounts: 'id, type, archived, createdAt',
      transactions: 'id, accountId, date, categoryId, importId, [accountId+date]',
      categories: 'id, group, order',
      rules: 'id, createdAt',
      csvMappings: 'signature',
      meta: 'key',
      recurring: 'id, kind, status',
      budgets: 'categoryId',
      valuations: 'id, accountId, date',
      goals: 'id',
    });
    await old.open();
    await old.table('categories').bulkAdd(DEFAULT_CATEGORIES.filter((c) => c.id !== 'card-payment'));
    const tx = (id: string, description: string, amount: number, categoryId = 'transfer') => ({
      id, accountId: 'a', date: '2026-09-01', amount, description, payee: description, categoryId, notes: '', source: 'csv', createdAt: 0,
    });
    await old.table('transactions').bulkAdd([
      tx('1', 'DISCOVER E-PAYMENT 7788', -41233),
      tx('2', 'INTERNET PAYMENT - THANK YOU', 40000),
      tx('3', 'ONLINE TRANSFER TO SAVINGS', -50000),
      tx('4', 'STARBUCKS', -500, 'dining'),
    ]);
    await old.table('recurring').add({ id: 'r', name: 'Discover', kind: 'card-payment', categoryId: 'transfer', frequency: 'monthly', match: 'discover', amount: -40000, status: 'active', createdAt: 0 });
    old.close();

    const db = new FinanceDB('upgrade-test');
    await db.open();
    expect(await db.categories.get('card-payment')).toMatchObject({ name: 'Credit Card Payment', group: 'transfer' });
    const byId = Object.fromEntries((await db.transactions.toArray()).map((t) => [t.id, t.categoryId]));
    expect(byId).toEqual({ 1: 'card-payment', 2: 'card-payment', 3: 'transfer', 4: 'dining' });
    expect((await db.recurring.get('r'))?.categoryId).toBe('card-payment');
    db.close();
  });
});

describe('database upgrade to v6', () => {
  it('adds the new built-in categories, renames Gifts, and indexes tags', async () => {
    const old = new Dexie('upgrade-v6');
    old.version(5).stores({
      accounts: 'id, type, archived, createdAt',
      transactions: 'id, accountId, date, categoryId, importId, [accountId+date]',
      categories: 'id, group, order',
      rules: 'id, createdAt',
      csvMappings: 'signature',
      meta: 'key',
      recurring: 'id, kind, status',
      budgets: 'categoryId',
      valuations: 'id, accountId, date',
      goals: 'id',
    });
    await old.open();
    const before = DEFAULT_CATEGORIES.filter((c) => !['coffee', 'pets', 'owed', 'charity'].includes(c.id)).map((c) =>
      c.id === 'gifts' ? { ...c, name: 'Gifts & Donations' } : c.id === 'dining' ? { ...c, name: 'Eating Out' } : c,
    );
    await old.table('categories').bulkAdd(before);
    old.close();

    const db = new FinanceDB('upgrade-v6');
    await db.open();
    expect(await db.categories.get('coffee')).toMatchObject({ name: 'Coffee', group: 'expense' });
    expect(await db.categories.get('owed')).toMatchObject({ group: 'transfer' });
    expect((await db.categories.get('gifts'))?.name).toBe('Gifts');
    expect((await db.categories.get('dining'))?.name).toBe('Eating Out'); // your renames are kept
    await db.transactions.add({ id: 't', accountId: 'a', date: '2026-09-01', amount: -100, description: 'x', payee: 'x', categoryId: 'dining', notes: '', source: 'manual', createdAt: 0, tags: ['Italy 2026'] });
    expect(await db.transactions.where('tags').equals('Italy 2026').count()).toBe(1);
    db.close();
  });
});
