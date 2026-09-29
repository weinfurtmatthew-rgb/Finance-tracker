import type { Category, CategoryGroup, Transaction } from '../types';
import { UNCATEGORIZED } from '../lib/categories';
import { isWeakCategory } from '../lib/categorize';
import { vectors } from './vectors';
import { directionOf, matchText, nearestCategory, trainingExamples, type Suggestion } from './similar';

type Embed = (texts: string[]) => Promise<ArrayLike<number>[]>;

export interface PayeeGroup {
  key: string;
  payee: string;
  txns: Transaction[];
  total: number;
  suggestion: Suggestion | null;
}

/** Same payee and same direction of money: a purchase and a refund at one store are separate groups. */
function groupByPayee(txns: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = `${directionOf(t)}:${matchText(t)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return groups;
}

/** A suggested category for each group, matched against everything else you've categorized. */
async function suggestGroups(groups: Map<string, Transaction[]>, all: Transaction[], categories: Category[], embed: Embed): Promise<PayeeGroup[]> {
  if (!groups.size) return [];
  const examples = trainingExamples(all, categories);
  const exVecs = await embed(examples.map((e) => e.text));
  const indexed = examples.map((e, i) => ({ ...e, vec: exVecs[i] }));
  const catGroups = new Map<string, CategoryGroup>(categories.map((c) => [c.id, c.group]));
  const keys = [...groups.keys()];
  const qVecs = await embed(keys.map((k) => matchText(groups.get(k)![0])));
  return keys.map((key, i) => {
    const list = groups.get(key)!;
    return {
      key,
      payee: list[0].payee || list[0].description,
      txns: list,
      total: list.reduce((s, t) => s + t.amount, 0),
      suggestion: nearestCategory(qVecs[i], indexed, { dir: directionOf(list[0]), groups: catGroups }),
    };
  });
}

/** Group any transactions by payee and suggest a category for each group (for the tidy-up). */
export async function suggestForTxns(targets: Transaction[], all: Transaction[], categories: Category[], embed: Embed = vectors): Promise<PayeeGroup[]> {
  return (await suggestGroups(groupByPayee(targets), all, categories, embed)).sort((a, b) => b.txns.length - a.txns.length);
}

/** Group uncategorized transactions by payee and suggest a category for each group. */
export async function suggestForUncategorized(txns: Transaction[], categories: Category[], embed: Embed = vectors): Promise<PayeeGroup[]> {
  const groups = groupByPayee(txns.filter((t) => t.categoryId === UNCATEGORIZED));
  return (await suggestGroups(groups, txns, categories, embed)).sort((a, b) => b.txns.length - a.txns.length);
}

/**
 * After an import: among the new transactions whose category is only a guess (uncategorized, the
 * income fallback, or a bank's catch-all "Other"), the confident AI picks to apply. Everything else is
 * left alone.
 */
export async function automaticPicks(
  newIds: Set<string>,
  all: Transaction[],
  categories: Category[],
  embed: Embed = vectors,
): Promise<{ id: string; categoryId: string }[]> {
  const targets = all.filter((t) => newIds.has(t.id) && isWeakCategory(t));
  const groups = await suggestGroups(groupByPayee(targets), all, categories, embed);
  return groups.flatMap((g) => {
    const s = g.suggestion;
    if (!s?.confident) return [];
    return g.txns.filter((t) => t.categoryId !== s.categoryId).map((t) => ({ id: t.id, categoryId: s.categoryId }));
  });
}

/** Best category for a single transaction (used by "What is this?"). */
export async function suggestFor(t: Pick<Transaction, 'payee' | 'description' | 'amount'>, all: Transaction[], categories: Category[], embed: Embed = vectors) {
  const examples = trainingExamples(all, categories);
  const exVecs = await embed(examples.map((e) => e.text));
  const [q] = await embed([matchText(t)]);
  return nearestCategory(
    q,
    examples.map((e, i) => ({ ...e, vec: exVecs[i] })),
    { dir: directionOf(t), groups: new Map(categories.map((c) => [c.id, c.group])) },
  );
}
