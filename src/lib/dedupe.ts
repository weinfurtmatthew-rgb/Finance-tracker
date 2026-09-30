/**
 * Recognizing transactions you already have, even when a file describes them differently.
 *
 * Every imported row gets an id from its file (the bank's OFX id, or a hash of a CSV row). Those ids
 * only match when the same kind of file is imported again: a Citizens CSV and a Citizens QFX (or an
 * "activity" download and a monthly "statement") give the same purchases different ids, different
 * descriptions and sometimes a different date. So after the exact id check, rows are matched one to
 * one by amount, date (a few days apart at most) and store name.
 */
import type { Account, Cents, ISODate, Transaction } from '../types';
import { addDays, diffDays } from './dates';
import { cleanPayee } from './payee';

/** Words that say nothing about the store: card jargon, transfer codes and filler. */
const NOISE = new Set(
  'pos dbt debit card purchase purchases recurring checkcard check visa mastercard authorized ach web ppd ccd tel www com inc llc the and for from with pmt payment payments online mobile withdrawal deposit transaction trans ref id'.split(
    ' ',
  ),
);

/** Words that name a kind of transaction, not a store. */
const GENERIC = new Set(['check', 'transfer', 'online', 'withdrawal', 'deposit', 'atm', 'fee', 'interest', 'dividend', 'zelle']);

/** The distinctive words in a description: "DBT CRD 0923 SHAWS #4521 BOSTON MA" → shaws, boston. */
export function keyWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 3 && !NOISE.has(w)),
  );
}

/** Two descriptions of the same store: a shared distinctive word, or the same cleaned-up name. */
export function sameStore(a: string, b: string): boolean {
  const pa = cleanPayee(a).toLowerCase();
  const pb = cleanPayee(b).toLowerCase();
  if (pa && pa === pb && keyWords(pa).size) return true;
  const wa = keyWords(a);
  for (const w of keyWords(b)) if (w.length >= 4 && wa.has(w)) return true;
  return false;
}

/** Every import id a transaction answers to (its own, plus ids from other file formats it matched). */
export const idsOf = (t: Pick<Transaction, 'importId' | 'altImportIds'>): string[] => [...(t.importId ? [t.importId] : []), ...(t.altImportIds ?? [])];

export interface Incoming {
  date: ISODate;
  amount: Cents;
  description: string;
  importId: string;
}

/** Days apart allowed between two listings of one purchase (a statement may use the posting date). */
const WINDOW = 3;

/**
 * Which incoming rows are already in the app under another id. `existing` is the account's
 * transactions. Returns incoming index → the transaction it is.
 *
 * One to one: each existing transaction explains at most one incoming row, and ones the file already
 * contains by exact id are used up first, so two real $5 coffees are never mistaken for one.
 */
export function findAlreadyImported(incoming: Incoming[], existing: Transaction[]): Map<number, Transaction> {
  const out = new Map<number, Transaction>();
  if (!incoming.length || !existing.length) return out;
  const incomingIds = new Set(incoming.map((i) => i.importId));
  // Only rows inside the dates the account's files already cover can be repeats; anything after them
  // (or before) is new, even the same coffee a day later.
  const imported = existing.filter((t) => t.source !== 'manual');
  if (!imported.length) return out;
  const covered = imported.map((t) => t.date).sort();
  const first = covered[0];
  const last = covered[covered.length - 1];
  const dates = incoming.map((i) => i.date).sort();
  const from = addDays(dates[0], -WINDOW);
  const to = addDays(dates[dates.length - 1], WINDOW);
  // A file that overlaps what's there may list its edge days a day or two later (posting dates):
  // allow the window. A file that starts after it (next month's) gets no slack.
  const overlaps = dates[0] <= last && dates[dates.length - 1] >= first;
  const lo = overlaps ? addDays(first, -WINDOW) : first;
  const hi = overlaps ? addDays(last, WINDOW) : last;
  // Transactions the file already has by exact id are accounted for; the rest could be the same
  // purchases in a different format.
  const pool = imported.filter((t) => t.date >= from && t.date <= to && !t.p2p?.role && !idsOf(t).some((id) => incomingIds.has(id)));
  if (!pool.length) return out;
  const known = new Set(existing.flatMap(idsOf));
  const used = new Set<string>();
  const order = incoming.map((_, i) => i).sort((a, b) => (incoming[a].date < incoming[b].date ? -1 : 1));
  for (const i of order) {
    const row = incoming[i];
    if (known.has(row.importId) || row.date < lo || row.date > hi) continue;
    const candidates = pool.filter((t) => !used.has(t.id) && t.amount === row.amount && Math.abs(diffDays(t.date, row.date)) <= WINDOW);
    if (!candidates.length) continue;
    const scored = candidates
      .map((t) => ({ t, store: sameStore(row.description, `${t.description} ${t.payee}`), days: Math.abs(diffDays(t.date, row.date)) }))
      .sort((a, b) => Number(b.store) - Number(a.store) || a.days - b.days);
    const best = scored[0];
    // Without a matching store name, only accept an exact same-day, one-of-a-kind amount.
    // (and only when a description has no store name at all, like "CHECK 1043" or "TRANSFER").
    const vague = (text: string) => ![...keyWords(text)].some((w) => w.length >= 4 && !GENERIC.has(w));
    const sameDayOnly = !best.store && best.days === 0 && (vague(row.description) || vague(best.t.description)) && scored.filter((s) => s.days === 0).length === 1 && incoming.filter((r) => r.amount === row.amount && r.date === row.date).length === 1;
    if (!best.store && !sameDayOnly) continue;
    used.add(best.t.id);
    out.set(i, best.t);
  }
  return out;
}

export interface DuplicateCopy {
  /** The one to keep: imported first (it has your edits). */
  keep: Transaction;
  /** The copy from a later import in a different format. */
  copy: Transaction;
}

/**
 * Copies already in the app from importing the same period twice in different formats. Each import
 * is one batch (its rows share a creation time); a later batch whose rows mostly match earlier ones is
 * a re-import, and its matching rows are copies.
 */
export function findImportCopies(txns: Transaction[]): DuplicateCopy[] {
  const out: DuplicateCopy[] = [];
  const byAccount = new Map<string, Transaction[]>();
  for (const t of txns) if (t.source !== 'manual' && t.importId && !t.p2p?.role) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  for (const list of byAccount.values()) {
    // One import = rows saved together from one kind of file.
    const batches = new Map<string, Transaction[]>();
    for (const t of list) {
      const key = `${t.createdAt}|${t.importId!.includes(':ofx:') ? 'ofx' : 'csv'}`;
      batches.set(key, [...(batches.get(key) ?? []), t]);
    }
    const ordered = [...batches.values()].sort((a, b) => a[0].createdAt - b[0].createdAt);
    const removed = new Set<string>();
    for (let k = 1; k < ordered.length; k++) {
      const earlier = ordered.slice(0, k).flat().filter((t) => !removed.has(t.id));
      if (!earlier.length) continue;
      const batch = ordered[k];
      const matches = findAlreadyImported(
        batch.map((t) => ({ date: t.date, amount: t.amount, description: t.description, importId: t.importId! })),
        earlier,
      );
      // Only a batch that mostly repeats what was there is a re-import (not new purchases that happen
      // to look alike).
      const start = earlier.reduce((m, t) => (t.date < m ? t.date : m), earlier[0].date);
      const end = earlier.reduce((m, t) => (t.date > m ? t.date : m), earlier[0].date);
      const overlapping = batch.filter((t) => t.date >= start && t.date <= end).length;
      if (matches.size < 2 || matches.size < overlapping * 0.5) continue;
      for (const [i, keep] of matches) {
        out.push({ keep, copy: batch[i] });
        removed.add(batch[i].id);
      }
    }
  }
  return out.sort((a, b) => (a.copy.date < b.copy.date ? 1 : -1));
}

/**
 * What the kept transaction takes over from its copy: your category, notes, tags, splits or "owed"
 * when only the copy has them, and the copy's import id (so that file format is recognized next time).
 */
export function mergeCopy(keep: Transaction, copy: Transaction): Partial<Transaction> {
  const changes: Partial<Transaction> = { altImportIds: [...new Set([...(keep.altImportIds ?? []), ...idsOf(copy)])].filter((id) => id !== keep.importId) };
  const keepChosen = keep.categorySource === 'user' || keep.categorySource === 'rule';
  const copyChosen = copy.categorySource === 'user' || copy.categorySource === 'rule';
  if (copyChosen && !keepChosen) {
    changes.categoryId = copy.categoryId;
    changes.categorySource = copy.categorySource;
  }
  if (!keep.notes && copy.notes) changes.notes = copy.notes;
  if (copy.tags?.length) changes.tags = [...new Set([...(keep.tags ?? []), ...copy.tags])];
  if (!keep.splits?.length && copy.splits?.length) changes.splits = copy.splits;
  if (!keep.owedBy && copy.owedBy) {
    changes.owedBy = copy.owedBy;
    if (copy.settledBy) changes.settledBy = copy.settledBy;
  }
  return changes;
}

/**
 * Removing copies changes an account's balance. If the balance was confirmed against the bank after
 * the copies came in (e.g. set from the QFX file that brought them), that confirmation counted them, so
 * the starting balance is corrected to keep the confirmed balance right.
 */
export function openingAfterRemoval(account: Account, removed: Transaction[]): Cents | undefined {
  const mine = removed.filter((t) => t.accountId === account.id);
  if (!mine.length) return undefined;
  const confirmedAfter =
    account.balanceSetAt != null
      ? account.balanceSetAt >= Math.max(...mine.map((t) => t.createdAt))
      : !!account.checkedOn && account.checkedOn >= mine.reduce((m, t) => (t.date > m ? t.date : m), mine[0].date);
  if (!confirmedAfter) return undefined;
  return account.openingBalance + mine.reduce((s, t) => s + t.amount, 0);
}
