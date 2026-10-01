import type { Transaction } from '../types';
import { tagKey } from './lines';

/** A transaction matches typed text in its payee, bank description, notes, tags or amount ("12.50"). */
export function matchesQuery(t: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    !!t.tags?.some((x) => tagKey(x).includes(q.replace(/^#/, ''))) ||
    t.payee.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.notes.toLowerCase().includes(q) ||
    (t.amount / 100).toFixed(2).includes(q.replace(/[$,-]/g, ''))
  );
}
