import Dexie, { type Table } from 'dexie';
import type { Account, Budget, Category, CsvMapping, MetaEntry, Recurring, Rule, Transaction } from './types';
import { DEFAULT_CATEGORIES } from './lib/categories';

export class FinanceDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  rules!: Table<Rule, string>;
  csvMappings!: Table<CsvMapping, string>;
  meta!: Table<MetaEntry, string>;
  recurring!: Table<Recurring, string>;
  budgets!: Table<Budget, string>;

  constructor(name = 'finance-tracker') {
    super(name);
    this.version(1).stores({
      accounts: 'id, type, archived, createdAt',
      transactions: 'id, accountId, date, categoryId, importId, [accountId+date]',
      categories: 'id, group, order',
      rules: 'id, createdAt',
      csvMappings: 'signature',
      meta: 'key',
    });
    // v2: subscriptions & bills. Existing data is kept; Dexie just adds the new table.
    this.version(2).stores({
      recurring: 'id, kind, status',
    });
    // v3: monthly category budgets.
    this.version(3).stores({
      budgets: 'categoryId',
    });
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES);
    });
  }
}

export const db = new FinanceDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}

export const newId = (): string => crypto.randomUUID();

export async function eraseEverything(): Promise<void> {
  db.close();
  await db.delete();
  location.reload();
}
