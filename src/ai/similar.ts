/**
 * Smarter categorizing: payees you've already categorized (plus a short description of each category)
 * are turned into embeddings by a small on-device model; a new payee gets the category its most similar
 * neighbours vote for.
 *
 * Three things keep it from being confidently wrong:
 * - Direction: money coming in can only become income or a transfer, and money going out can never
 *   become income. (Refunds are handled before the AI: they follow the payee's usual category.)
 * - Trust: categories you chose yourself count most; keyword and bank guesses count less, and AI picks
 *   you haven't reviewed never count, so a mistake can't teach itself.
 * - A vote among the closest matches rather than a single nearest one, and "Likely" only when one
 *   category clearly wins.
 */
import type { Category, CategoryGroup, CategorySource, Transaction } from '../types';
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
  gifts: ['gift shop', 'florist'],
  insurance: ['insurance premium', 'auto insurance'],
  fees: ['bank fee', 'interest charge', 'late fee'],
  'card-payment': ['credit card payment', 'card autopay payment'],
  transfer: ['transfer between accounts', 'transfer to savings'],
  investments: ['brokerage', 'stock purchase'],
  coffee: ['coffee shop', 'espresso bar', 'coffee roasters'],
  alcohol: ['liquor store', 'brewery', 'wine shop', 'pub'],
  clothing: ['clothing store', 'apparel', 'shoes'],
  electronics: ['electronics store', 'computer store', 'phone store'],
  home: ['hardware store', 'home improvement', 'furniture store', 'garden center'],
  pets: ['pet store', 'veterinarian', 'pet supplies'],
  kids: ['daycare', 'toy store', 'baby store'],
  'car-payment': ['auto loan payment', 'car financing'],
  'car-maintenance': ['auto repair', 'oil change', 'tire shop', 'auto parts'],
  fitness: ['gym membership', 'fitness studio', 'yoga studio'],
  taxes: ['tax payment', 'irs', 'department of revenue'],
  charity: ['charity donation', 'nonprofit'],
  owed: ['reimbursement', 'paid back'],
};

/** How much a category choice teaches the AI, by where it came from. Unreviewed AI picks teach nothing. */
export const TRUST: Record<CategorySource | 'legacy', number> = {
  user: 3,
  rule: 2,
  history: 1.5,
  legacy: 1,
  keyword: 0.7,
  bank: 0.5,
  default: 0.3,
  ai: 0,
};
const SEED_WEIGHT = 0.6;

export type Direction = 'in' | 'out';
export const directionOf = (t: Pick<Transaction, 'amount'>): Direction => (t.amount > 0 ? 'in' : 'out');

export interface Example {
  text: string;
  categoryId: string;
  weight: number;
  /** Which way the money usually goes for this payee (undefined for seeds). */
  dir?: Direction;
  /** A built-in phrase rather than one of your payees. */
  seed?: boolean;
}

/**
 * Text used for matching: the cleaned-up payee, lowercased, without store numbers, phone numbers and
 * other digits that make "Shell 0042" look unlike "Shell 1187".
 */
export function matchText(t: Pick<Transaction, 'payee' | 'description'>): string {
  return (t.payee || t.description)
    .toLowerCase()
    .replace(/[#*]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One example per payee you've categorized (its most trusted category), plus the category seeds. */
export function trainingExamples(txns: Transaction[], categories: Category[]): Example[] {
  const byText = new Map<string, { cats: Map<string, number>; in: number; out: number }>();
  for (const t of txns) {
    if (t.categoryId === UNCATEGORIZED) continue;
    const trust = TRUST[t.categorySource ?? 'legacy'];
    if (!trust) continue;
    const key = matchText(t);
    if (!key) continue;
    const e = byText.get(key) ?? { cats: new Map<string, number>(), in: 0, out: 0 };
    e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + trust);
    if (t.amount > 0) e.in++;
    else e.out++;
    byText.set(key, e);
  }
  const out: Example[] = [];
  for (const [text, e] of byText) {
    const [categoryId, w] = [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    // More (and more trusted) transactions weigh more, with diminishing returns.
    out.push({ text, categoryId, weight: 1 + Math.log2(w), dir: e.in > e.out ? 'in' : 'out' });
  }
  for (const c of categories) {
    if (c.id === UNCATEGORIZED) continue;
    for (const phrase of CATEGORY_SEEDS[c.id] ?? [c.name.toLowerCase()]) out.push({ text: phrase, categoryId: c.id, weight: SEED_WEIGHT, seed: true });
  }
  return out;
}

/** Whether a category can fit money moving in this direction. */
export function allowedFor(dir: Direction, group: CategoryGroup | undefined): boolean {
  if (!group) return false;
  if (group === 'transfer') return true;
  return dir === 'in' ? group === 'income' : group === 'expense';
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
  /** 0–1: the winning category's share of the vote. */
  share: number;
  /** Safe to apply without asking ("Likely"). */
  confident: boolean;
  /** Closest of your own payees that supports the pick, to show why ("like Whole Foods"). */
  like?: string;
}

/** Tuning knobs (exported for the tests). */
export const VOTE = { k: 7, floor: 0.25, confidentSimilarity: 0.6, confidentShare: 0.6 };

/**
 * Weighted vote among the `k` most similar examples (vectors must be normalized). Each neighbour votes
 * for its category with weight × (similarity − floor)², so close matches dominate. With `dir` and the
 * category groups, categories that can't fit the money's direction are ruled out first.
 */
export function nearestCategory(
  query: ArrayLike<number>,
  examples: (Example & { vec: ArrayLike<number> })[],
  opts: { dir?: Direction; groups?: Map<string, CategoryGroup> } = {},
): Suggestion | null {
  const { dir, groups } = opts;
  const fits = (e: Example) => !dir || !groups || allowedFor(dir, groups.get(e.categoryId));
  const scored = examples
    .filter(fits)
    .map((e) => ({ e, sim: dot(query, e.vec) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, VOTE.k);
  const votes = new Map<string, { score: number; sim: number }>();
  let total = 0;
  for (const s of scored) {
    const v = s.e.weight * Math.max(0, s.sim - VOTE.floor) ** 2;
    if (!v) continue;
    total += v;
    const cur = votes.get(s.e.categoryId);
    if (cur) cur.score += v;
    else votes.set(s.e.categoryId, { score: v, sim: s.sim });
  }
  if (!total) return null;
  const [categoryId, win] = [...votes.entries()].sort((a, b) => b[1].score - a[1].score)[0];
  const share = win.score / total;
  return {
    categoryId,
    similarity: win.sim,
    share,
    confident: win.sim >= VOTE.confidentSimilarity && share >= VOTE.confidentShare,
    like: scored.find((s) => !s.e.seed && s.e.categoryId === categoryId)?.e.text,
  };
}
