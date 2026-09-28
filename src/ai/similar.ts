/**
 * Smarter categorizing: payees you've already categorized (plus a short description of each category)
 * are turned into embeddings by a small on-device model; a new payee gets the category of its most
 * similar neighbours.
 */
import type { Category, Transaction } from '../types';
import { UNCATEGORIZED } from '../lib/categories';

/** Short phrases that give every category a starting point before you've categorized much. */
export const CATEGORY_SEEDS: Record<string, string[]> = {
  income: ['payroll', 'salary direct deposit', 'paycheck from employer'],
  interest: ['interest earned', 'dividend'],
  groceries: ['grocery store', 'supermarket', 'food market'],
  dining: ['restaurant', 'coffee shop', 'cafe', 'bar and grill', 'pizza', 'fast food', 'bakery', 'food delivery'],
  gas: ['gas station', 'fuel', 'petrol'],
  transport: ['rideshare', 'taxi', 'parking', 'public transit', 'toll road', 'car repair'],
  shopping: ['department store', 'online shopping', 'clothing store', 'electronics store', 'retail'],
  bills: ['electric utility', 'water bill', 'internet provider', 'cell phone carrier', 'cable tv'],
  housing: ['rent', 'mortgage', 'property management'],
  subscriptions: ['streaming service', 'software subscription', 'monthly membership'],
  entertainment: ['movie theater', 'concert tickets', 'video games', 'live events'],
  health: ['pharmacy', 'doctor', 'dentist', 'hospital', 'gym'],
  travel: ['airline', 'hotel', 'flights', 'vacation rental'],
  personal: ['hair salon', 'barber', 'nail spa', 'cosmetics'],
  education: ['tuition', 'university', 'textbooks', 'online course'],
  gifts: ['charity donation', 'gift shop'],
  insurance: ['insurance premium', 'auto insurance'],
  fees: ['bank fee', 'interest charge', 'late fee'],
  transfer: ['transfer between accounts', 'credit card payment'],
  investments: ['brokerage', 'stock purchase'],
};

export interface Example {
  text: string;
  categoryId: string;
  weight: number;
  /** A built-in phrase rather than one of your payees. */
  seed?: boolean;
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
    for (const phrase of CATEGORY_SEEDS[c.id] ?? [c.name.toLowerCase()]) out.push({ text: phrase, categoryId: c.id, weight: 0.8, seed: true });
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

/**
 * The category whose closest example is most similar (vectors must be normalized). Your own payees get
 * a small edge over the built-in phrases.
 */
export function nearestCategory(query: ArrayLike<number>, examples: (Example & { vec: ArrayLike<number> })[]): Suggestion | null {
  let best: { e: Example; sim: number; score: number } | null = null;
  for (const e of examples) {
    const sim = dot(query, e.vec);
    const score = sim + (e.seed ? 0 : 0.03);
    if (!best || score > best.score) best = { e, sim, score };
  }
  if (!best) return null;
  return { categoryId: best.e.categoryId, similarity: best.sim, like: best.e.seed ? undefined : best.e.text };
}

export const queryText = (t: Pick<Transaction, 'payee' | 'description'>) => `${t.payee} ${t.payee.toLowerCase() === t.description.toLowerCase() ? '' : t.description}`.trim().toLowerCase();
