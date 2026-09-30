import type { Account, CategorySource, Rule, Transaction, TransactionSource } from '../types';
import type { DraftTransaction } from './draft';
import { categorize, type PayeeHistory } from './categorize';
import { cleanPayee } from './payee';
import { APP_NAMES, appFallback, personFromBankLine } from './p2p';
import { UNCATEGORIZED } from './categories';
import { findAlreadyImported } from './dedupe';

export interface PreparedTransaction {
  draft: DraftTransaction;
  importId: string;
  duplicate: boolean;
  /** Already in the app under another file format's id: the transaction it is. */
  likely?: Transaction;
  payee: string;
  categoryId: string;
  categorySource: CategorySource;
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
  opts: { history?: PayeeHistory; creditAccount?: boolean; existing?: Transaction[] } = {},
): PreparedTransaction[] {
  const ids = importIds(accountId, drafts);
  // Rows already in the account from a different kind of file (CSV vs QFX, statement vs activity).
  const likely = findAlreadyImported(
    drafts.map((d, i) => ({ date: d.date, amount: d.amount, description: d.description, importId: ids[i] })).filter((_, i) => !existingImportIds.has(ids[i])),
    opts.existing ?? [],
  );
  const fresh = drafts.map((_, i) => i).filter((i) => !existingImportIds.has(ids[i]));
  const likelyOf = new Map([...likely].map(([k, t]) => [fresh[k], t]));
  return drafts.map((draft, i) => {
    const p = draft.p2p;
    const guessPayee = p ? (p.kind === 'transfer' ? `${APP_NAMES[p.app]} transfer` : p.person || APP_NAMES[p.app]) : (personFromBankLine(draft.description) ?? cleanPayee(draft.description));
    let { payee, categoryId, source } = categorize(
      { description: draft.description, payee: guessPayee, amount: draft.amount, bankCategory: draft.bankCategory, creditAccount: opts.creditAccount, appPayment: !!p },
      rules,
      opts.history,
    );
    // App transactions: transfers and rewards are clear from the app; otherwise an emoji in the note
    // ("🍕") is a better guess than nothing.
    if (p && (source === 'default' || p.kind === 'transfer' || p.kind === 'reward') && source !== 'rule') {
      const app = appFallback(p, draft.amount);
      if (app) ({ categoryId, source } = app);
      else if (categoryId !== UNCATEGORIZED && source === 'default') categoryId = UNCATEGORIZED;
    }
    return { draft, importId: ids[i], duplicate: existingImportIds.has(ids[i]), likely: likelyOf.get(i), payee, categoryId, categorySource: source };
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
      categorySource: p.categorySource,
      notes: p.draft.p2p?.note ?? '',
      source,
      importId: p.importId,
      ...(p.draft.p2p ? { p2p: { app: p.draft.p2p.app, person: p.draft.p2p.person, note: p.draft.p2p.note, kind: p.draft.p2p.kind, fundedFrom: p.draft.p2p.fundedFrom } } : {}),
      createdAt: now,
    }));
}
