/**
 * Undo for imports. An import adds transactions, but it can also create an account, set an account's
 * balance, merge payment-app lines into bank lines and remember a file's columns. So before an import
 * the app takes a copy of those tables, and afterwards keeps only the difference: what was added, and
 * how every row it changed or removed looked before. Undo deletes the one and puts back the other.
 *
 * The last few imports can be undone, newest first. Edits made afterwards to the rows an import added
 * or changed go with it.
 */
import type { Account, CsvMapping, Transaction } from '../types';
import { db } from '../db';

/** Kept in `meta`, newest first. Not part of backups (restoring one clears it). */
export const IMPORT_UNDO_KEY = 'importUndo';
const KEEP = 5;

interface TableDiff<T> {
  /** Keys of rows the import added. */
  added: string[];
  /** Rows the import changed or removed, as they were before. */
  before: T[];
}

export interface ImportRecord {
  id: string;
  at: number;
  /** "42 transactions into Chase Checking". */
  label: string;
  transactions: TableDiff<Transaction>;
  accounts: TableDiff<Account>;
  csvMappings: TableDiff<CsvMapping>;
}

/** What changed between two copies of a table. */
export function diffRows<T>(before: T[], after: T[], key: (row: T) => string): TableDiff<T> {
  const was = new Map(before.map((r) => [key(r), r]));
  const now = new Map(after.map((r) => [key(r), r]));
  const added = [...now.keys()].filter((k) => !was.has(k));
  const changed = before.filter((r) => {
    const n = now.get(key(r));
    return !n || JSON.stringify(n) !== JSON.stringify(r);
  });
  return { added, before: changed };
}

export interface Snapshot {
  transactions: Transaction[];
  accounts: Account[];
  csvMappings: CsvMapping[];
}

export async function takeSnapshot(): Promise<Snapshot> {
  return db.transaction('r', [db.transactions, db.accounts, db.csvMappings], async () => ({
    transactions: await db.transactions.toArray(),
    accounts: await db.accounts.toArray(),
    csvMappings: await db.csvMappings.toArray(),
  }));
}

/** Remembers what an import did (call with the copy taken just before it). */
export async function recordImport(before: Snapshot, label: string): Promise<void> {
  const after = await takeSnapshot();
  const record: ImportRecord = {
    id: crypto.randomUUID(),
    at: Date.now(),
    label,
    transactions: diffRows(before.transactions, after.transactions, (t) => t.id),
    accounts: diffRows(before.accounts, after.accounts, (a) => a.id),
    csvMappings: diffRows(before.csvMappings, after.csvMappings, (m) => m.signature),
  };
  const diffs = [record.transactions, record.accounts, record.csvMappings];
  if (diffs.every((d) => !d.added.length && !d.before.length)) return; // nothing to undo
  await db.transaction('rw', db.meta, async () => {
    const list = ((await db.meta.get(IMPORT_UNDO_KEY))?.value as ImportRecord[] | undefined) ?? [];
    await db.meta.put({ key: IMPORT_UNDO_KEY, value: [record, ...list].slice(0, KEEP) });
  });
}

/** Undoes the newest import; returns what it was, or undefined when there's nothing to undo. */
export async function undoLastImport(): Promise<ImportRecord | undefined> {
  return db.transaction('rw', [db.transactions, db.accounts, db.csvMappings, db.meta], async () => {
    const list = ((await db.meta.get(IMPORT_UNDO_KEY))?.value as ImportRecord[] | undefined) ?? [];
    const [last, ...rest] = list;
    if (!last) return undefined;
    await db.transactions.bulkDelete(last.transactions.added);
    await db.transactions.bulkPut(last.transactions.before);
    await db.accounts.bulkDelete(last.accounts.added);
    await db.accounts.bulkPut(last.accounts.before);
    await db.csvMappings.bulkDelete(last.csvMappings.added);
    await db.csvMappings.bulkPut(last.csvMappings.before);
    await db.meta.put({ key: IMPORT_UNDO_KEY, value: rest });
    return last;
  });
}
