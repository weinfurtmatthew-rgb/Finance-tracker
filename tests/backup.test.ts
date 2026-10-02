import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../src/db';
import { backupDue, checkBackup, exportBackup, restoreBackup } from '../src/lib/backup';
import { decryptBackup, encryptBackup, encryptedExportedAt, isEncryptedBackup, WrongPasswordError } from '../src/lib/backupCrypto';

// Real backups use 600,000 rounds; a few keep the tests fast and work the same way.
const FAST = 1000;

async function sampleDb(name: string) {
  const db = new FinanceDB(name);
  await db.open();
  await db.accounts.add({ id: 'a1', name: 'Checking', type: 'checking', openingBalance: 0, archived: false, createdAt: 0 } as never);
  await db.transactions.bulkAdd([
    { id: 't1', accountId: 'a1', date: '2026-09-01', amount: -1250, description: 'STARBUCKS', payee: 'Starbucks', categoryId: 'coffee', notes: '', source: 'csv', createdAt: 0 },
    { id: 't2', accountId: 'a1', date: '2026-09-02', amount: 250000, description: 'PAYROLL', payee: 'Payroll', categoryId: 'income', notes: '', source: 'csv', createdAt: 0 },
  ] as never);
  await db.meta.put({ key: 'passcode', value: { hash: 'secret' } });
  return db;
}

describe('password-protected backups', () => {
  it('round-trips, and the file shows nothing readable', async () => {
    const db = await sampleDb('backup-crypto');
    const plain = await exportBackup(db);
    const { file, key } = await encryptBackup(plain, 'correct horse', FAST);
    expect(isEncryptedBackup(file)).toBe(true);
    expect(isEncryptedBackup(plain)).toBe(false);
    expect(file).not.toContain('Starbucks');
    expect(encryptedExportedAt(file)).toBe(JSON.parse(plain).exportedAt);
    expect(await decryptBackup(file, 'correct horse')).toBe(plain);
    expect(await decryptBackup(file, '', key)).toBe(plain);
  });

  it('refuses a wrong password or a changed file', async () => {
    const { file } = await encryptBackup('{"hello":1}', 'right', FAST);
    await expect(decryptBackup(file, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError);
    const env = JSON.parse(file);
    const bytes = atob(env.data);
    env.data = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    await expect(decryptBackup(JSON.stringify(env), 'right')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = JSON.parse((await encryptBackup('x', 'pw', FAST)).file);
    const b = JSON.parse((await encryptBackup('x', 'pw', FAST)).file);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });
});

describe('checkBackup', () => {
  it('reports what a backup holds and keeps the passcode out of it', async () => {
    const db = await sampleDb('backup-check');
    const text = await exportBackup(db);
    expect(text).not.toContain('secret');
    expect(checkBackup(text)).toMatchObject({ accounts: 1, transactions: 2, problems: [] });
  });

  it('finds problems a restore would bring back', async () => {
    const db = await sampleDb('backup-problems');
    const json = JSON.parse(await exportBackup(db));
    json.data.transactions.push({ ...json.data.transactions[0] }, { ...json.data.transactions[1], id: 't3', accountId: 'gone' });
    expect(checkBackup(JSON.stringify(json)).problems).toEqual([
      '1 transaction appears twice.',
      "1 transaction belongs to an account that isn't in the file.",
    ]);
  });

  it('rejects files that are not backups', () => {
    expect(() => checkBackup('{"format":"something-else"}')).toThrow('not a Finance Tracker backup');
    expect(() => checkBackup('not json')).toThrow();
  });

  it('a checked backup restores to the same data', async () => {
    const source = await sampleDb('backup-source');
    const text = await exportBackup(source);
    const target = new FinanceDB('backup-target');
    await target.open();
    await target.meta.put({ key: 'passcode', value: { hash: 'mine' } });
    await restoreBackup(target, text);
    expect(await target.transactions.count()).toBe(2);
    expect((await target.meta.get('passcode'))?.value).toEqual({ hash: 'mine' });
  });
});

describe('backupDue', () => {
  const day = 86_400_000;
  const now = 100 * day;
  it('reminds when it has been long enough, unless snoozed or turned off', () => {
    expect(backupDue({ hasData: true, everyDays: 14, now })).toBe(true);
    expect(backupDue({ hasData: false, everyDays: 14, now })).toBe(false);
    expect(backupDue({ hasData: true, lastBackupAt: now - 13 * day, everyDays: 14, now })).toBe(false);
    expect(backupDue({ hasData: true, lastBackupAt: now - 14 * day, everyDays: 14, now })).toBe(true);
    expect(backupDue({ hasData: true, lastBackupAt: now - 8 * day, everyDays: 7, now })).toBe(true);
    expect(backupDue({ hasData: true, everyDays: 0, now })).toBe(false);
    expect(backupDue({ hasData: true, everyDays: 14, snoozedUntil: now + day, now })).toBe(false);
    expect(backupDue({ hasData: true, everyDays: 14, snoozedUntil: now - 1, now })).toBe(true);
  });
});
