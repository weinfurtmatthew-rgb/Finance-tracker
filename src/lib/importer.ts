import type { Account, Rule, Transaction, TransactionSource } from '../types';
import type { DraftTransaction } from './draft';
import { categorize } from './categorize';
import { cleanPayee } from './payee';

export interface PreparedTransaction {
  draft: DraftTransaction;
  importId: string;
  duplicate: boolean;
  payee: string;
  categoryId: string;
}

/** Small, fast, stable string hash (FNV-1a, 32-bit) used for import ids. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Give every drafted transaction an id that is the same each time the same bank row is imported,
 * so overlapping exports don't create duplicates. Identical rows within one file (two $5 coffees
 * on the same day) get an occurrence counter so both are kept.
 */
export function importIds(accountId: string, drafts: DraftTransaction[]): string[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    if (d.fitid) return `${accountId}:ofx:${d.fitid}`;
    const key = `${d.date}|${d.amount}|${d.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return `${accountId}:csv:${hash(key)}:${n}`;
  });
}

export function prepareImport(
  accountId: string,
  drafts: DraftTransaction[],
  existingImportIds: Set<string>,
  rules: Rule[],
): PreparedTransaction[] {
  const ids = importIds(accountId, drafts);
  return drafts.map((draft, i) => {
    const { payee, categoryId } = categorize(
      { description: draft.description, payee: cleanPayee(draft.description), amount: draft.amount, bankCategory: draft.bankCategory },
      rules,
    );
    return { draft, importId: ids[i], duplicate: existingImportIds.has(ids[i]), payee, categoryId };
  });
}

export function toTransactions(
  account: Pick<Account, 'id'>,
  items: PreparedTransaction[],
  source: TransactionSource,
  newId: () => string,
): Transaction[] {
  const now = Date.now();
  return items
    .filter((p) => !p.duplicate)
    .map((p) => ({
      id: newId(),
      accountId: account.id,
      date: p.draft.date,
      amount: p.draft.amount,
      description: p.draft.description,
      payee: p.payee,
      categoryId: p.categoryId,
      notes: '',
      source,
      importId: p.importId,
      createdAt: now,
    }));
}
