import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvToDrafts, detectFormat, readCsv } from '../src/lib/csv';
import { parseOfx } from '../src/lib/ofx';
import { prepareImport, toTransactions } from '../src/lib/importer';
import { accountFor, accountTypeFor, findEarlierImport, planRepair, rocketGroups } from '../src/lib/rocketmoney';
import type { Account, Transaction } from '../src/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
let n = 0;
const newId = () => `id${n++}`;
const acct = (id: string, name: string, type: Account['type'], extra: Partial<Account> = {}): Account => ({ id, name, type, institution: '', openingBalance: 0, archived: false, createdAt: 0, ...extra });

const read = () => {
  const table = readCsv(fixture('rocketmoney.csv'));
  const det = detectFormat(table);
  return { det, drafts: csvToDrafts(table, det.mapping).drafts };
};

describe('Rocket Money exports', () => {
  it('is recognized, flips its signs to the bank convention, and keeps its names and categories', () => {
    const { det, drafts } = read();
    expect(det.format).toBe('Rocket Money');
    expect(det.mapping.invert).toBe(true);
    const shaws = drafts[1];
    expect(shaws).toMatchObject({ date: '2026-09-02', amount: -8620, payeeHint: "Shaw's", bankCategory: 'Groceries', sourceAccount: { name: 'Citizens Checking', last4: '6789', institution: 'Citizens' } });
    expect(drafts[0].amount).toBe(240000);
  });

  it('groups rows by account and matches them to app accounts', () => {
    const groups = rocketGroups(read().drafts);
    expect(groups.map((g) => [g.account.label, g.drafts.length, accountTypeFor(g.account)])).toEqual([
      ['Citizens · Citizens Checking ••6789', 8, 'checking'],
      ['Discover · Discover it ••1234', 3, 'credit'],
    ]);
    const accounts = [acct('chk', 'Checking', 'checking', { last4: '6789' }), acct('disc', 'Discover it', 'credit')];
    expect(accountFor(groups[0].account, accounts)?.id).toBe('chk');
    expect(accountFor(groups[1].account, accounts)?.id).toBe('disc');
  });

  it('categorizes with Rocket Money categories and its store names', () => {
    const citizens = rocketGroups(read().drafts)[0].drafts;
    const items = prepareImport('chk', citizens, new Set(), []);
    const by = (payee: string) => items.find((p) => p.payee === payee)!;
    expect(by("Shaw's").categoryId).toBe('groceries');
    expect(by('Acme Corp').categoryId).toBe('income');
    expect(by('Transfer to Savings').categoryId).toBe('transfer');
    expect(by('Eversource').categoryId).toBe('bills');
  });

  it('then matches the same month from the Citizens QFX', () => {
    const citizens = rocketGroups(read().drafts)[0].drafts;
    const rows = toTransactions({ id: 'chk' }, prepareImport('chk', citizens, new Set(), []), 'csv', newId);
    const qfx = prepareImport('chk', parseOfx(fixture('citizens-sept.qfx'))[0].transactions, new Set(), [], { existing: rows });
    expect(qfx.filter((p) => !p.likely).map((p) => p.payee)).toEqual(["Trader Joe's"]);
  });
});

describe('repairing an earlier plain-CSV import of a Rocket Money file', () => {
  /** What happened before: the whole file into Citizens Checking, signs as in the file (spending positive). */
  function earlierState() {
    const { drafts } = read();
    const raw = drafts.map((d) => ({ ...d, amount: -d.amount, payeeHint: undefined, sourceAccount: undefined }));
    const old = toTransactions({ id: 'chk' }, prepareImport('chk', raw, new Set(), []), 'csv', newId).map((t) => ({ ...t, createdAt: 1 }));
    // Then the Citizens QFX, which matched nothing and set the balance to the bank's.
    const qfx = toTransactions({ id: 'chk' }, prepareImport('chk', parseOfx(fixture('citizens-sept.qfx'))[0].transactions, new Set(), []), 'ofx', newId).map((t) => ({ ...t, createdAt: 2 }));
    return { drafts, old, qfx };
  }

  it('finds the earlier rows, fixes signs and accounts, and merges the Citizens ones into the QFX lines', () => {
    const { drafts, old, qfx } = earlierState();
    const accounts = [acct('chk', 'Citizens Checking', 'checking', { openingBalance: 5000, balanceSetAt: 2 }), acct('disc', 'Discover it', 'credit')];
    // You had categorized one of the old rows yourself.
    const eversource = old.find((t) => t.description.startsWith('EVERSOURCE'))!;
    const txns: Transaction[] = [...old.map((t) => (t.id === eversource.id ? { ...t, categoryId: 'gifts', categorySource: 'user' as const } : t)), ...qfx];
    const earlier = findEarlierImport(drafts, accounts, txns);
    expect(earlier).toHaveLength(11);
    expect(earlier.every((e) => e.flipped)).toBe(true);

    const target = new Map(rocketGroups(drafts).map((g) => [g.account.key, g.account.last4 === '1234' ? 'disc' : 'chk']));
    const plan = planRepair({ drafts, earlier, target, accounts, txns, rules: [] });
    // Citizens rows were already in the QFX: merged into those lines. Discover's 3 move to Discover.
    expect(plan.merged).toBe(8);
    expect(plan.moved).toBe(3);
    expect(plan.update.every((u) => u.changes.accountId === 'disc')).toBe(true);
    expect(plan.update.map((u) => u.changes.amount).sort()).toEqual([-4310, -1435, 30000].sort());
    // Your category on the old Eversource row carries over to the QFX's Eversource line.
    const qfxEversource = qfx.find((t) => t.description.startsWith('EVERSOURCE'))!;
    expect(plan.merge.find((m) => m.id === qfxEversource.id)!.changes).toMatchObject({ categoryId: 'gifts', categorySource: 'user' });
    // Citizens' confirmed balance counted the wrong rows; the starting balance absorbs their removal.
    const oldChk = old.reduce((s, t) => s + t.amount, 0);
    expect(plan.openings).toEqual([{ accountId: 'chk', openingBalance: 5000 + oldChk }]);
  });

  it('finds nothing to repair after a proper Rocket Money import', () => {
    const { drafts } = read();
    const groups = rocketGroups(drafts);
    const rows = groups.flatMap((g, k) => toTransactions({ id: k ? 'disc' : 'chk' }, prepareImport(k ? 'disc' : 'chk', g.drafts, new Set(), []), 'csv', newId));
    const earlier = findEarlierImport(drafts, [acct('chk', 'C', 'checking'), acct('disc', 'D', 'credit')], rows);
    const target = new Map(groups.map((g, k) => [g.account.key, k ? 'disc' : 'chk']));
    expect(planRepair({ drafts, earlier, target, accounts: [acct('chk', 'C', 'checking'), acct('disc', 'D', 'credit')], txns: rows, rules: [] }).fixed).toBe(0);
  });
});
