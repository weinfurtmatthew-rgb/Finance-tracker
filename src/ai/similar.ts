/**
 * Smarter categorizing: payees you've already categorized (plus a short description of each category)
 * are turned into embeddings by a small on-device model; a new payee gets the category of its most
 * similar neighbours.
 */
import type { Category, Transaction } from '../types';
import { UNCATEGORIZED } from '../lib/categories';

/** Descriptions that give every category a starting point before you've categorized much. */
export const CATEGORY_SEEDS: Record<string, string> = {
  income: 'payroll salary direct deposit paycheck employer',
  interest: 'interest dividend earned',
  groceries: 'grocery store supermarket food market',
  dining: 'restaurant cafe coffee shop bar bakery pizza fast food takeout',
  gas: 'gas station fuel petrol',
  transport: 'rideshare taxi parking toll public transit train bus car wash auto repair',
  shopping: 'retail store online shopping department store clothing electronics',
  bills: 'utility electric water internet cable phone bill',
  housing: 'rent mortgage property management apartments',
  subscriptions: 'streaming subscription software membership monthly plan',
  entertainment: 'movies cinema concerts tickets video games music events',
  health: 'pharmacy doctor dentist hospital clinic gym fitness',
  travel: 'airline flights hotel lodging vacation rental',
  personal: 'hair salon barber spa nails cosmetics',
  education: 'tuition school university books courses',
  gifts: 'charity donation gift',
  insurance: 'insurance premium auto home life',
  fees: 'bank fee interest charge late fee overdraft',
  transfer: 'transfer credit card payment account transfer',
  investments: 'brokerage investment buy sell shares',
};

export interface Example {
  text: string;
  categoryId: string;
  weight: number;
}

const norm = (t: Transaction) => (t.payee || t.description).trim().toLowerCase();

/** One example per payee you've categorized (its most common category), plus the category seeds. */
export function trainingExamples(txns: Transaction[], categories: Category[]): Example[] {
  const counts = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (t.categoryId === UNCATEGORIZED) continue;
    const key = norm(t);
    if (!key) continue;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    counts.set(key, m);
  }
  const out: Example[] = [];
  for (const [text, m] of counts) {
    const [categoryId, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({ text, categoryId, weight: 1 + Math.log2(n) });
  }
  const ids = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    if (c.id === UNCATEGORIZED || !ids.has(c.id)) continue;
    out.push({ text: `${c.name.toLowerCase()}: ${CATEGORY_SEEDS[c.id] ?? c.name.toLowerCase()}`, categoryId: c.id, weight: 0.8 });
  }
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface Suggestion {
  categoryId: string;
  /** 0–1: how similar the closest supporting example is. */
  similarity: number;
  /** Closest known payee, to show why ("like Whole Foods"). */
  like?: string;
}

/** Weighted vote of the k most similar examples (vectors must be normalized). */
export function nearestCategory(query: ArrayLike<number>, examples: (Example & { vec: ArrayLike<number> })[], k = 5): Suggestion | null {
  const scored = examples.map((e) => ({ e, sim: dot(query, e.vec) })).sort((a, b) => b.sim - a.sim).slice(0, k);
  if (!scored.length) return null;
  const votes = new Map<string, number>();
  for (const { e, sim } of scored) votes.set(e.categoryId, (votes.get(e.categoryId) ?? 0) + Math.max(0, sim) * e.weight);
  const [categoryId] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const best = scored.find((s) => s.e.categoryId === categoryId)!;
  const like = scored.find((s) => s.e.categoryId === categoryId && !s.e.text.includes(':'))?.e.text;
  return { categoryId, similarity: best.sim, like };
}

export const queryText = (t: Pick<Transaction, 'payee' | 'description'>) => `${t.payee} ${t.payee.toLowerCase() === t.description.toLowerCase() ? '' : t.description}`.trim().toLowerCase();
