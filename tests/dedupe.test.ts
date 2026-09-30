import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCsv, detectFormat, csvToDrafts } from '../src/lib/csv';
import { parseOfx } from '../src/lib/ofx';
import { prepareImport, toTransactions } from '../src/lib/importer';
import { findAlreadyImported, findImportCopies, mergeCopy, openingAfterRemoval, sameStore } from '../src/lib/dedupe';
import type { Account, Transaction } from '../src/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
let n = 0;
const newId = () => `id${n++}`;
const acct: Account = { id: 'chk', name: 'Citizens Checking', type: 'checking', institution: 'Citizens', openingBalance: 0, archived: false, createdAt: 0 };

const csvDrafts = () => {
  const t = readCsv(fixture('citizens-sept.csv'));
  return csvToDrafts(t, detectFormat(t, 'checking').mapping).drafts;
};
const qfxDrafts = () => parseOfx(fixture('citizens-sept.qfx'))[0].transactions;
const ids = (txns: Transaction[]) => new Set(txns.flatMap((t) => (t.importId ? [t.importId] : [])));
/** Import like the app does: exact ids skipped, and rows already there in another format too. */
function importInto(existing: Transaction[], drafts: ReturnType<typeof csvDrafts>, source: 'csv' | 'ofx', at: number) {
  const items = prepareImport('chk', drafts, ids(existing), [], { existing }).map((p) => (p.likely ? { ...p, duplicate: true } : p));
  const rows = toTransactions(acct, items, source, newId).map((t) => ({ ...t, createdAt: at }));
  return { items, rows };
}

describe('importing the same month from a different file format', () => {
  it('recognizes a CSV month when the QFX statement comes in, and only adds what is new', () => {
    const first = importInto([], csvDrafts(), 'csv', 1).rows;
    expect(first).toHaveLength(8);
    const { items, rows } = importInto(first, qfxDrafts(), 'ofx', 2);
    // Everything but the Trader Joe's purchase is already there (dates a day off, other descriptions).
    expect(items.filter((p) => p.likely)).toHaveLength(8);
    expect(rows.map((r) => r.payee)).toEqual(["Trader Joe's"]);
    // Both $5.25 coffees on the same day are matched to the two that exist: nothing lost, nothing doubled.
    const coffees = items.filter((p) => p.draft.amount === -525);
    expect(new Set(coffees.map((p) => p.likely!.id)).size).toBe(2);
    // The two $86.20 Shaw's trips two weeks apart match their own dates.
    const shaws = items.filter((p) => p.draft.amount === -8620);
    expect(shaws.map((p) => p.likely!.date)).toEqual(['2026-09-02', '2026-09-15']);
  });

  it('works the other way round too (QFX first, then CSV)', () => {
    const first = importInto([], qfxDrafts(), 'ofx', 1).rows;
    const { rows } = importInto(first, csvDrafts(), 'csv', 2);
    expect(rows).toEqual([]);
  });

  it('never matches a different store, a different amount or a week apart', () => {
    const existing = importInto([], csvDrafts(), 'csv', 1).rows;
    const m = findAlreadyImported(
      [
        { date: '2026-09-02', amount: -8620, description: 'STAR MARKET 12', importId: 'x1' },
        { date: '2026-09-02', amount: -8621, description: 'SHAWS #4521', importId: 'x2' },
        { date: '2026-09-09', amount: -525, description: 'BLUE BOTTLE COFFEE', importId: 'x3' },
      ],
      existing,
    );
    expect(m.size).toBe(0);
  });

  it('treats the same purchase right after the last imported day as new (a daily coffee)', () => {
    const existing = importInto([], csvDrafts(), 'csv', 1).rows;
    const m = findAlreadyImported(
      [
        { date: '2026-09-16', amount: -8620, description: 'SHAWS #4521', importId: 'x1' },
        { date: '2026-09-17', amount: -8620, description: 'SHAWS #4521', importId: 'x2' },
      ],
      existing,
    );
    expect(m.size).toBe(0);
  });

  it('compares store names, ignoring card jargon and numbers', () => {
    expect(sameStore('DBT CRD 0923 SHAWS #4521 BOSTON MA', 'SHAWS #4521  DBT CRD 0923')).toBe(true);
    expect(sameStore('DBT CRD 0923 SHAWS #4521', 'DBT CRD 0923 STAR MARKET')).toBe(false);
  });
});

describe('cleaning up copies already imported', () => {
  const both = () => {
    const csv = importInto([], csvDrafts(), 'csv', 1).rows;
    // What happened before the fix: every QFX row added as new.
    const qfx = toTransactions(acct, prepareImport('chk', qfxDrafts(), new Set(), []), 'ofx', newId).map((t) => ({ ...t, createdAt: 2 }));
    return { csv, qfx };
  };

  it('finds each copy once and keeps the first import', () => {
    const { csv, qfx } = both();
    const copies = findImportCopies([...csv, ...qfx]);
    expect(copies).toHaveLength(8);
    expect(copies.every((c) => c.keep.createdAt === 1 && c.copy.createdAt === 2)).toBe(true);
    expect(new Set(copies.map((c) => c.keep.id)).size).toBe(8);
  });

  it('does not flag a daily habit across two monthly imports', () => {
    const csv = importInto([], csvDrafts(), 'csv', 1).rows;
    const next = toTransactions(
      acct,
      prepareImport('chk', [
        { date: '2026-09-16', amount: -8620, description: 'DBT CRD 0916 SHAWS #4521 BOSTON MA' },
        { date: '2026-09-17', amount: -8620, description: 'DBT CRD 0917 SHAWS #4521 BOSTON MA' },
      ], new Set(), []),
      'csv',
      newId,
    ).map((t) => ({ ...t, createdAt: 2 }));
    expect(findImportCopies([...csv, ...next])).toEqual([]);
  });

  it('leaves a genuinely new month alone', () => {
    const csv = importInto([], csvDrafts(), 'csv', 1).rows;
    const october = toTransactions(
      acct,
      prepareImport('chk', csvDrafts().map((d) => ({ ...d, date: d.date.replace('-09-', '-10-') })), new Set(), []),
      'csv',
      newId,
    ).map((t) => ({ ...t, createdAt: 2 }));
    expect(findImportCopies([...csv, ...october])).toEqual([]);
  });

  it('keeps your changes from either copy and remembers the other format', () => {
    const { csv, qfx } = both();
    const [pair] = findImportCopies([...csv, ...qfx]).filter((c) => c.keep.amount === -8620);
    const copy = { ...pair.copy, categoryId: 'gifts', categorySource: 'user' as const, notes: 'party', tags: ['Bday'] };
    const changes = mergeCopy(pair.keep, copy);
    expect(changes).toMatchObject({ categoryId: 'gifts', notes: 'party', tags: ['Bday'] });
    expect(changes.altImportIds).toEqual([pair.copy.importId]);
    // And the next import of that QFX recognizes it by id.
    const kept = [...csv].map((t) => (t.id === pair.keep.id ? { ...t, ...changes } : t));
    expect(prepareImport('chk', qfxDrafts(), new Set(kept.flatMap((t) => [t.importId!, ...(t.altImportIds ?? [])])), []).filter((p) => p.duplicate)).toHaveLength(1);
  });

  it('keeps a balance the bank confirmed after the copies came in', () => {
    const { qfx } = both();
    const removed = qfx.slice(0, 3);
    const sum = removed.reduce((s, t) => s + t.amount, 0);
    expect(openingAfterRemoval({ ...acct, openingBalance: 1000, balanceSetAt: 5 }, removed)).toBe(1000 + sum);
    expect(openingAfterRemoval({ ...acct, openingBalance: 1000, balanceSetAt: 1 }, removed)).toBeUndefined();
    // Older accounts without the timestamp: a check dated after the copies counts.
    expect(openingAfterRemoval({ ...acct, openingBalance: 1000, checkedOn: '2026-09-28' }, removed)).toBe(1000 + sum);
    expect(openingAfterRemoval({ ...acct, openingBalance: 1000 }, removed)).toBeUndefined();
  });
});
