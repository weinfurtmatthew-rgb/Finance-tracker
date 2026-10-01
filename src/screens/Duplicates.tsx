import { useMemo, useState } from 'preact/hooks';
import { db } from '../db';
import { useAccounts, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Transaction } from '../types';
import { findImportCopies, mergeCopy, openingAfterRemoval, type DuplicateCopy } from '../lib/dedupe';
import { formatDay } from '../lib/dates';
import { Empty, Money, Section, Sheet } from '../components/ui';

/** Copies from importing the same period twice in different file formats (CSV then QFX, …). */
export function useImportCopies(): DuplicateCopy[] {
  const txns = useTransactions();
  return useMemo(() => findImportCopies(txns), [txns]);
}

/** Remove the copies, keeping the first import of each (with anything you changed on either). */
export async function removeCopies(pairs: DuplicateCopy[]): Promise<number> {
  const copyIds = new Set(pairs.map((p) => p.copy.id));
  await db.transaction('rw', db.transactions, db.accounts, async () => {
    for (const { keep, copy } of pairs) await db.transactions.update(keep.id, mergeCopy(keep, copy));
    // "Paid back by" links that point at a copy move to the kept transaction.
    const keepFor = new Map(pairs.map((p) => [p.copy.id, p.keep.id]));
    await db.transactions
      .filter((t: Transaction) => (!!t.settledBy && keepFor.has(t.settledBy)) || !!t.splits?.some((s) => s.settledBy && keepFor.has(s.settledBy)))
      .modify((t: Transaction) => {
        if (t.settledBy && keepFor.has(t.settledBy)) t.settledBy = keepFor.get(t.settledBy);
        for (const s of t.splits ?? []) if (s.settledBy && keepFor.has(s.settledBy)) s.settledBy = keepFor.get(s.settledBy);
      });
    const removed = pairs.map((p) => p.copy);
    for (const account of await db.accounts.toArray()) {
      const opening = openingAfterRemoval(account, removed);
      if (opening != null) await db.accounts.update(account.id, { openingBalance: opening });
    }
    await db.transactions.bulkDelete([...copyIds]);
  });
  return copyIds.size;
}

export function DuplicatesSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const pairs = useImportCopies();
  const accounts = useAccounts();
  const [busy, setBusy] = useState(false);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Account';
  const byAccount = useMemo(() => {
    const m = new Map<string, DuplicateCopy[]>();
    for (const p of pairs) m.set(p.copy.accountId, [...(m.get(p.copy.accountId) ?? []), p]);
    return [...m];
  }, [pairs]);

  return (
    <Sheet title="Duplicate Imports" onClose={props.onClose}>
      {!pairs.length ? (
        <Empty icon="check" title="No duplicates">
          <p>Nothing was imported twice. Importing the same month again, in any file format, is safe: matches are skipped.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            These came in twice because the same period was imported from two kinds of file (like a CSV and a QFX statement), which list the same purchases differently. Removing
            the copies keeps the first import of each, along with any category, notes or tags you set on either.
          </p>
          <Section>
            <button
              type="button"
              class="row link-row"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const n = await removeCopies(pairs);
                nav.toast(`Removed ${n} duplicate${n === 1 ? '' : 's'}`);
                props.onClose();
              }}
            >
              {busy ? 'Removing…' : `Remove ${pairs.length} Duplicate${pairs.length === 1 ? '' : 's'}`}
            </button>
          </Section>
          {byAccount.map(([accountId, list]) => (
            <Section title={`${name(accountId)} · ${list.length}`}>
              {list.slice(0, 100).map(({ keep, copy }) => (
                <div class="row dup-row">
                  <span class="row-main">
                    <span class="row-title">{keep.payee}</span>
                    <span class="row-subtitle">
                      {formatDay(keep.date)}
                      {copy.date !== keep.date ? ` and ${formatDay(copy.date)}` : ''} · also as “{copy.description.slice(0, 40)}”
                    </span>
                  </span>
                  <span class="row-detail">
                    <Money cents={keep.amount} colored />
                  </span>
                </div>
              ))}
              {list.length > 100 && <div class="row muted">…and {list.length - 100} more</div>}
            </Section>
          ))}
        </>
      )}
    </Sheet>
  );
}
