/**
 * Split transactions and money owed to you.
 *
 * Balances always use the whole transaction. Everything that adds up spending by category (budgets,
 * charts, Ask, the recap) uses `lines()`: a split transaction becomes one line per part, and a part
 * paid for someone else lands in "Owed to Me", which isn't spending or income.
 */
import type { Cents, ISODate, Split, Transaction } from '../types';
import { pushTo } from './collections';
import { OWED } from './categories';

/** One category's share of a transaction (the whole transaction when it isn't split). */
export type Line = Transaction & { splitId?: string };

export function lines(txns: Transaction[]): Line[] {
  const out: Line[] = [];
  for (const t of txns) {
    if (!t.splits?.length) out.push(t);
    else for (const s of t.splits) out.push({ ...t, amount: s.amount, categoryId: s.owedBy ? OWED : s.categoryId, splitId: s.id, splits: undefined });
  }
  return out;
}

/** Category ids a transaction touches (all of its parts). */
export const categoriesOf = (t: Transaction): string[] => (t.splits?.length ? t.splits.map((s) => (s.owedBy ? OWED : s.categoryId)) : [t.categoryId]);

/** The parts must add up to the transaction exactly, with at least two parts. */
export function splitProblem(total: Cents, splits: Pick<Split, 'amount' | 'categoryId'>[]): string | null {
  if (splits.length < 2) return 'Add at least two parts.';
  const sum = splits.reduce((s, x) => s + x.amount, 0);
  if (sum !== total) return `Parts add up to ${(Math.abs(sum) / 100).toFixed(2)}, not ${(Math.abs(total) / 100).toFixed(2)}.`;
  if (splits.some((s) => !s.amount)) return 'Every part needs an amount.';
  return null;
}

export interface OwedItem {
  txn: Transaction;
  splitId?: string;
  /** Positive: what they owe you. */
  amount: Cents;
  who: string;
  date: ISODate;
  settledBy?: string;
}

/** Everything you paid for someone else, newest first. */
export function owedItems(txns: Transaction[]): OwedItem[] {
  const out: OwedItem[] = [];
  for (const t of txns) {
    if (t.splits?.length) {
      for (const s of t.splits)
        if (s.owedBy) out.push({ txn: t, splitId: s.id, amount: -s.amount, who: s.owedBy, date: t.date, settledBy: s.settledBy });
    } else if (t.owedBy && t.amount < 0) {
      out.push({ txn: t, amount: -t.amount, who: t.owedBy, date: t.date, settledBy: t.settledBy });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Still-unpaid totals per person, largest first. */
export function owedByPerson(items: OwedItem[]): { who: string; total: Cents; items: OwedItem[] }[] {
  const m = new Map<string, OwedItem[]>();
  for (const i of items) if (!i.settledBy) pushTo(m, i.who, i);
  return [...m].map(([who, list]) => ({ who, total: list.reduce((s, i) => s + i.amount, 0), items: list })).sort((a, b) => b.total - a.total);
}

/**
 * Money coming in that could be someone paying you back: recent incoming transactions (not
 * already a repayment), closest in amount first.
 */
export function repaymentCandidates(txns: Transaction[], amount: Cents, since: ISODate): Transaction[] {
  const used = new Set(owedItems(txns).map((i) => i.settledBy));
  return txns
    .filter((t) => t.amount > 0 && t.date >= since && !used.has(t.id) && !t.splits?.length)
    .sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount) || (a.date < b.date ? 1 : -1))
    .slice(0, 12);
}

/** Tags are matched ignoring case and extra spaces; the first spelling you used is kept. */
export const tagKey = (tag: string) => tag.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase();

export function cleanTag(tag: string, known: string[]): string | null {
  const key = tagKey(tag);
  if (!key) return null;
  return known.find((k) => tagKey(k) === key) ?? tag.trim().replace(/^#/, '').replace(/\s+/g, ' ');
}

export function allTags(txns: Transaction[]): { tag: string; count: number; total: Cents; first: ISODate; last: ISODate }[] {
  const m = new Map<string, { tag: string; count: number; total: Cents; first: ISODate; last: ISODate }>();
  for (const t of txns)
    for (const tag of t.tags ?? []) {
      const k = tagKey(tag);
      const e = m.get(k) ?? { tag, count: 0, total: 0, first: t.date, last: t.date };
      e.count++;
      e.total += t.amount;
      if (t.date < e.first) e.first = t.date;
      if (t.date > e.last) e.last = t.date;
      m.set(k, e);
    }
  return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}
