import type { Category, Transaction } from '../types';
import { UNCATEGORIZED } from '../lib/categories';
import { embed } from './client';
import { nearestCategory, queryText, trainingExamples, type Suggestion } from './similar';

// Embeddings don't change for the same text, so keep them for the session.
const cache = new Map<string, ArrayLike<number>>();

async function vectors(texts: string[]): Promise<ArrayLike<number>[]> {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    const vecs = await embed(missing);
    missing.forEach((t, i) => cache.set(t, vecs[i]));
  }
  return texts.map((t) => cache.get(t)!);
}

export interface PayeeGroup {
  key: string;
  payee: string;
  txns: Transaction[];
  total: number;
  suggestion: Suggestion | null;
}

/** Group uncategorized transactions by payee and suggest a category for each group. */
export async function suggestForUncategorized(txns: Transaction[], categories: Category[]): Promise<PayeeGroup[]> {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.categoryId !== UNCATEGORIZED) continue;
    const key = (t.payee || t.description).trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  if (!groups.size) return [];
  const examples = trainingExamples(txns, categories);
  const exVecs = await vectors(examples.map((e) => e.text));
  const indexed = examples.map((e, i) => ({ ...e, vec: exVecs[i] }));
  const keys = [...groups.keys()];
  const qVecs = await vectors(keys.map((k) => queryText(groups.get(k)![0])));
  return keys
    .map((key, i) => {
      const list = groups.get(key)!;
      return {
        key,
        payee: list[0].payee || list[0].description,
        txns: list,
        total: list.reduce((s, t) => s + t.amount, 0),
        suggestion: nearestCategory(qVecs[i], indexed),
      };
    })
    .sort((a, b) => b.txns.length - a.txns.length);
}

/** Best category for a single description (used by "Explain"). */
export async function suggestFor(t: Pick<Transaction, 'payee' | 'description'>, all: Transaction[], categories: Category[]) {
  const examples = trainingExamples(all, categories);
  const exVecs = await vectors(examples.map((e) => e.text));
  const [q] = await vectors([queryText(t)]);
  return nearestCategory(
    q,
    examples.map((e, i) => ({ ...e, vec: exVecs[i] })),
  );
}
