import type { FinanceDB } from '../db';

export const BACKUP_FORMAT = 'finance-tracker-backup';
export const BACKUP_VERSION = 1;

/** Settings that stay on this device and are never written to a backup file. */
const LOCAL_ONLY_META = new Set(['passcode']);

export async function exportBackup(db: FinanceDB): Promise<string> {
  const [accounts, transactions, categories, rules, csvMappings, meta] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.categories.toArray(),
    db.rules.toArray(),
    db.csvMappings.toArray(),
    db.meta.toArray(),
  ]);
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { accounts, transactions, categories, rules, csvMappings, meta: meta.filter((m) => !LOCAL_ONLY_META.has(m.key)) },
  });
}

export interface BackupSummary {
  accounts: number;
  transactions: number;
  exportedAt: string;
}

function validate(json: any) {
  if (json?.format !== BACKUP_FORMAT) throw new Error('This file is not a Finance Tracker backup.');
  if (json.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  const d = json.data;
  for (const k of ['accounts', 'transactions', 'categories', 'rules', 'csvMappings', 'meta']) {
    if (!Array.isArray(d?.[k])) throw new Error(`Backup is missing "${k}".`);
  }
  return json;
}

export function summarizeBackup(text: string): BackupSummary {
  const json = validate(JSON.parse(text));
  return { accounts: json.data.accounts.length, transactions: json.data.transactions.length, exportedAt: json.exportedAt };
}

/** Replace everything on this device with the backup's contents (the passcode is kept). */
export async function restoreBackup(db: FinanceDB, text: string): Promise<void> {
  const { data } = validate(JSON.parse(text));
  await db.transaction('rw', [db.accounts, db.transactions, db.categories, db.rules, db.csvMappings, db.meta], async () => {
    await Promise.all([db.accounts.clear(), db.transactions.clear(), db.categories.clear(), db.rules.clear(), db.csvMappings.clear()]);
    const meta = await db.meta.toArray();
    await db.meta.bulkDelete(meta.filter((m) => !LOCAL_ONLY_META.has(m.key)).map((m) => m.key));
    await db.accounts.bulkAdd(data.accounts);
    await db.transactions.bulkAdd(data.transactions);
    await db.categories.bulkAdd(data.categories);
    await db.rules.bulkAdd(data.rules);
    await db.csvMappings.bulkAdd(data.csvMappings);
    await db.meta.bulkPut(data.meta.filter((m: { key: string }) => !LOCAL_ONLY_META.has(m.key)));
  });
}
