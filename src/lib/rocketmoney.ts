/**
 * Rocket Money exports: one file with every linked account, spending as positive amounts, and Rocket
 * Money's own store names and categories.
 *
 * Before the app knew this format, such a file went into a single account as a plain CSV, possibly
 * with spending and income swapped, so it matched nothing a bank file later brought in. This finds
 * those earlier rows again (from the same file) and puts them right: correct sign, the right account,
 * Rocket Money's names and categories, then merges any that are already there from a bank file.
 */
import type { Account, AccountType, Cents, Rule, Transaction } from '../types';
import type { DraftTransaction, SourceAccount } from './draft';
import { importIds } from './importer';
import { categorize, type PayeeHistory } from './categorize';
import { cleanPayee } from './payee';
import { findAlreadyImported, mergeCopy } from './dedupe';

export interface RocketGroup {
  account: SourceAccount;
  drafts: DraftTransaction[];
}

/** The file's rows grouped by the account they're from, largest first. */
export function rocketGroups(drafts: DraftTransaction[]): RocketGroup[] {
  const m = new Map<string, RocketGroup>();
  for (const d of drafts) {
    if (!d.sourceAccount) continue;
    const g = m.get(d.sourceAccount.key) ?? { account: d.sourceAccount, drafts: [] };
    g.drafts.push(d);
    m.set(d.sourceAccount.key, g);
  }
  return [...m.values()].sort((a, b) => b.drafts.length - a.drafts.length);
}

/** An account type from Rocket Money's "Account Type" text. */
export function accountTypeFor(a: SourceAccount): AccountType {
  const t = `${a.type ?? ''} ${a.name}`.toLowerCase();
  if (/credit/.test(t)) return 'credit';
  if (/saving|money market/.test(t)) return 'savings';
  if (/invest|brokerage|401|ira|retire/.test(t)) return 'brokerage';
  if (/loan|mortgage/.test(t)) return 'loan';
  return 'checking';
}

/** An app account for a Rocket Money account: same last 4 digits, or the same name. */
export function accountFor(a: SourceAccount, accounts: Account[]): Account | undefined {
  const open = accounts.filter((x) => !x.archived);
  return (
    (a.last4 ? open.find((x) => x.last4 === a.last4) : undefined) ??
    open.find((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase()) ??
    open.find((x) => !!a.institution && x.name.toLowerCase() === `${a.institution} ${a.name}`.toLowerCase())
  );
}

export interface EarlierRow {
  txn: Transaction;
  /** Index of its row in the file. */
  row: number;
  /** It was saved with the opposite sign. */
  flipped: boolean;
}

/**
 * Rows of this file that were imported before as a plain CSV: the same ids a plain import of the whole
 * file would have given, into any account, with either sign.
 */
export function findEarlierImport(drafts: DraftTransaction[], accounts: Account[], txns: Transaction[]): EarlierRow[] {
  const byId = new Map<string, { row: number; flipped: boolean }>();
  for (const a of accounts) {
    for (const flipped of [false, true]) {
      const ids = importIds(
        a.id,
        drafts.map((d) => ({ ...d, amount: flipped ? -d.amount : d.amount })),
      );
      ids.forEach((id, row) => byId.set(id, { row, flipped }));
    }
  }
  const out: EarlierRow[] = [];
  const seenRows = new Set<number>();
  for (const t of txns) {
    const hit = t.importId ? byId.get(t.importId) : undefined;
    if (!hit || seenRows.has(hit.row) || !drafts[hit.row].sourceAccount) continue;
    seenRows.add(hit.row);
    out.push({ txn: t, row: hit.row, flipped: hit.flipped });
  }
  return out;
}

export interface RepairPlan {
  /** Rows to rewrite in place (right sign, account, id, names, category). */
  update: { id: string; changes: Partial<Transaction> }[];
  /** Rows that turned out to be copies of what a bank file brought in: removed, edits kept. */
  remove: string[];
  /** Transactions that take over a removed copy's edits and id. */
  merge: { id: string; changes: Partial<Transaction> }[];
  /** New starting balances where a bank-confirmed balance had counted the old rows. */
  openings: { accountId: string; openingBalance: Cents }[];
  /** How many rows were fixed, moved to another account, and merged into bank lines. */
  fixed: number;
  moved: number;
  merged: number;
}

/**
 * Put earlier rows right. `target` maps each Rocket Money account key to the app account its rows
 * belong in.
 */
export function planRepair(args: {
  drafts: DraftTransaction[];
  earlier: EarlierRow[];
  target: Map<string, string>;
  accounts: Account[];
  txns: Transaction[];
  rules: Rule[];
  history?: PayeeHistory;
}): RepairPlan {
  const { drafts, earlier, target, accounts, txns, rules, history } = args;
  const plan: RepairPlan = { update: [], remove: [], merge: [], openings: [], fixed: 0, moved: 0, merged: 0 };
  // The ids a Rocket Money import of each account gives its rows (counted within that account's rows).
  const newId = new Map<number, string>();
  for (const [key, accountId] of target) {
    const rows = drafts.map((d, i) => ({ d, i })).filter((x) => x.d.sourceAccount?.key === key);
    importIds(
      accountId,
      rows.map((x) => x.d),
    ).forEach((id, k) => newId.set(rows[k].i, id));
  }
  const affected = new Set(earlier.map((e) => e.txn.id));
  const fixedRows: Transaction[] = [];
  for (const e of earlier) {
    const d = drafts[e.row];
    const accountId = target.get(d.sourceAccount!.key);
    if (!accountId) continue;
    const t = e.txn;
    // Already right (imported as Rocket Money): nothing to do.
    if (!e.flipped && accountId === t.accountId && newId.get(e.row) === t.importId) continue;
    const chosen = t.categorySource === 'user' || t.categorySource === 'rule';
    const auto = categorize(
      { description: d.description, payee: d.payeeHint ?? cleanPayee(d.description), amount: d.amount, bankCategory: d.bankCategory, creditAccount: accounts.find((a) => a.id === accountId)?.type === 'credit' },
      rules,
      history,
    );
    const payeeWasAuto = t.payee === cleanPayee(t.description) || !t.payee;
    const changes: Partial<Transaction> = {
      amount: d.amount,
      accountId,
      importId: newId.get(e.row),
      ...(payeeWasAuto ? { payee: auto.payee } : {}),
      ...(chosen || t.splits?.length || t.owedBy ? {} : { categoryId: auto.categoryId, categorySource: auto.source }),
    };
    plan.update.push({ id: t.id, changes });
    plan.fixed++;
    if (accountId !== t.accountId) plan.moved++;
    fixedRows.push({ ...t, ...changes });
  }

  // Now that they're right, the ones a bank file already brought in are copies.
  const others = txns.filter((t) => !affected.has(t.id));
  for (const accountId of new Set(fixedRows.map((t) => t.accountId))) {
    const mine = fixedRows.filter((t) => t.accountId === accountId);
    const theirs = others.filter((t) => t.accountId === accountId);
    const matches = findAlreadyImported(
      mine.map((t) => ({ date: t.date, amount: t.amount, description: `${t.description} ${t.payee}`, importId: t.importId! })),
      theirs,
    );
    for (const [i, keep] of matches) {
      const copy = mine[i];
      plan.remove.push(copy.id);
      plan.merge.push({ id: keep.id, changes: mergeCopy(keep, copy) });
      plan.merged++;
    }
  }
  const removed = new Set(plan.remove);
  const touched = new Set(fixedRows.map((t) => t.id));
  // Balances: where the bank confirmed a balance after these rows came in, it counted them as they
  // were, so the starting balance absorbs the change and the confirmed balance stays right.
  const newest = Math.max(...earlier.map((e) => e.txn.createdAt));
  for (const a of accounts) {
    const before = earlier.filter((e) => e.txn.accountId === a.id && touched.has(e.txn.id));
    if (!before.length) continue;
    const confirmedAfter = a.balanceSetAt != null ? a.balanceSetAt >= newest : !!a.checkedOn && before.some((e) => a.checkedOn! >= e.txn.date);
    if (!confirmedAfter) continue;
    const beforeSum = before.reduce((s, e) => s + e.txn.amount, 0);
    const afterSum = fixedRows.filter((t) => t.accountId === a.id && !removed.has(t.id)).reduce((s, t) => s + t.amount, 0);
    if (beforeSum !== afterSum) plan.openings.push({ accountId: a.id, openingBalance: a.openingBalance + beforeSum - afterSum });
  }
  plan.update = plan.update.filter((u) => !removed.has(u.id));
  return plan;
}
